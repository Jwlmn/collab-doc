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
import { useImportFlowStore } from '../stores/importFlow'
import { exportGridToXlsx, columnLabel } from '../io/cells'
import { SheetModel, columnLabels, DEFAULT_COLS, type CellStyle } from '../io/sheet-model'
import { evaluateCellDisplay, isFormula } from '../io/formula'
import CommentDrawer from '../components/CommentDrawer.vue'
import SheetVersionDrawer from '../components/SheetVersionDrawer.vue'
import ShareModal from '../components/ShareModal.vue'
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

const PAGE_TITLE = '多人实时协作文档'

const route = useRoute()
const router = useRouter()
const message = useMessage()
const auth = useAuthStore()
const importFlow = useImportFlowStore()

const docId = computed(() => Number(route.params.id))
const meta = ref<DocumentMeta | null>(null)
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
  connectionStatus.value === 'connecting' ? '连接中…' : '已断开',
)
const statusType = computed(() =>
  connectionStatus.value === 'connecting' ? ('warning' as const) : ('error' as const),
)

/* ---------------- 网格状态 ---------------- */

/** 数据版本（SheetModel 深度 observe 驱动重渲染） */
const dataRevision = ref(0)

const MIN_COLS = DEFAULT_COLS

/** 显示行数 = 结构行数；显示列数 = max(最小列, 数据边界+余量) */
const displayRows = computed(() => {
  void dataRevision.value
  return model?.rowCount ?? 0
})

const displayCols = computed(() => {
  void dataRevision.value
  if (!model) return MIN_COLS
  return Math.max(MIN_COLS, model.colCount + 3)
})

const columnHeaders = computed(() => columnLabels(displayCols.value))

/** 选区：anchor 固定，focus 随点击/拖拽/键盘移动 */
const anchor = ref({ r: 0, c: 0 })
const focus = ref({ r: 0, c: 0 })
const dragging = ref(false)

const range = computed(() => ({
  r1: Math.min(anchor.value.r, focus.value.r),
  r2: Math.max(anchor.value.r, focus.value.r),
  c1: Math.min(anchor.value.c, focus.value.c),
  c2: Math.max(anchor.value.c, focus.value.c),
}))

const editing = ref<{ r: number; c: number } | null>(null)
const draft = ref('')
/** mousedown 起点与是否发生拖动（区分「点选进入编辑」与「拖拽框选」） */
const pressedCell = ref<{ r: number; c: number } | null>(null)
const dragMoved = ref(false)

function cellRaw(r: number, c: number): string {
  void dataRevision.value
  return model?.getRaw(r, c) ?? ''
}

function cellStyle(r: number, c: number): CellStyle {
  void dataRevision.value
  return model?.getStyle(r, c) ?? {}
}

/** 显示值：公式求值 / 原文 */
function displayValue(r: number, c: number): string {
  const raw = cellRaw(r, c)
  if (!isFormula(raw)) return raw
  return evaluateCellDisplay(raw, (rr, cc) => cellRaw(rr, cc), r, c)
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

function cellCssStyle(r: number, c: number): Record<string, string> {
  const s = cellStyle(r, c)
  return {
    fontWeight: s.b ? '700' : '',
    color: s.c ?? '',
    background: s.bg ?? '',
    textAlign: s.al ?? '',
  }
}

function selectCell(r: number, c: number, extend = false): void {
  if (editing.value && (editing.value.r !== r || editing.value.c !== c)) {
    commitEdit()
  }
  if (!extend) anchor.value = { r, c }
  focus.value = { r, c }
  broadcastCell()
}

function handleCellMouseDown(r: number, c: number, event: MouseEvent): void {
  if (event.button !== 0) return
  // preventDefault 会阻断浏览器默认的「点击聚焦最近 tabindex 祖先」，
  // 这里手动让网格容器获得焦点，键盘事件才能进入 handleGridKeydown
  const wrap = (event.currentTarget as HTMLElement).closest('.grid-wrap')
  ;(wrap as HTMLElement | null)?.focus()

  pressedCell.value = { r, c }
  dragMoved.value = false

  selectCell(r, c, event.shiftKey)
  if (!event.shiftKey) {
    dragging.value = true
  } else {
    pressedCell.value = null // shift 点击只扩选，不进入编辑
  }
}

function handleCellMouseEnter(r: number, c: number): void {
  if (!dragging.value || isReadonly.value) return
  if (focus.value.r !== r || focus.value.c !== c) {
    dragMoved.value = true
  }
  focus.value = { r, c }
}

function handleGlobalMouseUp(): void {
  dragging.value = false
  // 普通单击（未拖动、非 shift）→ 选中并进入编辑：
  // 让输入法(IME)/中文键入直接可用，无需先双击
  const pressed = pressedCell.value
  pressedCell.value = null
  if (!pressed || dragMoved.value) return
  if (pressed.r === focus.value.r && pressed.c === focus.value.c && !isReadonly.value) {
    startEdit()
  }
}

function startEdit(initial?: string): void {
  if (isReadonly.value || !model) return
  const { r, c } = focus.value
  const fromTyping = initial !== undefined
  draft.value = fromTyping ? initial : cellRaw(r, c)
  editing.value = { r, c }
  // 直接键入 = 覆盖编辑：光标置末尾（全选会吞掉后续追加的字符）
  // 双击/F2 = 编辑原值：全选便于整体替换
  void nextFocus(!fromTyping)
}

function nextFocus(selectAll: boolean): void {
  setTimeout(() => {
    const input = document.querySelector<HTMLInputElement>('input.cell-editor')
    if (!input) return
    input.focus()
    if (selectAll) {
      input.select()
    } else {
      const end = input.value.length
      input.setSelectionRange(end, end)
    }
  }, 0)
}

function commitEdit(): void {
  if (!editing.value || !model) return
  const { r, c } = editing.value
  model.setCell(r, c, draft.value)
  editing.value = null
}

function cancelEdit(): void {
  editing.value = null
}

function moveFocus(dRow: number, dCol: number, extend = false): void {
  const r = Math.min(Math.max(focus.value.r + dRow, 0), Math.max(displayRows.value - 1, 0))
  const c = Math.min(Math.max(focus.value.c + dCol, 0), displayCols.value - 1)
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

const rowMenuOptions = [
  { key: 'insertAbove', label: '在上方插入行' },
  { key: 'insertBelow', label: '在下方插入行' },
  { type: 'divider' as const, key: 'd1' },
  { key: 'delete', label: '删除当前行', props: { style: 'color: #d03050' } },
]
const colMenuOptions = [
  { key: 'insertLeft', label: '在左侧插入列' },
  { key: 'insertRight', label: '在右侧插入列' },
  { type: 'divider' as const, key: 'd1' },
  { key: 'delete', label: '删除当前列', props: { style: 'color: #d03050' } },
]

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

/** 向协同伙伴播报当前焦点格 */
function broadcastCell(): void {
  provider?.awareness?.setLocalStateField('cell', { r: focus.value.r, c: focus.value.c })
}

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
function captureSnapshot(): { grid: ReturnType<SheetModel['toGrid']> } | null {
  if (!model) return null
  void dataRevision.value
  return { grid: model.toGrid() }
}

/** 版本恢复：整体替换网格（协同广播给所有端） */
function restoreSnapshot(grid: ReturnType<SheetModel['toGrid']>): void {
  if (!model || isReadonly.value) return
  model.replaceGrid(grid)
  dataRevision.value++
}

async function handleExport(): Promise<void> {
  if (exporting.value || !model) return
  exporting.value = true
  const title = meta.value?.title?.trim() || '未命名表格'
  try {
    void dataRevision.value
    await exportGridToXlsx(model.toGrid(), title)
    message.success('已导出 Excel 表格')
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    exporting.value = false
  }
}

function handleKeydown(event: KeyboardEvent): void {
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

  try {
    const { data } = await api.get(`/documents/${docId.value}`)
    const loaded: DocumentMeta = data.data
    meta.value = loaded
    titleEditing.value = loaded.title
    document.title = `${loaded.title} · ${PAGE_TITLE}`

    // 防呆：md 文档误入表格路由
    if ((loaded.type ?? 'md') === 'md') {
      await router.replace(`/doc/${loaded.id}`)
      return
    }
  } catch (error) {
    message.error(getApiErrorMessage(error))
    await router.replace('/')
    return
  } finally {
    loading.value = false
  }

  watch(
    () => meta.value?.title,
    (title) => {
      document.title = title ? `${title} · ${PAGE_TITLE}` : PAGE_TITLE
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

  try {
    const { data } = await api.get(`/documents/${docId.value}/comments/unread`)
    unreadComments.value = data.data.count
  } catch {
    unreadComments.value = 0
  }

  let collabToken = ''
  try {
    const { data } = await api.post<never, { data: { data: CollabTokenData } }>(
      `/documents/${docId.value}/collab-token`,
    )
    collabToken = data.data.token
  } catch (error) {
    message.error(getApiErrorMessage(error))
    await router.replace('/')
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
    name: auth.user?.name ?? '匿名',
    color: userColor.value,
  })
  provider.awareness?.on('change', refreshPresence)
  refreshPresence()

  stopObserve = model.observe(() => {
    dataRevision.value++
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
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  window.removeEventListener('mouseup', handleGlobalMouseUp)
  stopObserve?.()
  provider?.destroy()
  ydoc?.destroy()
  provider = null
  ydoc = null
  model = null
  document.title = PAGE_TITLE
})
</script>

<template>
  <div class="sheet-page">
    <div class="sheet-topbar">
      <n-space align="center" size="large">
        <n-button quaternary aria-label="返回文档列表" @click="router.push('/')">← 返回列表</n-button>
        <n-input
          ref="titleInputRef"
          v-model:value="titleEditing"
          class="title-input"
          placeholder="未命名表格"
          :readonly="!canRename"
          :aria-label="canRename ? '编辑表格标题' : '表格标题（仅所有者可改）'"
          @blur="handleRename"
          @keyup.enter="($event.target as HTMLInputElement).blur()"
        />
        <n-tag size="small" type="success" round>表格</n-tag>
        <n-tag v-if="isReadonly" size="small" type="warning" round>🔒 只读</n-tag>
      </n-space>
      <n-space align="center" size="small">
        <n-button quaternary size="small" aria-label="快捷键说明" @click="helpVisible = true">?</n-button>
        <n-button v-if="canRename" quaternary size="small" @click="shareVisible = true">共享</n-button>
        <n-button
          quaternary
          size="small"
          :loading="exporting"
          aria-label="导出"
          @click="handleExport"
        >
          导出
        </n-button>
        <n-button quaternary size="small" @click="versionDrawerVisible = true">版本</n-button>
        <n-badge :value="unreadComments" :max="99" :show="unreadComments > 0">
          <n-button quaternary size="small" @click="commentDrawerVisible = true">评论</n-button>
        </n-badge>

        <n-popover trigger="click" placement="bottom-end">
          <template #trigger>
            <div
              class="avatar-stack"
              role="button"
              tabindex="0"
              aria-label="在线协作者"
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
            <n-text depth="3" style="font-size: 12px">在线协作者（{{ collaborators.length }}）</n-text>
            <n-space v-for="person in collaborators" :key="person.name" align="center" size="small">
              <n-avatar round :size="22" :color="person.color">{{ person.name.slice(0, 1) }}</n-avatar>
              <n-text>{{ person.name }}</n-text>
            </n-space>
          </n-space>
        </n-popover>

        <span role="status" aria-live="polite" class="sync-status">
          <n-tag v-if="connectionStatus !== 'connected'" :type="statusType" size="small" round>
            {{ statusText }}
          </n-tag>
          <n-tag v-else-if="!synced || hasUnsynced" type="info" size="small" round>
            同步中…
          </n-tag>
          <n-tag v-else type="success" size="small" round>✓ 已同步</n-tag>
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
              aria-label="加粗"
              @click="toggleBold"
            >
              <strong>B</strong>
            </n-button>
          </template>
          加粗
        </n-tooltip>

        <n-dropdown :options="TEXT_COLORS.map((c) => ({ key: c, label: 'A', props: { style: `color:${c}` } }))"
          :disabled="isReadonly"
          @select="(key: string) => applyStyleToSelection({ c: key })"
        >
          <n-button size="tiny" quaternary :disabled="isReadonly" aria-label="文字颜色">文字色</n-button>
        </n-dropdown>
        <n-dropdown
          :options="[
            ...BG_COLORS.map((c) => ({ key: c, label: '　', props: { style: `background:${c}` } })),
            { key: 'clear', label: '清除背景' },
          ]"
          :disabled="isReadonly"
          @select="(key: string) => applyStyleToSelection({ bg: key === 'clear' ? null : key })"
        >
          <n-button size="tiny" quaternary :disabled="isReadonly" aria-label="背景颜色">背景色</n-button>
        </n-dropdown>

        <n-divider vertical />

        <n-button size="tiny" quaternary :disabled="isReadonly" aria-label="左对齐" @click="applyStyleToSelection({ al: 'left' })">左</n-button>
        <n-button size="tiny" quaternary :disabled="isReadonly" aria-label="居中对齐" @click="applyStyleToSelection({ al: 'center' })">中</n-button>
        <n-button size="tiny" quaternary :disabled="isReadonly" aria-label="右对齐" @click="applyStyleToSelection({ al: 'right' })">右</n-button>

        <n-divider vertical />

        <n-dropdown :options="rowMenuOptions" :disabled="isReadonly" @select="handleRowMenu">
          <n-button size="tiny" quaternary :disabled="isReadonly" aria-label="行操作">行 ▾</n-button>
        </n-dropdown>
        <n-dropdown :options="colMenuOptions" :disabled="isReadonly" @select="handleColMenu">
          <n-button size="tiny" quaternary :disabled="isReadonly" aria-label="列操作">列 ▾</n-button>
        </n-dropdown>

        <n-divider vertical />
        <n-text depth="3" style="font-size: 12px">
          选区 {{ columnLabel(focus.c) }}{{ focus.r + 1 }}
          <template v-if="range.r1 !== range.r2 || range.c1 !== range.c2">
            （{{ (range.r2 - range.r1 + 1) * (range.c2 - range.c1 + 1) }} 格）
          </template>
          · 公式以 = 开头
        </n-text>
      </n-space>
    </div>

    <div v-if="loading || !ready" class="sheet-loading">
      <div class="sheet-surface skeleton-surface">
        <n-skeleton height="24px" width="30%" style="margin-bottom: 16px" />
        <n-skeleton :height="360" :sharp="true" />
      </div>
    </div>

    <div v-else class="sheet-surface">
      <div
        class="grid-wrap"
        tabindex="0"
        role="grid"
        aria-label="表格编辑区"
        @keydown="handleGridKeydown"
      >
        <table class="sheet-grid">
          <thead>
            <tr>
              <th class="corner" />
              <th
                v-for="(label, c) in columnHeaders"
                :key="`col-${c}`"
                :class="{
                  'col-active': c >= range.c1 && c <= range.c2,
                }"
              >
                {{ label }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in displayRows" :key="`row-${r}`">
              <th
                class="row-head"
                :class="{ 'row-active': r - 1 >= range.r1 && r - 1 <= range.r2 }"
              >
                {{ r }}
              </th>
              <td
                v-for="c in displayCols"
                :key="`cell-${r - 1}-${c - 1}`"
                :class="{
                  selected: isSelected(r - 1, c - 1),
                  focus: isFocus(r - 1, c - 1),
                  editing: isEditing(r - 1, c - 1),
                }"
                :style="cellCssStyle(r - 1, c - 1)"
                :data-remote-name="remoteCursorAt(r - 1, c - 1)?.name"
                @mousedown.prevent="handleCellMouseDown(r - 1, c - 1, $event)"
                @mouseenter="handleCellMouseEnter(r - 1, c - 1)"

              >
                <input
                  v-if="isEditing(r - 1, c - 1)"
                  v-model="draft"
                  class="cell-editor"
                  @keydown="handleEditKeydown"
                  @blur="commitEdit"
                />
                <template v-else>{{ displayValue(r - 1, c - 1) }}</template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="grid-hint">
        单击编辑（支持中文输入法）· 拖拽 / Shift+点击框选 · Enter 确认 · Esc 取消 · 方向键与 Tab 导航
        · 公式示例：=A1+B2、=SUM(A1:A9)
      </div>
    </div>

    <CommentDrawer
      v-model:show="commentDrawerVisible"
      :document-id="docId"
      :can-manage="auth.user?.id === meta?.user_id"
      @read="unreadComments = 0"
    />

    <SheetVersionDrawer
      v-model:show="versionDrawerVisible"
      :document-id="docId"
      :readonly="isReadonly"
      :capture="captureSnapshot"
      :restore="restoreSnapshot"
    />

    <ShareModal v-model:show="shareVisible" :document-id="docId" />

    <n-modal v-model:show="helpVisible" preset="card" title="快捷键" style="width: 440px; max-width: 92vw">
      <n-table :bordered="false" :single-line="false" size="small">
        <thead>
          <tr><th>快捷键</th><th>作用</th></tr>
        </thead>
        <tbody>
          <tr><td><kbd>方向键</kbd> / <kbd>Tab</kbd></td><td>在单元格间导航</td></tr>
          <tr><td><kbd>Shift</kbd> + 方向键</td><td>扩展选区</td></tr>
          <tr><td><kbd>Enter</kbd> / <kbd>F2</kbd></td><td>编辑当前单元格</td></tr>
          <tr><td><kbd>Enter</kbd> / <kbd>Tab</kbd>（编辑中）</td><td>确认并移至下一格</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>取消编辑 / 关闭弹层</td></tr>
          <tr><td><kbd>⌘/Ctrl + ⏎</kbd></td><td>打开评论抽屉</td></tr>
          <tr><td><kbd>?</kbd></td><td>打开/关闭本说明</td></tr>
        </tbody>
      </n-table>
    </n-modal>
  </div>
</template>

<style scoped>
.sheet-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
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
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
}
.format-bar {
  padding: 6px 16px;
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-faint);
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
  flex: 1;
  max-width: 1200px;
  width: 100%;
  margin: 16px auto;
  background: var(--bg-surface);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  overflow: auto;
  padding-bottom: 8px;
}
.skeleton-surface {
  padding: 32px;
}
.grid-wrap {
  outline: none;
  overflow: auto;
  max-height: calc(100vh - 210px);
  cursor: cell;
}
.grid-wrap:focus-visible {
  outline: 2px solid #2080f0;
  outline-offset: -2px;
}
.grid-hint {
  padding: 8px 12px;
  font-size: 12px;
  color: #999;
  border-top: 1px solid var(--border-faint);
}
.sheet-grid {
  border-collapse: collapse;
  table-layout: fixed;
  font-size: 13px;
}
.sheet-grid th,
.sheet-grid td {
  border: 1px solid var(--border-subtle);
  min-width: 96px;
  height: 30px;
  padding: 0;
  box-sizing: border-box;
}
.sheet-grid thead th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg-muted);
  font-weight: 600;
  color: #888;
  text-align: center;
  min-width: 96px;
}
.sheet-grid thead th.corner {
  left: 0;
  z-index: 3;
  min-width: 48px;
  width: 48px;
}
.sheet-grid .row-head {
  position: sticky;
  left: 0;
  z-index: 1;
  background: var(--bg-muted);
  font-weight: 500;
  color: #888;
  text-align: center;
  min-width: 48px;
  width: 48px;
}
.sheet-grid th.col-active,
.sheet-grid th.row-active {
  color: #2080f0;
  background: #eaf3ff;
}
.sheet-grid td {
  padding: 2px 6px;
  cursor: cell;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  position: relative;
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
  background: #f06292;
  color: #fff;
  pointer-events: none;
  z-index: 1;
}
</style>
