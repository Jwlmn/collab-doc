<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { useAuthStore } from '../stores/auth'
import { api, getApiErrorMessage } from '../utils/request'
import { getCollabUrl } from '../utils/collab'
import { userColor as colorOf } from '../utils/color'
import { useI18n } from 'vue-i18n'
import { useImportFlowStore } from '../stores/importFlow'
import { exportGridToXlsx, columnLabel } from '../io/cells'
import {
  SheetModel,
  columnLabels,
  gridToHtml,
  DEFAULT_COLS,
  type CellStyle,
  type CfOp,
  type CfRule,
  type MergeRange,
  type SheetMeta,
} from '../io/sheet-model'
import { useAutoSnapshot } from '../composables/useAutoSnapshot'
import { evaluateCellDisplay, isFormula } from '../io/formula'
import CommentDrawer from '../components/CommentDrawer.vue'
import SheetVersionDrawer from '../components/SheetVersionDrawer.vue'
import ShareModal from '../components/ShareModal.vue'
import ThemeToggle from '../components/ThemeToggle.vue'
import type { DocumentMeta } from '../types'

interface CollabTokenData {
  token: string
  role: string
  expires_at: number
}

interface Collaborator {
  name: string
  color: string
}


const props = defineProps<{
  /** 公开分享令牌：存在即进入访客只读模式（由 ShareView 传入） */
  shareToken?: string
  /** 访客模式下由 ShareView 预取的文档元数据 */
  sharedMeta?: DocumentMeta
}>()

/** 访客模式：不再调用任何需要登录的接口 */
const isShare = computed(() => !!props.shareToken)

const route = useRoute()
const router = useRouter()
const message = useMessage()
const auth = useAuthStore()
const { t } = useI18n()
const importFlow = useImportFlowStore()

// 访客态没有 /sheet/:id 路由，文档 id 只能来自 sharedMeta
const docId = computed(() => Number(props.sharedMeta?.id ?? route.params.id))
const meta = ref<DocumentMeta | null>(props.sharedMeta ?? null)
const loading = ref(true)
const titleEditing = ref('')
const titleInputRef = ref<{ focus: () => void; $el?: HTMLElement } | null>(null)
const connectionStatus = ref<'connecting' | 'connected' | 'disconnected'>('connecting')
const synced = ref(false)
const syncTick = ref(0)
const collaborators = ref<Collaborator[]>([])
const commentDrawerVisible = ref(false)
const versionDrawerVisible = ref(false)
const shareVisible = ref(false)
const helpVisible = ref(false)
const unreadComments = ref(0)
const exporting = ref(false)
/** 数据 seed/迁移完成前保持骨架，避免空表格可交互的竞态窗口 */
const ready = ref(false)

let provider: HocuspocusProvider | null = null
let ydoc: Y.Doc | null = null
let model: SheetModel | null = null
let stopObserve: (() => void) | null = null

const isReadonly = computed(() => meta.value?.role === 'viewer')
const canRename = computed(() => meta.value?.role === 'owner')

const hasUnsynced = computed(() => {
  void syncTick.value
  return provider?.hasUnsyncedChanges ?? false
})

const statusText = computed(() =>
  connectionStatus.value === 'connecting' ? t('editor.statusConnecting') : t('editor.statusOffline'),
)
const statusType = computed(() =>
  connectionStatus.value === 'connecting' ? ('warning' as const) : ('error' as const),
)

/* ---------------- 网格状态 ---------------- */

/** 数据版本（SheetModel 深度 observe 驱动重渲染） */
const dataRevision = ref(0)

const MIN_COLS = DEFAULT_COLS

/**
 * 视口覆盖行列：按 grid-wrap 实际尺寸计算渲染下限，
 * 保证任意分辨率（宽屏/高屏）下网格线都铺满可视区——
 * 超出数据范围的单元格读出为空、可直接编辑（ensureRow 自动补齐数据行）。
 */
const gridWrapRef = ref<HTMLElement | null>(null)
const coverRows = ref(0)
const coverCols = ref(0)
let coverObserver: ResizeObserver | null = null

/** 与 .sheet-grid th/td 样式保持一致 */
const CELL_H = 30
const CELL_W = 96
const CORNER_W = 48

/**
 * 视口覆盖行列数。
 *
 * 行高列宽可变后不能再用「视口尺寸 ÷ 常量」的除法（会被放大的行高/列宽
 * 算漏，露出没有网格线的空白区），改为逐格累加到覆盖视口为止。
 */
function refreshCover(): void {
  const el = gridWrapRef.value
  if (!el) return

  // 硬上限：行高下限 16px、列宽下限 24px，视口累加不会真的到这个量级，
  // 纯粹防极端配置下死循环
  const GUARD = 2000

  let height = 0
  let rows = 0
  while (height < el.clientHeight && rows < GUARD) {
    height += rowHeightOf(rows)
    rows++
  }
  coverRows.value = rows + 1 // +1 吸收 sticky 表头占位与亚像素取整误差

  const viewportW = Math.max(el.clientWidth - CORNER_W, 0)
  let width = 0
  let cols = 0
  while (width < viewportW && cols < GUARD) {
    width += colWidthOf(cols)
    cols++
  }
  coverCols.value = cols + 1
}

/** 数据变更后按帧节流刷新覆盖数（每帧最多一次，避免拖拽期间高频重算） */
let coverRafId = 0
function scheduleRefreshCover(): void {
  if (coverRafId) return
  coverRafId = requestAnimationFrame(() => {
    coverRafId = 0
    refreshCover()
  })
}

watch(gridWrapRef, (el) => {
  coverObserver?.disconnect()
  if (!el) return
  coverObserver = new ResizeObserver(() => refreshCover())
  coverObserver.observe(el)
  refreshCover()
})

/** 显示行数 = max(结构行数, 视口覆盖)；列同理 */
const displayRows = computed(() => {
  void dataRevision.value
  return Math.max(model?.rowCount ?? 0, coverRows.value)
})

const displayCols = computed(() => {
  void dataRevision.value
  if (!model) return Math.max(MIN_COLS, coverCols.value)
  return Math.max(MIN_COLS, model.colCount + 3, coverCols.value)
})

const columnHeaders = computed(() => columnLabels(displayCols.value))

/* ---------------- 尺寸（列宽 / 行高）与拖拽 ---------------- */

/** 拖拽预览值：拖动过程中只改本地显示，松手才写 Y.Map（否则每像素都广播一次） */
const resizePreview = ref<{ kind: 'col' | 'row'; index: number; px: number } | null>(null)

/** 当前列宽：预览值 → 模型值 → 默认 96 */
function colWidthOf(c: number): number {
  const preview = resizePreview.value
  if (preview?.kind === 'col' && preview.index === c) return preview.px
  void dataRevision.value
  return model?.getColWidth(c) ?? CELL_W
}

/** 当前行高：预览值 → 模型值 → 默认 30 */
function rowHeightOf(r: number): number {
  const preview = resizePreview.value
  if (preview?.kind === 'row' && preview.index === r) return preview.px
  void dataRevision.value
  return model?.getRowHeight(r) ?? CELL_H
}

let resizeOrigin = 0
let resizeStart = 0
/** 正在拖拽的 pointer id：多点触控时只认起手那根（触屏拖手柄的关键） */
let resizePointerId = -1

function startColResize(c: number, event: PointerEvent): void {
  if (isReadonly.value || event.button !== 0 || !event.isPrimary) return
  event.preventDefault()
  event.stopPropagation()
  resizeStart = event.clientX
  resizeOrigin = colWidthOf(c)
  resizePreview.value = { kind: 'col', index: c, px: resizeOrigin }
  resizePointerId = event.pointerId
  dragging.value = false
}

function startRowResize(r: number, event: PointerEvent): void {
  if (isReadonly.value || event.button !== 0 || !event.isPrimary) return
  event.preventDefault()
  event.stopPropagation()
  resizeStart = event.clientY
  resizeOrigin = rowHeightOf(r)
  resizePreview.value = { kind: 'row', index: r, px: resizeOrigin }
  resizePointerId = event.pointerId
  dragging.value = false
}

function handleResizeMove(event: PointerEvent): void {
  const target = resizePreview.value
  if (!target || event.pointerId !== resizePointerId) return
  const delta = (target.kind === 'col' ? event.clientX : event.clientY) - resizeStart
  const min = target.kind === 'col' ? 24 : 16
  resizePreview.value = { ...target, px: Math.max(min, resizeOrigin + delta) }
}

/** pointerup / pointercancel 统一结算（touch 没有可靠的 mouseup 序列） */
function handlePointerMoveForResize(event: PointerEvent): void {
  if (resizePreview.value) handleResizeMove(event)
}

function handlePointerEnd(event: PointerEvent): void {
  if (resizePreview.value && event.pointerId === resizePointerId) handleResizeEnd()
}

/** 松手：把预览值落到模型（一次性写入，协同只广播一次） */
function handleResizeEnd(): void {
  const target = resizePreview.value
  if (!target || !model) {
    resizePreview.value = null
    return
  }
  const px = target.px
  if (target.kind === 'col') model.setColWidth(target.index, px)
  else model.setRowHeight(target.index, px)
  resizePreview.value = null
  scheduleRefreshCover()
}

/** 双击表头边界恢复默认尺寸 */
function resetColWidth(c: number): void {
  if (isReadonly.value || !model) return
  model.setColWidth(c, null)
  scheduleRefreshCover()
}

function resetRowHeight(r: number): void {
  if (isReadonly.value || !model) return
  model.setRowHeight(r, null)
  scheduleRefreshCover()
}

/** 选区：anchor 固定，focus 随点击/拖拽/键盘移动 */
const anchor = ref({ r: 0, c: 0 })
const focus = ref({ r: 0, c: 0 })
const dragging = ref(false)

/* ---------------- 合并单元格 ---------------- */

/** 全部合并区域（merges 子表变更经 observe 冒泡 → dataRevision 失效） */
const merges = computed<MergeRange[]>(() => {
  void dataRevision.value
  return model?.getMerges() ?? []
})

/**
 * 合并索引：covered = 被吞掉不渲染的格，anchors = 锚点格 → 区域。
 * 渲染循环逐格查表 O(1)，避免每 td 遍历全部 merges。
 */
const mergeIndex = computed(() => {
  const covered = new Set<string>()
  const anchors = new Map<string, MergeRange>()
  for (const m of merges.value) {
    anchors.set(`${m.r1},${m.c1}`, m)
    for (let r = m.r1; r <= m.r2; r++) {
      for (let c = m.c1; c <= m.c2; c++) {
        if (r === m.r1 && c === m.c1) continue
        covered.add(`${r},${c}`)
      }
    }
  }
  return { covered, anchors }
})

/** 该格是否被合并吞掉（不渲染 td，由锚点 rowspan/colspan 覆盖） */
function isCoveredCell(r: number, c: number): boolean {
  return mergeIndex.value.covered.has(`${r},${c}`)
}

/** 锚点格上的合并区域；非锚点/未合并返回 null */
function mergeAnchorAt(r: number, c: number): MergeRange | null {
  return mergeIndex.value.anchors.get(`${r},${c}`) ?? null
}

function mergeRowspan(r: number, c: number): number | undefined {
  const m = mergeAnchorAt(r, c)
  return m ? m.r2 - m.r1 + 1 : undefined
}

function mergeColspan(r: number, c: number): number | undefined {
  const m = mergeAnchorAt(r, c)
  return m ? m.c2 - m.c1 + 1 : undefined
}

/** 把任意格吸附到所在合并的锚点（焦点始终落在有 td 的格上） */
function snapToAnchor(r: number, c: number): { r: number; c: number } {
  const m = model?.getMergeAt(r, c)
  return m ? { r: m.r1, c: m.c1 } : { r, c }
}

/**
 * 选区 = 原始 anchor/focus 经合并区域扩张后的可视范围：
 * 点中/框到合并的任意部分 → 整块高亮，样式也整块生效（Excel 语义）。
 * 合并两两不相交，单遍扩张即收敛。
 */
const range = computed(() => {
  let r1 = Math.min(anchor.value.r, focus.value.r)
  let r2 = Math.max(anchor.value.r, focus.value.r)
  let c1 = Math.min(anchor.value.c, focus.value.c)
  let c2 = Math.max(anchor.value.c, focus.value.c)
  for (const m of merges.value) {
    if (r1 <= m.r2 && m.r1 <= r2 && c1 <= m.c2 && m.c1 <= c2) {
      r1 = Math.min(r1, m.r1)
      r2 = Math.max(r2, m.r2)
      c1 = Math.min(c1, m.c1)
      c2 = Math.max(c2, m.c2)
    }
  }
  return { r1, r2, c1, c2 }
})

const editing = ref<{ r: number; c: number } | null>(null)
const draft = ref('')
/** mousedown 起点与是否发生拖动（区分「点按选中」与「拖拽框选」） */
const pressedCell = ref<{ r: number; c: number } | null>(null)
const dragMoved = ref(false)
/** 最近一次指针类型：鼠标单击只选中（双击编辑），触屏点按保持直接编辑 */
let lastPointerType = 'mouse'

function cellRaw(r: number, c: number): string {
  void dataRevision.value
  return model?.getRaw(r, c) ?? ''
}

function cellStyle(r: number, c: number): CellStyle {
  void dataRevision.value
  return model?.getStyle(r, c) ?? {}
}

/**
 * 公式求值缓存。
 *
 * 网格无虚拟化，每次 dataRevision 变更都会重渲染全部单元格；条件格式又在
 * 每格上再取一次显示值，不缓存的话公式链会被反复求值。缓存随 dataRevision
 * 整体失效 —— 数据一变，依赖它的公式都可能变，不做更细粒度的依赖分析。
 */
let evalCache = new Map<string, string>()
let cachedRevision = -1

function evalCacheKey(r: number, c: number): string {
  return `${r},${c}`
}

/** 显示值：公式求值 / 原文 */
function displayValue(r: number, c: number): string {
  void dataRevision.value

  const raw = cellRaw(r, c)
  if (!isFormula(raw)) return raw

  if (cachedRevision !== dataRevision.value) {
    evalCache.clear()
    cachedRevision = dataRevision.value
  }

  const key = evalCacheKey(r, c)
  const hit = evalCache.get(key)
  if (hit !== undefined) return hit

  const out = evaluateCellDisplay(raw, (rr, cc) => cellRaw(rr, cc), r, c)
  evalCache.set(key, out)
  return out
}

function isSelected(r: number, c: number): boolean {
  const rg = range.value
  return r >= rg.r1 && r <= rg.r2 && c >= rg.c1 && c <= rg.c2
}

function isFocus(r: number, c: number): boolean {
  return focus.value.r === r && focus.value.c === c
}

function isEditing(r: number, c: number): boolean {
  return editing.value?.r === r && editing.value?.c === c
}

/* ---------------- 跟随协作者 ---------------- */

/** 正在跟随的协作者名字；null = 未跟随 */
const followName = ref<string | null>(null)

function toggleFollow(name: string): void {
  followName.value = followName.value === name ? null : name
  if (followName.value) {
    message.info(t('editor.followStart', { name }))
    applyFollow()
  }
}

/** 把视口滚到目标单元格（行列尺寸可变，用实际宽高逐格累加定位） */
function scrollToCell(r: number, c: number): void {
  const el = gridWrapRef.value
  if (!el) return

  let top = 0
  for (let i = 0; i < r; i++) top += rowHeightOf(i)

  let left = CORNER_W
  for (let i = 0; i < c; i++) left += colWidthOf(i)

  el.scrollTo({
    top: Math.max(0, top - el.clientHeight / 2),
    left: Math.max(0, left - el.clientWidth / 2),
    behavior: 'smooth',
  })
}

/** 按当前跟随目标刷新视口（awareness 变化时调用） */
function applyFollow(): void {
  const target = followName.value
  const awareness = provider?.awareness
  if (!target || !awareness) return

  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness.clientID) return
    const typed = state as { user?: Collaborator; cell?: { r: number; c: number } }
    if (typed.user?.name === target && typed.cell) {
      scrollToCell(typed.cell.r, typed.cell.c)
    }
  })
}

/* ---------------- 条件格式 ---------------- */

/** 已有规则（随 dataRevision 失效，避免每格都读 Y.Map） */
const cfRules = computed<Record<string, CfRule>>(() => {
  void dataRevision.value
  return model?.getCfRules() ?? {}
})

/** 文本能否转成数字（条件比较用；空串不算数） */
function numericOrNull(v: string | number | undefined): number | null {
  if (v === undefined) return null
  const text = typeof v === 'number' ? String(v) : v.trim()
  if (text === '') return null
  const n = Number(text)
  return Number.isFinite(n) ? n : null
}

/** 单元格是否命中某条规则 */
function cfMatches(rule: CfRule, r: number, c: number): boolean {
  if (r < rule.r1 || r > rule.r2 || c < rule.c1 || c > rule.c2) return false

  const text = displayValue(r, c)

  switch (rule.op) {
    case 'contains':
      return text.includes(String(rule.value))
    case 'eq':
    case 'neq': {
      const a = numericOrNull(text)
      const b = numericOrNull(rule.value)
      const equal = a !== null && b !== null ? a === b : text === String(rule.value)
      return rule.op === 'eq' ? equal : !equal
    }
    default: {
      // 数值比较：非数字单元格一律不命中（如 gt/lt 对文本列无意义）
      const cell = numericOrNull(text)
      const bound = numericOrNull(rule.value)
      if (cell === null || bound === null) return false
      switch (rule.op) {
        case 'gt':
          return cell > bound
        case 'lt':
          return cell < bound
        case 'gte':
          return cell >= bound
        case 'lte':
          return cell <= bound
        case 'between': {
          const high = numericOrNull(rule.value2)
          if (high === null) return false
          const lo = Math.min(bound, high)
          const hi = Math.max(bound, high)
          return cell >= lo && cell <= hi
        }
        default:
          return false
      }
    }
  }
}

/** 命中的规则样式（多条命中时后定义的优先）；未命中返回 null */
function cfStyleAt(r: number, c: number): CellStyle | null {
  const rules = Object.values(cfRules.value)
  if (rules.length === 0) return null
  let hit: CellStyle | null = null
  for (const rule of rules) {
    if (cfMatches(rule, r, c)) hit = rule.style
  }
  return hit
}

/**
 * 给定背景色算一盏「墨水」：亮底配深字、暗底配亮字。
 * 单元格底色是用户数据（浅色粉彩为主），深色主题下若任由文字继承页面浅色，
 * 会糊在亮底上不可读；显式指定过文字色的仍以用户选择为准。
 */
function contrastInk(bg: string): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(bg.trim())
  if (!m) return ''
  const hex = m[1].length === 3 ? m[1].replace(/./g, (ch) => ch + ch) : m[1]
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return luminance > 0.45 ? '#1f2329' : '#e5e6eb'
}

function cellCssStyle(r: number, c: number): Record<string, string> {
  const s = cellStyle(r, c)
  const base = {
    fontWeight: s.b ? '700' : '',
    color: s.c ?? '',
    background: s.bg ?? '',
    textAlign: s.al ?? '',
  }

  // 条件格式只覆盖它自己声明的字段，其余沿用手动样式
  const cf = cfStyleAt(r, c)
  const merged = cf
    ? {
        fontWeight: cf.b ? '700' : base.fontWeight,
        color: cf.c ?? base.color,
        background: cf.bg ?? base.background,
        textAlign: cf.al ?? base.textAlign,
      }
    : base

  if (!merged.color && merged.background) merged.color = contrastInk(merged.background)
  return merged
}

/* ---------------- 条件格式 UI ---------------- */

const cfVisible = ref(false)
const cfOp = ref<CfOp>('gt')
const cfValue = ref('')
const cfValue2 = ref('')

const CF_OP_OPTIONS = computed<Array<{ label: string; value: CfOp }>>(() => [
  { label: t('excel.cfOpGt'), value: 'gt' },
  { label: t('excel.cfOpLt'), value: 'lt' },
  { label: t('excel.cfOpGte'), value: 'gte' },
  { label: t('excel.cfOpLte'), value: 'lte' },
  { label: t('excel.cfOpEq'), value: 'eq' },
  { label: t('excel.cfOpNeq'), value: 'neq' },
  { label: t('excel.cfOpContains'), value: 'contains' },
  { label: t('excel.cfOpBetween'), value: 'between' },
])

/** 预设高亮色（条件格式最常用的就是背景高亮） */
const CF_COLORS = ['#e8f7ee', '#fdeceb', '#fff7e6', '#e7f1ff', '#f3e8ff', '#f4f5f7']
const cfBg = ref(CF_COLORS[1])
const cfBold = ref(false)

function applyCfRule(): void {
  if (!model || isReadonly.value) return
  const value = cfValue.value.trim()
  if (value === '') {
    message.warning(t('excel.cfValueRequired'))
    return
  }
  if (cfOp.value === 'between' && cfValue2.value.trim() === '') {
    message.warning(t('excel.cfValue2Required'))
    return
  }

  const rg = range.value
  const id = `cf-${Date.now()}-${Math.floor(Math.random() * 1000)}`
  const style: CellStyle = { bg: cfBg.value }
  if (cfBold.value) style.b = 1

  model.setCfRule(id, {
    r1: rg.r1,
    c1: rg.c1,
    r2: rg.r2,
    c2: rg.c2,
    op: cfOp.value,
    value: numericOrNull(value) ?? value,
    ...(cfOp.value === 'between' ? { value2: numericOrNull(cfValue2.value) ?? cfValue2.value } : {}),
    style,
  })
  message.success(t('excel.cfApplied', { range: `${columnLabel(rg.c1)}${rg.r1 + 1}:${columnLabel(rg.c2)}${rg.r2 + 1}` }))
  cfVisible.value = false
}

function removeCfRule(id: string): void {
  if (!model || isReadonly.value) return
  model.removeCfRule(id)
}

/** 规则区间的人类可读描述 */
function cfRuleRange(rule: CfRule): string {
  return rule.r1 === rule.r2 && rule.c1 === rule.c2
    ? `${columnLabel(rule.c1)}${rule.r1 + 1}`
    : `${columnLabel(rule.c1)}${rule.r1 + 1}:${columnLabel(rule.c2)}${rule.r2 + 1}`
}

/** 规则条件的人类可读描述 */
function cfRuleLabel(rule: CfRule): string {
  const op = CF_OP_OPTIONS.value.find((o) => o.value === rule.op)?.label ?? rule.op
  if (rule.op === 'between') return t('excel.cfSummaryBetween', { op, value: String(rule.value), value2: String(rule.value2) })
  return t('excel.cfSummary', { op, value: String(rule.value) })
}

function selectCell(r: number, c: number, extend = false): void {
  if (editing.value && (editing.value.r !== r || editing.value.c !== c)) {
    commitEdit()
  }
  // 命中合并区（如搜索跳转）→ 吸附锚点，整块选中由 range 扩张完成
  const target = snapToAnchor(r, c)
  if (!extend) anchor.value = { ...target }
  focus.value = { ...target }
  broadcastCell()
}

function handleCellMouseDown(r: number, c: number, event: MouseEvent): void {
  if (event.button !== 0) return
  // 编辑态且点在当前格（编辑框内）：交给 input 自己处理——
  // 不 preventDefault（保留框选文字/点移光标的默认行为）、不抢焦点
  // （抢焦点会触发 input blur → commitEdit，导致一框选就退出编辑）
  if (isEditing(r, c)) return
  // preventDefault 会阻断浏览器默认的「点击聚焦最近 tabindex 祖先」，
  // 这里手动让网格容器获得焦点，键盘事件才能进入 handleGridKeydown
  event.preventDefault()
  const wrap = (event.currentTarget as HTMLElement).closest('.grid-wrap')
  ;(wrap as HTMLElement | null)?.focus()

  pressedCell.value = { r, c }
  dragMoved.value = false

  selectCell(r, c, event.shiftKey)
  if (event.shiftKey) {
    pressedCell.value = null // shift 点击只扩选，不进入编辑
  } else if (lastPointerType !== 'touch') {
    dragging.value = true // mouse：按住拖动框选
  }
  // touch：dragging 不置位 → 拖动交给浏览器原生滚动，pressedCell 保留
  // （pointerup 后的 mouseup 走「点按直接进入编辑」路径）；
  // 触屏扩选走右下角填充柄（touch-action:none）
}

function handleCellMouseEnter(r: number, c: number): void {
  if (!dragging.value || isReadonly.value) return
  if (focus.value.r !== r || focus.value.c !== c) {
    dragMoved.value = true
  }
  focus.value = { r, c }
}

function handleGlobalMouseUp(): void {
  handleResizeEnd() // 列宽/行高拖拽结算（不依赖选区状态）
  dragging.value = false
  // 触屏点按（未拖动、非 shift）→ 选中并直接进入编辑（移动端无双击语义，且便于 IME）
  // 鼠标单击只选中，进入编辑由双击触发（传统 Excel 行为）
  const pressed = pressedCell.value
  pressedCell.value = null
  if (!pressed || dragMoved.value) return
  if (lastPointerType !== 'touch') return
  if (pressed.r === focus.value.r && pressed.c === focus.value.c && !isReadonly.value) {
    startEdit()
  }
}

/** 双击单元格进入编辑（传统 Excel 行为） */
function handleCellDblClick(event: MouseEvent): void {
  if (isReadonly.value) return
  event.preventDefault()
  startEdit()
}

/** 记录最近指针类型（mouse/touch），供点按/双击行为分流 */
function handlePointerDown(event: PointerEvent): void {
  lastPointerType = event.pointerType || 'mouse'
}

function startEdit(initial?: string): void {
  if (isReadonly.value || !model) return
  const { r, c } = focus.value
  draft.value = initial !== undefined ? initial : cellRaw(r, c)
  editing.value = { r, c }
  // 不默认全选：光标置末尾，避免进入编辑即覆盖原内容（直接键入场景
  // draft 已被初始字符替换，同样无需全选）
  void nextFocus()
}

function nextFocus(): void {
  setTimeout(() => {
    const input = document.querySelector<HTMLInputElement>('input.cell-editor')
    if (!input) return
    input.focus()
    const end = input.value.length
    input.setSelectionRange(end, end)
    // 触屏：编辑框可能落在视口/键盘遮挡区外，nearest 只在不可见时滚（桌面无感）
    input.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, 0)
}

function commitEdit(): void {
  if (!editing.value || !model) return
  const { r, c } = editing.value
  // 视口补出的空白行提交空内容时不落库，避免 ensureRow 误垫出空数据行
  if (draft.value === '' && r >= model.rowCount) {
    editing.value = null
    return
  }
  model.setCell(r, c, draft.value)
  editing.value = null
}

function cancelEdit(): void {
  editing.value = null
}

function moveFocus(dRow: number, dCol: number, extend = false): void {
  let r: number
  let c: number

  const start = model?.getMergeAt(focus.value.r, focus.value.c)
  if (start) {
    // 已在合并区内：沿移动方向一步跨出整块（否则会在覆盖格间原地打转）
    r = dRow > 0 ? start.r2 + 1 : dRow < 0 ? start.r1 - 1 : focus.value.r
    c = dCol > 0 ? start.c2 + 1 : dCol < 0 ? start.c1 - 1 : focus.value.c
  } else {
    r = focus.value.r + dRow
    c = focus.value.c + dCol
  }

  r = Math.min(Math.max(r, 0), Math.max(displayRows.value - 1, 0))
  c = Math.min(Math.max(c, 0), displayCols.value - 1)

  // 落入合并区（外部进入 / 跨出后紧邻另一合并）→ 吸附其锚点
  const landed = model?.getMergeAt(r, c)
  if (landed) {
    r = landed.r1
    c = landed.c1
  }

  if (!extend) anchor.value = { r, c }
  focus.value = { r, c }
  broadcastCell()
}

/** 网格容器键盘处理（编辑态且焦点在 input 时由 input 处理并 stopPropagation） */
function handleGridKeydown(event: KeyboardEvent): void {
  if (editing.value) {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitEdit()
      moveFocus(1, 0)
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdit()
    } else if (
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      document.activeElement?.tagName !== 'INPUT'
    ) {
      // input 尚未获得焦点时的字符兜底（focus 竞态不丢键）
      event.preventDefault()
      draft.value += event.key
    }
    return
  }
  const navOnly =
    ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) ||
    (event.shiftKey && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(event.key))
  if (isReadonly.value && !navOnly) return

  switch (event.key) {
    case 'ArrowUp':
      event.preventDefault()
      moveFocus(-1, 0, event.shiftKey)
      break
    case 'ArrowDown':
      event.preventDefault()
      moveFocus(1, 0, event.shiftKey)
      break
    case 'ArrowLeft':
      event.preventDefault()
      moveFocus(0, -1, event.shiftKey)
      break
    case 'ArrowRight':
      event.preventDefault()
      moveFocus(0, 1, event.shiftKey)
      break
    case 'Enter':
      event.preventDefault()
      moveFocus(1, 0)
      break
    case 'Tab':
      event.preventDefault()
      moveFocus(0, event.shiftKey ? -1 : 1)
      break
    case 'F2':
      event.preventDefault()
      startEdit()
      break
    default:
      if (
        !isReadonly.value &&
        event.key.length === 1 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        event.preventDefault()
        startEdit(event.key)
      }
  }
}

function handleEditKeydown(event: KeyboardEvent): void {
  event.stopPropagation()
  if (event.key === 'Enter') {
    event.preventDefault()
    commitEdit()
    moveFocus(1, 0)
  } else if (event.key === 'Tab') {
    event.preventDefault()
    commitEdit()
    moveFocus(0, event.shiftKey ? -1 : 1)
  } else if (event.key === 'Escape') {
    event.preventDefault()
    cancelEdit()
  }
}

/* ---------------- 样式 ---------------- */

const TEXT_COLORS = ['#1f2329', '#d03050', '#f0883e', '#18a058', '#2080f0', '#9575cd']
const BG_COLORS = ['#fff3bf', '#d3f9d8', '#d0ebff', '#ffe3e3', '#e5dbff', '#f1f3f5']

/** 对选区内所有格应用样式补丁（apply 为函数以支持 toggle 语义） */
type StylePatch = Parameters<SheetModel['applyStyle']>[2]

function applyToSelection(mutate: (get: (r: number, c: number) => CellStyle, set: (r: number, c: number, patch: StylePatch) => void) => void): void {
  if (!model || isReadonly.value) return
  model.transact(() => {
    const get = (r: number, c: number) => model!.getStyle(r, c)
    const set = (r: number, c: number, patch: StylePatch) => model!.applyStyle(r, c, patch)
    mutate(get, set)
  })
}

function toggleBold(): void {
  if (!model || isReadonly.value) return
  const rg = range.value
  let allBold = true
  for (let r = rg.r1; r <= rg.r2; r++) {
    for (let c = rg.c1; c <= rg.c2; c++) {
      if (!model.getStyle(r, c).b) allBold = false
    }
  }
  applyToSelection((_get, set) => {
    for (let r = rg.r1; r <= rg.r2; r++) {
      for (let c = rg.c1; c <= rg.c2; c++) {
        set(r, c, { b: allBold ? null : 1 })
      }
    }
  })
}

function applyStyleToSelection(patch: StylePatch): void {
  const rg = range.value
  applyToSelection((_get, set) => {
    for (let r = rg.r1; r <= rg.r2; r++) {
      for (let c = rg.c1; c <= rg.c2; c++) {
        set(r, c, patch)
      }
    }
  })
}

const selectionBold = computed(() => {
  void dataRevision.value
  const rg = range.value
  if (!model) return false
  for (let r = rg.r1; r <= rg.r2; r++) {
    for (let c = rg.c1; c <= rg.c2; c++) {
      if (!model.getStyle(r, c).b) return false
    }
  }
  return model.rowCount > 0
})

/* ---------------- 合并单元格操作 ---------------- */

/** 选区与已有合并相交（按钮激活态；选区落在合并内时点击 = 取消合并） */
const selectionMerged = computed(() => {
  void dataRevision.value
  const rg = range.value
  return model?.intersectsMerge(rg.r1, rg.c1, rg.r2, rg.c2) ?? false
})

/** 单格且未合并 → 合并无从谈起，按钮禁用 */
const mergeActionDisabled = computed(() => {
  const rg = range.value
  return isReadonly.value || (!selectionMerged.value && rg.r1 === rg.r2 && rg.c1 === rg.c2)
})

function toggleMergeSelection(): void {
  if (!model || isReadonly.value) return
  const rg = range.value
  // range 已经合并扩张：选区恰等于某合并 → toggle 取消它；否则合并（吞掉相交旧合并）
  model.transact(() => {
    model!.toggleMerge(rg)
  })
  // observe → dataRevision 自动 bump，重渲染与快照通知走既有管线
}

/* ---------------- 填充柄（选区右下角拖拽扩选，触屏扩选唯一入口） ---------------- */

/** 滚动/尺寸变化会移动填充柄的 DOM 位置，用 tick 失效重新测量 */
const fillTick = ref(0)

function onGridScroll(): void {
  fillTick.value++
}

/** 填充柄锚在选区右下角格的外缘；测量走真实 rect（行列尺寸可变 + 表头偏移） */
const fillHandlePos = computed<{ top: number; left: number } | null>(() => {
  void fillTick.value
  void dataRevision.value
  void range.value
  const wrap = gridWrapRef.value
  if (!wrap) return null

  const rg = range.value
  // 右下角格可能被合并吞掉 → 找覆盖它的锚点 td（range 已整块扩张，
  // 被覆盖说明该合并的右下角恰好就是 rg 的右下角）
  let el = wrap.querySelector<HTMLElement>(`td[data-r="${rg.r2}"][data-c="${rg.c2}"]`)
  if (!el) {
    const m = mergeAnchorAt(rg.r2, rg.c2)
    if (m) el = wrap.querySelector<HTMLElement>(`td[data-r="${m.r1}"][data-c="${m.c1}"]`)
  }
  if (!el) return null

  const wr = wrap.getBoundingClientRect()
  const cr = el.getBoundingClientRect()
  return {
    // 半压在右下角边线上（Excel 样式），减 4 让柄心对准角点
    top: cr.bottom - wr.top + wrap.scrollTop - 4,
    left: cr.right - wr.left + wrap.scrollLeft - 4,
  }
})

let fillDragging = false

function startFillDrag(event: PointerEvent): void {
  if (event.button !== 0 || !event.isPrimary) return
  event.preventDefault()
  // 柄自身 touch-action:none（CSS），捕获后 touchmove 全部落到柄上，不触发页面滚动
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  fillDragging = true
}

function handleFillMove(event: PointerEvent): void {
  if (!fillDragging || !event.isPrimary) return
  const el = document.elementFromPoint(event.clientX, event.clientY)?.closest('td[data-r]')
  if (!el) return
  const r = Number(el.getAttribute('data-r'))
  const c = Number(el.getAttribute('data-c'))
  if (!Number.isFinite(r) || !Number.isFinite(c)) return
  const snap = snapToAnchor(r, c)
  if (focus.value.r !== snap.r || focus.value.c !== snap.c) {
    focus.value = snap // anchor 固定，focus 拖到哪扩到哪（合并整块参与）
    dragMoved.value = true
  }
}

function endFillDrag(): void {
  if (!fillDragging) return
  fillDragging = false
  broadcastCell()
}

/* ---------------- 虚拟键盘避让 ---------------- */

/** 键盘弹起会遮住编辑框：visualViewport 收缩时把编辑框重新居中可见 */
function handleViewportResize(): void {
  if (!editing.value) return
  document
    .querySelector<HTMLInputElement>('input.cell-editor')
    ?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

/* ---------------- 行列操作 ---------------- */

function handleRowMenu(key: string): void {
  if (!model || isReadonly.value) return
  const r = focus.value.r
  model.transact(() => {
    if (key === 'insertAbove') model!.insertRow(r)
    else if (key === 'insertBelow') model!.insertRow(r + 1)
    else if (key === 'delete') model!.deleteRow(r)
  })
  dataRevision.value++
}

function handleColMenu(key: string): void {
  if (!model || isReadonly.value) return
  const c = focus.value.c
  model.transact(() => {
    if (key === 'insertLeft') model!.insertCol(c)
    else if (key === 'insertRight') model!.insertCol(c + 1)
    else if (key === 'delete') model!.deleteCol(c)
  })
  dataRevision.value++
}

const rowMenuOptions = computed(() => [
  { key: 'insertAbove', label: t('toolbar.tableAddRowBefore') },
  { key: 'insertBelow', label: t('toolbar.tableAddRowAfter') },
  { type: 'divider' as const, key: 'd1' },
  { key: 'delete', label: t('toolbar.tableDeleteRow'), props: { style: 'color: #d03050' } },
])
const colMenuOptions = computed(() => [
  { key: 'insertLeft', label: t('toolbar.tableAddColBefore') },
  { key: 'insertRight', label: t('toolbar.tableAddColAfter') },
  { type: 'divider' as const, key: 'd1' },
  { key: 'delete', label: t('toolbar.tableDeleteCol'), props: { style: 'color: #d03050' } },
])

/* ---------------- 协同光标 ---------------- */

const remoteCursors = ref<Map<string, { name: string; color: string }>>(new Map())

function remoteCursorAt(r: number, c: number): { name: string; color: string } | undefined {
  return remoteCursors.value.get(`${r},${c}`)
}

function refreshPresence(): void {
  const awareness = provider?.awareness
  if (!provider || !awareness) return
  const seen = new Map<string, Collaborator>()
  const cursors = new Map<string, { name: string; color: string }>()
  const myId = awareness.clientID

  awareness.getStates().forEach((state, clientId) => {
    const typed = state as { user?: Collaborator; cell?: { r: number; c: number } }
    if (typed.user?.name) {
      if (!seen.has(typed.user.name)) {
        seen.set(typed.user.name, { name: typed.user.name, color: typed.user.color ?? '#888' })
      }
      if (clientId !== myId && typed.cell) {
        cursors.set(`${typed.cell.r},${typed.cell.c}`, {
          name: typed.user.name,
          color: typed.user.color ?? '#888',
        })
      }
    }
  })

  collaborators.value = Array.from(seen.values())
  remoteCursors.value = cursors
}

/** 远端光标格的自定义属性：徽标底色取该用户自己的 awareness 颜色 */
function remoteCursorStyle(r: number, c: number): Record<string, string> {
  const cursor = remoteCursorAt(r, c)
  return cursor?.color ? { '--remote-color': cursor.color } : {}
}

/** 向协同伙伴播报当前焦点格 */
function broadcastCell(): void {
  provider?.awareness?.setLocalStateField('cell', { r: focus.value.r, c: focus.value.c })
}

/**
 * 头像堆的可访问名称。
 * Lighthouse 的 label-content-name-mismatch 要求「可见文本 ⊆ 可访问名称」，
 * 而堆里的头像首字与 +N 是动态的，只能同样动态地拼进去。
 */
const avatarStackLabel = computed(() => {
  const heads = collaborators.value.slice(0, 4).map((p) => p.name.slice(0, 1)).join('')
  const extra = collaborators.value.length > 4 ? `+${collaborators.value.length - 4}` : ''
  return t('editor.avatarStack', { initials: heads, extra })
})

const userColor = computed(() => colorOf(auth.user?.name))

/* ---------------- 顶栏动作 ---------------- */

async function handleRename(): Promise<void> {
  const title = titleEditing.value.trim()
  if (!canRename.value) {
    titleEditing.value = meta.value?.title ?? ''
    return
  }
  if (!meta.value || !title || title === meta.value.title) {
    titleEditing.value = meta.value?.title ?? ''
    return
  }
  try {
    const { data } = await api.put(`/documents/${docId.value}`, { title })
    const updated: DocumentMeta = data.data
    meta.value = updated
    titleEditing.value = updated.title
  } catch (error) {
    titleEditing.value = meta.value?.title ?? ''
    message.error(getApiErrorMessage(error))
  }
}

/** 版本快照：取当前稠密网格 */
function captureSnapshot(): { grid: ReturnType<SheetModel['toGrid']>; meta?: SheetMeta } | null {
  if (!model) return null
  void dataRevision.value
  const meta = model.getMetaSnapshot()
  return Object.keys(meta).length > 0 ? { grid: model.toGrid(), meta } : { grid: model.toGrid() }
}

/** 内容停更 60s 后自动存一版（只读时不存） */
const autoSnapshot = useAutoSnapshot({
  documentId: () => docId.value,
  enabled: () => !isReadonly.value,
  capture: () => {
    const snapshot = captureSnapshot()
    if (!snapshot) return null
    return { content_json: snapshot, content_html: gridToHtml(snapshot.grid) }
  },
})

/**
 * 版本恢复：整体替换网格与 meta（协同广播给所有端）。
 * meta 缺省（旧快照）时保持现有尺寸与条件格式，避免恢复把界面配置抹平。
 */
function restoreSnapshot(grid: ReturnType<SheetModel['toGrid']>, meta?: SheetMeta): void {
  if (!model || isReadonly.value) return
  model.replaceGrid(grid)
  model.applyMetaSnapshot(meta)
  dataRevision.value++
  scheduleRefreshCover()
}

async function handleExport(): Promise<void> {
  if (exporting.value || !model) return
  exporting.value = true
  const title = meta.value?.title?.trim() || t('excel.untitled')
  try {
    void dataRevision.value
    await exportGridToXlsx(model.toGrid(), title)
    message.success(t('excel.exportedXlsx'))
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    exporting.value = false
  }
}

function handleKeydown(event: KeyboardEvent): void {
  // 跟随态：Esc 优先退出（不 preventDefault，Naive 弹层仍照常关闭）
  if (event.key === 'Escape' && followName.value) {
    followName.value = null
    return
  }

  const target = event.target as HTMLElement | null
  const typing =
    !!target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable)

  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    if (!commentDrawerVisible.value) {
      event.preventDefault()
      commentDrawerVisible.value = true
    }
    return
  }

  if (!typing && event.key === '?') {
    event.preventDefault()
    helpVisible.value = !helpVisible.value
  }
}

/* ---------------- 生命周期 ---------------- */

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  window.addEventListener('mouseup', handleGlobalMouseUp)
  // resize / 触屏拖拽走 pointer 事件（一套同时覆盖 mouse + touch + pen）
  window.addEventListener('pointermove', handlePointerMoveForResize)
  window.addEventListener('pointerup', handlePointerEnd)
  window.addEventListener('pointercancel', handlePointerEnd)
  window.addEventListener('pointerdown', handlePointerDown, true)
  window.visualViewport?.addEventListener('resize', handleViewportResize)

  try {
    if (isShare.value) {
      // 访客：meta 已由 ShareView 传入（分享端点访客专用，不会 401）
      if (meta.value) {
        titleEditing.value = meta.value.title
        document.title = `${meta.value.title} · ${t('shell.appTitle')}`
      }
    } else {
      const { data } = await api.get(`/documents/${docId.value}`)
      const loaded: DocumentMeta = data.data
      meta.value = loaded
      titleEditing.value = loaded.title
      document.title = `${loaded.title} · ${t('shell.appTitle')}`

      // 防呆：md 文档误入表格路由
      if ((loaded.type ?? 'md') === 'md') {
        await router.replace(`/doc/${loaded.id}`)
        return
      }
    }
  } catch (error) {
    message.error(getApiErrorMessage(error))
    // 访客态没有首页权限，跳过去只会被路由守卫踢回登录
    if (!isShare.value) await router.replace('/')
    return
  } finally {
    loading.value = false
  }

  watch(
    () => meta.value?.title,
    (title) => {
      document.title = title ? `${title} · ${t('shell.appTitle')}` : t('shell.appTitle')
    },
  )

  // P0-2：新建来源进入时聚焦标题（用户已交互则不抢焦点）
  if (route.query.new !== undefined) {
    await nextTick()
    const active = document.activeElement
    const inTitle = titleInputRef.value?.$el?.contains(active ?? null) ?? false
    if (!active || active === document.body || inTitle) {
      titleInputRef.value?.$el?.querySelector('input')?.focus()
    }
    void router.replace({ query: {} })
  }

  // 评论未读徽标（访客无权读评论，跳过 —— 调用会 401）
  if (!isShare.value) {
    try {
      const { data } = await api.get(`/documents/${docId.value}/comments/unread`)
      unreadComments.value = data.data.count
    } catch {
      unreadComments.value = 0
    }
  }

  // 协作连接令牌：访客走分享端点（viewer 只读），成员走已鉴权端点
  let collabToken = ''
  try {
    if (isShare.value) {
      const { data } = await api.get<never, { data: { data: CollabTokenData } }>(
        `/share/${props.shareToken}/collab-token`,
      )
      collabToken = data.data.token
    } else {
      const { data } = await api.post<never, { data: { data: CollabTokenData } }>(
        `/documents/${docId.value}/collab-token`,
      )
      collabToken = data.data.token
    }
  } catch (error) {
    message.error(getApiErrorMessage(error))
    if (!isShare.value) await router.replace('/')
    return
  }

  ydoc = new Y.Doc()
  model = new SheetModel(ydoc)

  provider = new HocuspocusProvider({
    url: getCollabUrl(),
    name: `doc-${docId.value}`,
    document: ydoc,
    token: collabToken,
  })

  provider.on('status', (event: { status: 'connecting' | 'connected' | 'disconnected' }) => {
    connectionStatus.value = event.status
    if (event.status !== 'connected') {
      synced.value = false
      syncTick.value++
    }
  })
  provider.on('synced', () => {
    synced.value = provider?.synced ?? false
    syncTick.value++
  })
  provider.on('unsyncedChanges', () => {
    syncTick.value++
  })

  // awareness：先播报用户，再跟随焦点播报单元格
  provider.awareness?.setLocalStateField('user', {
    name: auth.user?.name ?? (isShare.value ? t('editor.guest') : t('editor.anonymous')),
    color: userColor.value,
  })
  provider.awareness?.on('change', () => {
    refreshPresence()
    applyFollow()
  })
  refreshPresence()

  stopObserve = model.observe(() => {
    dataRevision.value++
    scheduleRefreshCover() // 列宽/行高/行列结构变化都会走这里
    autoSnapshot.notifyChange()
  })

  // 同步完成后：旧版 cells 迁移 + 导入种子 / 新文档补初始行
  const applyAfterSync = () => {
    if (!model) return
    model.migrateLegacyCells()

    const pending = importFlow.consumePending()
    if (pending && pending.kind === 'excel' && !isReadonly.value) {
      model.fillFromCells(pending.cells)
    } else if (pending && pending.kind !== 'excel') {
      console.warn('[sheet]忽略非 excel 导入载荷')
    }

    // 空文档补默认行（单客户端、仅一次）
    if (model.rowCount === 0) {
      model.seedRows()
    }
    dataRevision.value++
    broadcastCell()
    ready.value = true
  }

  if (provider.synced) {
    applyAfterSync()
  } else {
    const onSynced = () => {
      provider?.off('synced', onSynced)
      applyAfterSync()
    }
    provider.on('synced', onSynced)
  }

  // 搜索跳转：等 seed/迁移完成后（ready）再找
  if (route.query.find) {
    const runFind = () => {
      if (ready.value) jumpToFind()
      else setTimeout(runFind, 60)
    }
    setTimeout(runFind, 60)
  }
})

/**
 * 从搜索列表带着 `?find=` 进来时，选中首个命中的单元格并滚动到位。
 * 找不到静默（索引最终一致，可能已过期）。
 */
function jumpToFind(): void {
  const raw = route.query.find
  const query = typeof raw === 'string' ? raw.trim() : ''
  if (!query || !model) return

  const needle = query.toLowerCase()
  const rows = model.rowCount
  const cols = Math.max(model.colCount, 1)

  let hit: { r: number; c: number } | null = null
  for (let r = 0; r < rows && !hit; r++) {
    for (let c = 0; c < cols; c++) {
      if (cellRaw(r, c).toLowerCase().includes(needle)) {
        hit = { r, c }
        break
      }
    }
  }

  if (hit) {
    selectCell(hit.r, hit.c)
    nextTick(() => {
      const el = gridWrapRef.value
      if (!el) return
      // 让命中行居中：单元格是规则网格，用行高常量估算即可
      const top = hit!.r * CELL_H
      el.scrollTop = Math.max(0, top - el.clientHeight / 2)
      el.focus()
    })
  }

  const rest = { ...route.query }
  delete rest.find
  void router.replace({ query: rest })
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('mouseup', handleGlobalMouseUp)
  window.removeEventListener('pointermove', handlePointerMoveForResize)
  window.removeEventListener('pointerup', handlePointerEnd)
  window.removeEventListener('pointercancel', handlePointerEnd)
  window.removeEventListener('pointerdown', handlePointerDown, true)
  window.visualViewport?.removeEventListener('resize', handleViewportResize)
  coverObserver?.disconnect()
  coverObserver = null
  stopObserve?.()
  provider?.destroy()
  ydoc?.destroy()
  provider = null
  ydoc = null
  model = null
  document.title = t('shell.appTitle')
})
</script>

<template>
  <div class="sheet-page">
    <a href="#main" class="skip-link">{{ $t('excel.skipToMain') }}</a>
    <div class="sheet-topbar">
      <n-space align="center" size="large">
        <n-button quaternary :aria-label="$t('editor.backToListAria')" @click="router.push('/')">{{ $t('editor.backToList') }}</n-button>
        <n-input
          ref="titleInputRef"
          v-model:value="titleEditing"
          class="title-input"
          :placeholder="$t('excel.untitled')"
          :readonly="!canRename"
          :aria-label="canRename ? $t('excel.titleEditAria') : $t('excel.titleReadonlyAria')"
          @blur="handleRename"
          @keyup.enter="($event.target as HTMLInputElement).blur()"
         name="sheet-title" id="sheet-title" />
        <n-tag size="small" type="success" round>{{ $t('excel.sheetTag') }}</n-tag>
        <n-tag v-if="isReadonly" size="small" type="warning" round>{{ $t('editor.readonlyTag') }}</n-tag>
      </n-space>
      <n-space align="center" size="small" :wrap="true">
        <ThemeToggle />
        <n-button quaternary size="small" :aria-label="$t('editor.helpAria')" @click="helpVisible = true">?</n-button>
        <n-button v-if="canRename" quaternary size="small" @click="shareVisible = true">{{ $t('editor.shareBtn') }}</n-button>
        <n-button
          quaternary
          size="small"
          :loading="exporting"
          :aria-label="$t('editor.exportAria')"
          @click="handleExport"
        >
          {{ $t('excel.exportBtn') }}
        </n-button>
        <n-button v-if="!isShare" quaternary size="small" @click="versionDrawerVisible = true">{{ $t('excel.versionsBtn') }}</n-button>
        <!-- 访客无权读评论/版本（接口会 401），两个入口整体隐藏 -->
        <n-badge v-if="!isShare" :value="unreadComments" :max="99" :show="unreadComments > 0">
          <n-button quaternary size="small" @click="commentDrawerVisible = true">{{ $t('editor.commentsBtn') }}</n-button>
        </n-badge>

        <n-popover trigger="click" placement="bottom-end">
          <template #trigger>
            <div
              class="avatar-stack"
              role="button"
              tabindex="0"
              :aria-label="avatarStackLabel"
              @keydown.enter.prevent="($event.currentTarget as HTMLElement).click()"
              @keydown.space.prevent="($event.currentTarget as HTMLElement).click()"
            >
              <n-avatar
                v-for="person in collaborators.slice(0, 4)"
                :key="person.name"
                round
                :size="26"
                :color="person.color"
                style="margin-left: -6px; border: 1.5px solid #fff"
              >
                {{ person.name.slice(0, 1) }}
              </n-avatar>
              <n-avatar
                v-if="collaborators.length > 4"
                round
                :size="26"
                color="#909399"
                style="margin-left: -6px; border: 1.5px solid #fff"
              >
                +{{ collaborators.length - 4 }}
              </n-avatar>
            </div>
          </template>
          <n-space vertical size="small">
            <n-text depth="3" style="font-size: 12px">{{ $t('editor.collaboratorsOnline', { count: collaborators.length }) }}</n-text>
            <n-space
              v-for="person in collaborators"
              :key="person.name"
              align="center"
              size="small"
              justify="space-between"
              style="width: 100%"
            >
              <n-space align="center" size="small">
                <n-avatar round :size="22" :color="person.color">{{ person.name.slice(0, 1) }}</n-avatar>
                <n-text>{{ person.name }}</n-text>
              </n-space>
              <n-button
                size="tiny"
                quaternary
                :type="followName === person.name ? 'primary' : 'default'"
                @click="toggleFollow(person.name)"
              >
                {{ followName === person.name ? $t('editor.followingBtn') : $t('editor.followBtn') }}
              </n-button>
            </n-space>
          </n-space>
        </n-popover>

        <n-tag
          v-if="followName"
          size="small"
          type="info"
          round
          closable
          @close="followName = null"
        >
          {{ $t('editor.followBar', { name: followName }) }}
        </n-tag>

        <span role="status" aria-live="polite" class="sync-status">
          <n-tag v-if="connectionStatus !== 'connected'" :type="statusType" size="small" round>
            {{ statusText }}
          </n-tag>
          <n-tag v-else-if="!synced || hasUnsynced" type="info" size="small" round>
            {{ $t('editor.syncing') }}
          </n-tag>
          <n-tag v-else type="success" size="small" round>{{ $t('editor.syncedTag') }}</n-tag>
        </span>
      </n-space>
    </div>

    <!-- 格式与行列工具条 -->
    <div class="format-bar">
      <n-space align="center" size="small" :wrap="true">
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              size="tiny"
              quaternary
              :type="selectionBold ? 'primary' : 'default'"
              :disabled="isReadonly"
              :aria-label="$t('toolbar.bold')"
              @click="toggleBold"
            >
              <strong>B</strong>
            </n-button>
          </template>
          {{ $t('toolbar.bold') }}
        </n-tooltip>

        <n-dropdown :options="TEXT_COLORS.map((c) => ({ key: c, label: 'A', props: { style: `color:${c}` } }))"
          :disabled="isReadonly"
          @select="(key: string) => applyStyleToSelection({ c: key })"
        >
          <n-button size="tiny" quaternary :disabled="isReadonly" :aria-label="$t('toolbar.colorAria')">{{ $t('excel.colorBtn') }}</n-button>
        </n-dropdown>
        <n-dropdown
          :options="[
            ...BG_COLORS.map((c) => ({ key: c, label: '　', props: { style: `background:${c}` } })),
            { key: 'clear', label: t('excel.clearBg') },
          ]"
          :disabled="isReadonly"
          @select="(key: string) => applyStyleToSelection({ bg: key === 'clear' ? null : key })"
        >
          <n-button size="tiny" quaternary :disabled="isReadonly" :aria-label="$t('excel.bgColorAria')">{{ $t('excel.bgColorBtn') }}</n-button>
        </n-dropdown>

        <n-divider vertical />

        <n-button size="tiny" quaternary :disabled="isReadonly" :aria-label="$t('toolbar.alignLeftAria')" @click="applyStyleToSelection({ al: 'left' })">{{ $t('toolbar.alignLeft') }}</n-button>
        <n-button size="tiny" quaternary :disabled="isReadonly" :aria-label="$t('toolbar.alignCenterAria')" @click="applyStyleToSelection({ al: 'center' })">{{ $t('toolbar.alignCenter') }}</n-button>
        <n-button size="tiny" quaternary :disabled="isReadonly" :aria-label="$t('toolbar.alignRightAria')" @click="applyStyleToSelection({ al: 'right' })">{{ $t('toolbar.alignRight') }}</n-button>

        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              size="tiny"
              quaternary
              :type="selectionMerged ? 'primary' : 'default'"
              :disabled="mergeActionDisabled"
              :aria-label="$t('excel.mergeAria')"
              @click="toggleMergeSelection"
            >
              {{ $t('excel.mergeBtn') }}
            </n-button>
          </template>
          {{ selectionMerged ? $t('excel.unmergeTip') : $t('excel.mergeTip') }}
        </n-tooltip>

        <n-divider vertical />

        <n-popover trigger="click" placement="bottom" v-model:show="cfVisible">
          <template #trigger>
            <n-button size="tiny" quaternary :disabled="isReadonly" :aria-label="$t('excel.cfAria')">{{ $t('excel.cfBtn') }}</n-button>
          </template>

          <div class="cf-panel">
            <div class="cf-row">
              <n-select
                v-model:value="cfOp"
                :options="CF_OP_OPTIONS"
                size="small"
                :aria-label="$t('excel.cfAria')"
                style="width: 130px"
               name="cf-op" id="cf-op" />
              <n-input
                v-model:value="cfValue"
                size="small"
                :placeholder="$t('excel.cfValue')"
                :aria-label="$t('excel.cfValue')"
                style="width: 110px"
                @keyup.enter="applyCfRule"
               name="cf-value" id="cf-value" />
              <n-input
                v-if="cfOp === 'between'"
                v-model:value="cfValue2"
                size="small"
                :placeholder="$t('excel.cfValue2')"
                :aria-label="$t('excel.cfValue2Aria')"
                style="width: 110px"
                @keyup.enter="applyCfRule"
               name="cf-value2" id="cf-value2" />
            </div>

            <div class="cf-row" style="align-items: center">
              <span class="cf-label">{{ $t('excel.backgroundLabel') }}</span>
              <span
                v-for="color in CF_COLORS"
                :key="color"
                class="cf-swatch"
                :class="{ active: cfBg === color }"
                :style="{ background: color }"
                role="radio"
                :aria-checked="cfBg === color"
                :aria-label="t('excel.bgSwatchAria', { color })"
                @click="cfBg = color"
              />
              <n-checkbox v-model:checked="cfBold" size="small" name="cf-bold" id="cf-bold">{{ $t('excel.cfBold') }}</n-checkbox>
            </div>

            <div class="cf-row">
              <n-text depth="3" style="font-size: 12px">
                {{ $t('excel.cfApplyTo', { range: `${columnLabel(range.c1)}${range.r1 + 1}:${columnLabel(range.c2)}${range.r2 + 1}` }) }}
              </n-text>
              <n-button type="primary" size="tiny" @click="applyCfRule">{{ $t('excel.cfApply') }}</n-button>
            </div>

            <template v-if="Object.keys(cfRules).length > 0">
              <n-divider style="margin: 8px 0" />
              <div class="cf-list">
                <div v-for="(rule, id) in cfRules" :key="id" class="cf-item">
                  <span class="cf-swatch" :style="{ background: rule.style.bg ?? '#fff' }" />
                  <n-text style="font-size: 12px; flex: 1; min-width: 0">
                    {{ cfRuleRange(rule) }} {{ cfRuleLabel(rule) }}
                  </n-text>
                  <n-button
                    size="tiny"
                    quaternary
                    type="error"
                    :disabled="isReadonly"
                    :aria-label="$t('excel.cfDeleteRuleAria')"
                    @click="removeCfRule(String(id))"
                  >
                    {{ $t('common.delete') }}
                  </n-button>
                </div>
              </div>
            </template>
          </div>
        </n-popover>

        <n-dropdown :options="rowMenuOptions" :disabled="isReadonly" @select="handleRowMenu">
          <n-button size="tiny" quaternary :disabled="isReadonly" :aria-label="$t('excel.rowMenuAria')">{{ $t('excel.rowMenuAria') }}</n-button>
        </n-dropdown>
        <n-dropdown :options="colMenuOptions" :disabled="isReadonly" @select="handleColMenu">
          <n-button size="tiny" quaternary :disabled="isReadonly" :aria-label="$t('excel.colMenuAria')">{{ $t('excel.colMenuAria') }}</n-button>
        </n-dropdown>

        <n-divider vertical />
        <n-text depth="3" style="font-size: 12px">
          {{ $t('excel.selectionStatus', { cell: `${columnLabel(focus.c)}${focus.r + 1}` }) }}
          <template v-if="range.r1 !== range.r2 || range.c1 !== range.c2">
            {{ $t('excel.cellCount', { count: (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1) }) }}
          </template>
          {{ $t('excel.formulaHint') }}
        </n-text>
      </n-space>
    </div>

    <div v-if="loading || !ready" class="sheet-loading">
      <div class="sheet-surface skeleton-surface">
        <n-skeleton height="24px" width="30%" style="margin-bottom: 16px" />
        <n-skeleton :height="360" :sharp="true" />
      </div>
    </div>

    <!-- sheet-surface 承担 main landmark（本页无可跳过的全局导航） -->
    <div v-else id="main" class="sheet-surface" role="main" tabindex="-1">
      <!-- 滚动容器：role=region 而非 grid —— grid 的直接子级必须是 row/rowgroup，
           这里包着一层 <table>，放 grid 会触发 aria-required-children -->
      <div
        ref="gridWrapRef"
        class="grid-wrap"
        tabindex="0"
        role="region"
        :aria-label="$t('excel.gridRegionAria')"
        @keydown="handleGridKeydown"
        @scroll="onGridScroll"
      >
        <table
          class="sheet-grid"
          :class="{ resizing: resizePreview !== null }"
          role="grid"
          :aria-label="$t('excel.gridAria')"
          :aria-rowcount="displayRows"
          :aria-colcount="displayCols + 1"
        >
          <!-- 列宽由 colgroup 给出（CSS 固定 min-width 会被它取代），
               未自定义的列走默认 96px -->
          <colgroup>
            <col class="corner-col" :style="{ width: `${CORNER_W}px` }" />
            <col
              v-for="c in displayCols"
              :key="`colw-${c}`"
              :style="{ width: `${colWidthOf(c - 1)}px` }"
            />
          </colgroup>
          <thead>
            <tr>
              <th class="corner" scope="col" :aria-label="$t('excel.rowHeaderAria')" />
              <th
                v-for="(label, c) in columnHeaders"
                :key="`col-${c}`"
                scope="col"
                :aria-label="t('excel.colAria', { index: c + 1, label })"
                :class="{
                  'col-active': c >= range.c1 && c <= range.c2,
                }"
              >
                {{ label }}
                <!-- 右边缘拖拽调列宽；双击恢复默认 -->
                <span
                  class="resize-handle col-resize"
                  :aria-hidden="true"
                  :title="$t('excel.colResizeTitle')"
                  @pointerdown="startColResize(c, $event)"
                  @dblclick.stop.prevent="resetColWidth(c)"
                />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="r in displayRows"
              :key="`row-${r}`"
              :style="{ height: `${rowHeightOf(r - 1)}px` }"
            >
              <th
                class="row-head"
                scope="row"
                :aria-label="t('excel.rowAria', { index: r })"
                :class="{ 'row-active': r - 1 >= range.r1 && r - 1 <= range.r2 }"
              >
                {{ r }}
                <!-- 下边缘拖拽调行高；双击恢复默认 -->
                <span
                  class="resize-handle row-resize"
                  :aria-hidden="true"
                  :title="$t('excel.rowResizeTitle')"
                  @pointerdown="startRowResize(r - 1, $event)"
                  @dblclick.stop.prevent="resetRowHeight(r - 1)"
                />
              </th>
              <!-- 合并吞掉的格不渲染：视觉由锚点 td 的 rowspan/colspan 覆盖 -->
              <template v-for="c in displayCols" :key="`cell-${r - 1}-${c - 1}`">
                <td
                  v-if="!isCoveredCell(r - 1, c - 1)"
                  role="gridcell"
                  :data-r="r - 1"
                  :data-c="c - 1"
                  :aria-selected="isSelected(r - 1, c - 1)"
                  :aria-label="`${columnLabel(c - 1)}${r} ${displayValue(r - 1, c - 1)}`"
                  :rowspan="mergeRowspan(r - 1, c - 1)"
                  :colspan="mergeColspan(r - 1, c - 1)"
                  :class="{
                    selected: isSelected(r - 1, c - 1),
                    focus: isFocus(r - 1, c - 1),
                    editing: isEditing(r - 1, c - 1),
                  }"
                  :style="{ ...cellCssStyle(r - 1, c - 1), ...remoteCursorStyle(r - 1, c - 1) }"
                  :data-remote-name="remoteCursorAt(r - 1, c - 1)?.name"
                  @mousedown="handleCellMouseDown(r - 1, c - 1, $event)"
                  @dblclick="handleCellDblClick($event)"
                  @mouseenter="handleCellMouseEnter(r - 1, c - 1)"

                >
                  <input
                    v-if="isEditing(r - 1, c - 1)"
                    v-model="draft"
                    class="cell-editor"
                    name="cell-editor"
                    id="cell-editor"
                    :aria-label="$t('excel.cellAria')"
                    @keydown="handleEditKeydown"
                    @blur="commitEdit"
                  />
                  <template v-else>{{ displayValue(r - 1, c - 1) }}</template>
                </td>
              </template>
            </tr>
          </tbody>
        </table>

        <!-- 选区右下角填充柄：拖拽扩展选区（触屏扩选唯一入口，touch-action:none） -->
        <button
          v-if="fillHandlePos && ready"
          type="button"
          class="fill-handle"
          :style="{ top: `${fillHandlePos.top}px`, left: `${fillHandlePos.left}px` }"
          :aria-label="$t('excel.fillHandleAria')"
          @pointerdown="startFillDrag"
          @pointermove="handleFillMove"
          @pointerup="endFillDrag"
          @pointercancel="endFillDrag"
        />
      </div>
    </div>

    <CommentDrawer
      v-if="!isShare"
      v-model:show="commentDrawerVisible"
      :document-id="docId"
      :can-manage="auth.user?.id === meta?.user_id"
      @read="unreadComments = 0"
    />

    <SheetVersionDrawer
      v-if="!isShare"
      v-model:show="versionDrawerVisible"
      :document-id="docId"
      :readonly="isReadonly"
      :capture="captureSnapshot"
      :restore="restoreSnapshot"
    />

    <ShareModal v-if="!isShare" v-model:show="shareVisible" :document-id="docId" />

    <n-modal v-model:show="helpVisible" preset="card" :title="$t('editor.helpTitle')" style="width: 440px; max-width: 92vw">
      <n-text depth="3" style="display: block; margin-bottom: 12px; font-size: 13px">
        {{ $t('excel.helpIntro') }}
      </n-text>
      <n-table :bordered="false" :single-line="false" size="small">
        <thead>
          <tr><th>{{ $t('editor.helpColKey') }}</th><th>{{ $t('editor.helpColAction') }}</th></tr>
        </thead>
        <tbody>
          <tr><td><kbd>{{ $t('excel.helpKeysArrows') }}</kbd> / <kbd>Tab</kbd></td><td>{{ $t('excel.helpNav') }}</td></tr>
          <tr><td><kbd>{{ $t('excel.helpKeysShiftArrows') }}</kbd></td><td>{{ $t('excel.helpExtend') }}</td></tr>
          <tr><td>{{ $t('excel.helpKeysEdit') }}</td><td>{{ $t('excel.helpEdit') }}</td></tr>
          <tr><td>{{ $t('excel.helpKeysConfirm') }}</td><td>{{ $t('excel.helpConfirmNext') }}</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>{{ $t('excel.helpCancel') }}</td></tr>
          <tr><td><kbd>⌘/Ctrl + ⏎</kbd></td><td>{{ $t('editor.helpOpenComments') }}</td></tr>
          <tr><td><kbd>?</kbd></td><td>{{ $t('editor.helpToggleHelp') }}</td></tr>
        </tbody>
      </n-table>
    </n-modal>
  </div>
</template>

<style scoped>
.sheet-page {
  /* 固定视口高：页面自身不滚动，滚动完全交给内层网格 */
  height: 100vh;
  height: 100dvh; /* 移动端地址栏伸缩时高度跟随 */
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-page);
}
.sheet-topbar {
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px;
  padding-left: calc(16px + env(safe-area-inset-left));
  padding-right: calc(16px + env(safe-area-inset-right));
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
}
.format-bar {
  padding: 6px 16px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-faint);
}
/* 触屏（粗指针）：格式条 tiny 按钮点击区放大到 36px，桌面视觉不变 */
@media (pointer: coarse) {
  .format-bar :deep(.n-button) {
    min-width: 36px;
    min-height: 36px;
  }
}
.title-input {
  width: min(320px, 42vw);
}
.title-input :deep(.n-input__state-border) {
  transition: border-color 0.2s;
}
.title-input:not(:hover):not(.n-input--focus) :deep(.n-input__state-border) {
  border-color: transparent;
}
.sync-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.avatar-stack {
  display: flex;
  align-items: center;
  padding-left: 8px;
  cursor: pointer;
}
.avatar-stack :deep(.n-avatar:first-child) {
  margin-left: 0;
}
.sheet-loading {
  flex: 1;
  display: flex;
  justify-content: center;
  padding-top: 24px;
}
.sheet-surface {
  /* 全屏铺满：去居中卡片，全宽全高白底 */
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  width: 100%;
  background: var(--bg-surface);
  overflow: hidden;
}
.skeleton-surface {
  padding: 32px;
}
.grid-wrap {
  outline: none;
  flex: 1;
  min-height: 0;
  overflow: auto;
  cursor: cell;
  /* 填充柄的绝对定位锚点（滚动时随手柄随内容走） */
  position: relative;
}
.grid-wrap:focus-visible {
  outline: 2px solid #2080f0;
  outline-offset: -2px;
}
.cf-panel {
  width: min(380px, 86vw);
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.cf-row {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
}
.cf-label {
  font-size: 12px;
  color: var(--text-2);
  margin-right: 4px;
}
.cf-swatch {
  width: 18px;
  height: 18px;
  border-radius: 3px;
  border: 1px solid var(--border-strong);
  cursor: pointer;
  display: inline-block;
  flex: none;
}
.cf-swatch.active {
  outline: 2px solid #2080f0;
  outline-offset: 1px;
}
.cf-list {
  max-height: 200px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.cf-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.sheet-grid {
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 13px;
}
/* 尺寸不写死：列宽由 <colgroup> 给出、行高由 <tr :style> 给出，
   这里只保留边框与内边距（写 min-width/height 会盖掉自定义尺寸） */
.sheet-grid th,
.sheet-grid td {
  border: 1px solid var(--border-subtle);
  padding: 0;
  box-sizing: border-box;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.sheet-grid thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg-muted);
  font-weight: 600;
  color: var(--text-2);
  text-align: center;
}
.sheet-grid thead th.corner {
  left: 0;
  z-index: 3;
  width: 48px;
}
.sheet-grid .row-head {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--bg-muted);
  font-weight: 500;
  color: var(--text-2);
  text-align: center;
  width: 48px;
}
/* 表头边缘缩放手柄：平时透明，悬停表头才显现。
   touch-action:none —— 触屏按住手柄拖动调尺寸，不被当成页面滚动 */
.sheet-grid .resize-handle {
  position: absolute;
  background: transparent;
  touch-action: none;
}
.sheet-grid .col-resize {
  top: 0;
  right: -3px;
  width: 7px;
  height: 100%;
  cursor: col-resize;
  z-index: 4;
}
.sheet-grid .row-resize {
  left: 0;
  bottom: -3px;
  width: 100%;
  height: 7px;
  cursor: row-resize;
  z-index: 4;
}
.sheet-grid thead th:hover .resize-handle,
.sheet-grid .row-head:hover .resize-handle,
.sheet-grid .resize-handle:hover {
  background: rgba(32, 128, 240, 0.35);
}
/* 触屏无 hover：手柄常显半透明，否则用户不知道可以拖 */
@media (hover: none) {
  .sheet-grid .resize-handle {
    background: rgba(32, 128, 240, 0.18);
  }
}

/* 选区填充柄（Excel 同款绿色小方块） */
.fill-handle {
  position: absolute;
  width: 8px;
  height: 8px;
  padding: 0;
  border: 1.5px solid #fff;
  background: #18a058;
  border-radius: 2px;
  cursor: crosshair;
  z-index: 6;
  /* 触屏拖柄 = 扩选而非滚动（关键：手势在 pointerdown 时就被系统读走） */
  touch-action: none;
  /* 扩大触点：8px 视觉 + 透明热区 */
  box-shadow: 0 0 0 4px transparent;
}
.fill-handle::after {
  /* 透明点击热区补到 ~20px，手指好按 */
  content: '';
  position: absolute;
  inset: -8px;
}
/* 拖拽中关闭选中与图片拖影，避免误触拖拽选区 */
.sheet-grid.resizing,
.sheet-grid.resizing * {
  user-select: none !important;
}

.sheet-grid th.col-active,
.sheet-grid th.row-active {
  color: #2080f0;
  background: var(--col-active-bg);
}
.sheet-grid td {
  padding: 2px 6px;
  cursor: cell;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  position: relative;
  /* 单元格默认文字色：深色主题下不继承（naive 主题不覆盖原生 table） */
  color: var(--text-1);
}
/* 选区高亮：焦点格加重 */
.sheet-grid td.selected {
  background: rgba(32, 128, 240, 0.08);
}
.sheet-grid td.focus {
  outline: 2px solid #2080f0;
  outline-offset: -2px;
}
.sheet-grid td.editing {
  padding: 0;
}
.cell-editor {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  padding: 2px 6px;
  font: inherit;
  background: var(--bg-surface);
  color: inherit;
}
/* 单元格级协同光标：对端焦点格显示名字角标 */
.sheet-grid td[data-remote-name]::after {
  content: attr(data-remote-name);
  position: absolute;
  top: -1px;
  right: -1px;
  font-size: 10px;
  line-height: 1;
  padding: 1px 4px;
  border-radius: 3px 0 0 3px;
  /* 用该用户自己的 awareness 颜色（原为硬编码的固定粉色，多人时分不清谁是谁） */
  background: var(--remote-color, #f06292);
  color: #fff;
  pointer-events: none;
  z-index: 1;
}
</style>
