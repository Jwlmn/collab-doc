import * as Y from 'yjs'
import { columnLabel } from './cells'

/**
 * Excel 文档 v2 数据模型（行模型）：
 *
 *   ydoc.getArray('rows') → 每项为一行 Y.Map<string(colIndex), CellValue>
 *
 * - 行的插入/删除走 Y.Array 原语 → 协同安全
 * - 列操作 = 遍历各行重排 key（低频操作，多人并发列操作为最后写赢，见 docs）
 * - 单元格值：纯文本 string，或带样式的 { v, b?, c?, bg?, al? }
 */

export interface CellStyle {
  /** bold */
  b?: 1
  /** 文字颜色 */
  c?: string
  /** 背景颜色 */
  bg?: string
  /** 水平对齐 */
  al?: 'left' | 'center' | 'right'
}

export type SheetCell = CellStyle & { v: string }

/** 条件格式的比较方式 */
export type CfOp = 'gt' | 'lt' | 'gte' | 'lte' | 'eq' | 'neq' | 'contains' | 'between'

/** 条件格式规则：命中区间内的单元格按 value 比较，命中则套用 style */
export interface CfRule {
  r1: number
  c1: number
  r2: number
  c2: number
  op: CfOp
  value: number | string
  /** between 时的上界 */
  value2?: number | string
  style: CellStyle
}

/** 快照里的 meta 段（尺寸 + 条件格式），旧快照无此字段则保持现状 */
export interface SheetMeta {
  colWidths?: Record<string, number>
  rowHeights?: Record<string, number>
  cfRules?: Record<string, CfRule>
}

export type CellValue = string | SheetCell

/** 导入/兼容层的稀疏文本表：key = `${row},${col}` */
export type CellMap = Record<string, string>

export const DEFAULT_ROWS = 30
export const DEFAULT_COLS = 16

export function colLabelToIndex(label: string): number {
  let n = 0
  for (const ch of label.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64)
  }
  return n - 1
}

export class SheetModel {
  readonly rows: Y.Array<Y.Map<CellValue>>

  /** 已挂观察器的行（避免重复 observe） */
  private readonly observedRows = new WeakSet<Y.Map<CellValue>>()

  /**
   * 顶层 meta：列宽/行高/条件格式规则。
   * 值是嵌套的 Y.Map（colWidths / rowHeights / cfRules），随整个 Y.Doc
   * 经 HocusPocus 持久化到 document_states，无需改协作服务器。
   */
  private readonly meta: Y.Map<unknown>

  // erasableSyntaxOnly：禁用构造参数属性，显式声明
  private readonly ydoc: Y.Doc

  constructor(ydoc: Y.Doc) {
    this.ydoc = ydoc
    this.rows = ydoc.getArray<Y.Map<CellValue>>('rows')
    this.meta = ydoc.getMap('meta')
  }

  /** 读取嵌套 meta 子表；不存在返回 null（读路径不产生副作用） */
  private readMetaMap(key: 'colWidths' | 'rowHeights' | 'cfRules'): Y.Map<unknown> | null {
    const v = this.meta.get(key)
    return v instanceof Y.Map ? v : null
  }

  /** 取嵌套 meta 子表，不存在则创建（写路径专用） */
  private ensureMetaMap(key: 'colWidths' | 'rowHeights' | 'cfRules'): Y.Map<unknown> {
    const existing = this.meta.get(key)
    if (existing instanceof Y.Map) return existing
    const created = new Y.Map<unknown>()
    this.meta.set(key, created)
    return created
  }

  get rowCount(): number {
    return this.rows.length
  }

  /** 数据最大列数（无数据为 0） */
  get colCount(): number {
    let max = -1
    this.rows.forEach((row) => {
      row.forEach((_v, key) => {
        const c = Number(key)
        if (Number.isFinite(c) && c > max) max = c
      })
    })
    return max + 1
  }

  private rowAt(index: number): Y.Map<CellValue> | undefined {
    return index >= 0 && index < this.rows.length ? this.rows.get(index) : undefined
  }

  getCell(row: number, col: number): CellValue | undefined {
    return this.rowAt(row)?.get(String(col))
  }

  /** 单元格原始文本（公式未求值） */
  getRaw(row: number, col: number): string {
    const value = this.getCell(row, col)
    if (value === undefined || value === null) return ''
    if (typeof value === 'string') return value
    // 防御：仅接受带 v 字段的平面对象（协同中间态可能出现其它类型）
    if (typeof value === 'object' && 'v' in value && typeof (value as SheetCell).v === 'string') {
      return (value as SheetCell).v
    }
    return ''
  }

  getStyle(row: number, col: number): CellStyle {
    const value = this.getCell(row, col)
    if (value === undefined || value === null || typeof value !== 'object') return {}
    if (!('v' in value)) return {}
    const { v: _v, ...style } = value as unknown as Record<string, unknown>
    return style as CellStyle
  }

  /** 写入文本（空串删除键，保持稀疏） */
  setCell(row: number, col: number, text: string): void {
    const map = this.ensureRow(row)
    if (!map) return
    const key = String(col)
    if (text === '') {
      map.delete(key)
      return
    }
    const prev = map.get(key)
    const style = prev && typeof prev !== 'string' ? { ...prev, v: '' } : undefined
    map.set(key, style ? { ...style, v: text } : text)
  }

  /**
   * 应用样式补丁到单元格。
   * patch 中 null/undefined 值表示移除该样式键；纯样式空格会创建 {v:''} 占位。
   */
  applyStyle(row: number, col: number, patch: Partial<Record<keyof CellStyle, CellStyle[keyof CellStyle] | null>>): void {
    const map = this.ensureRow(row)
    if (!map) return
    const key = String(col)
    const prev = map.get(key)
    const base: SheetCell =
      prev === undefined ? { v: '' } : typeof prev === 'string' ? { v: prev } : { ...prev }

    for (const [k, v] of Object.entries(patch)) {
      const styleKey = k as keyof CellStyle
      if (v === null || v === undefined) {
        delete base[styleKey]
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(base as any)[styleKey] = v
      }
    }

    const { v, ...rest } = base
    if (v === '' && Object.keys(rest).length === 0) {
      map.delete(key) // 无内容且无样式 → 不占位
    } else {
      map.set(key, Object.keys(rest).length === 0 ? v : { v, ...rest })
    }
  }

  /** 确保行存在（行模型下行数显式管理） */
  private ensureRow(index: number): Y.Map<CellValue> | undefined {
    if (index < this.rows.length) return this.rows.get(index)
    // 仅用于创建时的初始行补齐；插行请用 insertRow
    while (this.rows.length < index) {
      this.rows.push([new Y.Map<CellValue>()])
    }
    if (this.rows.length === index) {
      this.rows.push([new Y.Map<CellValue>()])
    }
    return this.rows.get(index)
  }

  /** 初始化默认行数（创建/导入时调用，单客户端执行） */
  seedRows(count = DEFAULT_ROWS): void {
    const maps: Y.Map<CellValue>[] = []
    for (let i = 0; i < count; i++) maps.push(new Y.Map<CellValue>())
    this.rows.push(maps)
  }

  insertRow(at: number): void {
    const index = Math.min(Math.max(at, 0), this.rows.length)
    this.rows.insert(index, [new Y.Map<CellValue>()])
    this.shiftRowHeights(index, 1)
  }

  deleteRow(at: number): void {
    if (at < 0 || at >= this.rows.length) return
    this.shiftRowHeights(at, -1)
    if (this.rows.length <= 1) {
      // 至少保留一行：清空该行而非删除
      this.rows.get(0)?.clear()
      return
    }
    this.rows.delete(at, 1)
  }

  insertCol(at: number): void {
    const index = Math.max(at, 0)
    this.shiftColWidths(index, 1)
    this.rows.forEach((row) => {
      const entries: Array<[number, CellValue]> = []
      row.forEach((v, k) => entries.push([Number(k), v]))
      const target = entries.filter(([k]) => k >= index).sort((a, b) => b[0] - a[0])
      if (target.length === 0) return
      row.clear()
      const kept = entries.filter(([k]) => k < index).sort((a, b) => a[0] - b[0])
      for (const [k, v] of kept) row.set(String(k), v)
      for (const [k, v] of target) row.set(String(k + 1), v)
    })
  }

  deleteCol(at: number): void {
    this.shiftColWidths(at, -1)
    this.rows.forEach((row) => {
      const entries: Array<[number, CellValue]> = []
      row.forEach((v, k) => entries.push([Number(k), v]))
      if (!entries.some(([k]) => k === at)) return
      row.clear()
      const kept = entries
        .filter(([k]) => k !== at)
        .map(([k, v]): [number, CellValue] => [k > at ? k - 1 : k, v])
        .sort((a, b) => a[0] - b[0])
      for (const [k, v] of kept) row.set(String(k), v)
    })
  }

  /** 在 Y 事务中执行批量操作（对外暴露，避免外部触碰私有 ydoc） */
  transact(fn: () => void): void {
    this.ydoc.transact(fn)
  }

  /* ---------------------------------------------------------------- */
  /*  meta：列宽 / 行高 / 条件格式                                      */
  /* ---------------------------------------------------------------- */

  /** 列宽（px）；未设置返回 null 表示用默认 96 */
  getColWidth(col: number): number | null {
    const widths = this.readMetaMap('colWidths')
    const v = widths?.get(String(col))
    return typeof v === 'number' ? v : null
  }

  /** 设置列宽；传 null 恢复默认（键被删除，保持稀疏） */
  setColWidth(col: number, px: number | null): void {
    const widths = this.ensureMetaMap('colWidths')
    const key = String(col)
    if (px === null) widths.delete(key)
    else widths.set(key, Math.max(24, Math.round(px)))
  }

  /** 行高（px）；未设置返回 null 表示用默认 30 */
  getRowHeight(row: number): number | null {
    const heights = this.readMetaMap('rowHeights')
    const v = heights?.get(String(row))
    return typeof v === 'number' ? v : null
  }

  /** 设置行高；传 null 恢复默认 */
  setRowHeight(row: number, px: number | null): void {
    const heights = this.ensureMetaMap('rowHeights')
    const key = String(row)
    if (px === null) heights.delete(key)
    else heights.set(key, Math.max(16, Math.round(px)))
  }

  /** 全部列宽（仅非默认项） */
  getColWidths(): Record<string, number> {
    const out: Record<string, number> = {}
    this.readMetaMap('colWidths')?.forEach((v, k) => {
      if (typeof v === 'number') out[k] = v
    })
    return out
  }

  /** 全部行高（仅非默认项） */
  getRowHeights(): Record<string, number> {
    const out: Record<string, number> = {}
    this.readMetaMap('rowHeights')?.forEach((v, k) => {
      if (typeof v === 'number') out[k] = v
    })
    return out
  }

  /** 全部条件格式规则 */
  getCfRules(): Record<string, CfRule> {
    const out: Record<string, CfRule> = {}
    this.readMetaMap('cfRules')?.forEach((v, k) => {
      if (v && typeof v === 'object' && 'op' in (v as object)) out[k] = v as CfRule
    })
    return out
  }

  setCfRule(id: string, rule: CfRule): void {
    this.ensureMetaMap('cfRules').set(id, rule)
  }

  removeCfRule(id: string): void {
    this.readMetaMap('cfRules')?.delete(id)
  }

  /**
   * 列位移时平移列宽键。
   * 与 insertCol/deleteCol 重排行内 key 是同一套语义 —— 列级并发操作
   * 最后写赢（docs/excel-sheets.md 已标注的已知边界）。
   */
  private shiftColWidths(from: number, delta: number): void {
    const widths = this.readMetaMap('colWidths')
    if (!widths || widths.size === 0) return

    const entries: Array<[string, unknown]> = []
    widths.forEach((v, k) => entries.push([k, v]))

    if (delta > 0) {
      // 插入：col >= from 都要 +1，从大到小改避免键互相覆盖
      entries.sort((a, b) => Number(b[0]) - Number(a[0]))
      for (const [k, v] of entries) {
        const col = Number(k)
        if (Number.isFinite(col) && col >= from) {
          widths.delete(k)
          widths.set(String(col + 1), v)
        }
      }
    } else {
      // 删除：from 键直接丢，col > from 的整体 -1
      widths.delete(String(from))
      entries.sort((a, b) => Number(a[0]) - Number(b[0]))
      for (const [k, v] of entries) {
        const col = Number(k)
        if (Number.isFinite(col) && col > from) widths.set(String(col - 1), v)
      }
    }
  }

  /** 行位移时平移行高键（Y.Array 只平移行对象，索引键不会自己跟） */
  private shiftRowHeights(from: number, delta: number): void {
    const heights = this.readMetaMap('rowHeights')
    if (!heights || heights.size === 0) return

    const entries: Array<[string, unknown]> = []
    heights.forEach((v, k) => entries.push([k, v]))

    if (delta > 0) {
      entries.sort((a, b) => Number(b[0]) - Number(a[0]))
      for (const [k, v] of entries) {
        const row = Number(k)
        if (Number.isFinite(row) && row >= from) {
          heights.delete(k)
          heights.set(String(row + 1), v)
        }
      }
    } else {
      heights.delete(String(from))
      entries.sort((a, b) => Number(a[0]) - Number(b[0]))
      for (const [k, v] of entries) {
        const row = Number(k)
        if (Number.isFinite(row) && row > from) heights.set(String(row - 1), v)
      }
    }
  }

  /** 快照 meta 段（尺寸 + 条件格式） */
  getMetaSnapshot(): SheetMeta {
    const meta: SheetMeta = {}
    const widths = this.getColWidths()
    const heights = this.getRowHeights()
    const rules = this.getCfRules()
    if (Object.keys(widths).length > 0) meta.colWidths = widths
    if (Object.keys(heights).length > 0) meta.rowHeights = heights
    if (Object.keys(rules).length > 0) meta.cfRules = rules
    return meta
  }

  /** 恢复 meta 段；缺省的字段保持现状（兼容没有 meta 的旧快照） */
  applyMetaSnapshot(meta: SheetMeta | null | undefined): void {
    if (!meta) return
    this.transact(() => {
      if (meta.colWidths) {
        const m = this.ensureMetaMap('colWidths')
        m.forEach((_v, k) => m.delete(k))
        for (const [k, v] of Object.entries(meta.colWidths)) m.set(k, v)
      }
      if (meta.rowHeights) {
        const m = this.ensureMetaMap('rowHeights')
        m.forEach((_v, k) => m.delete(k))
        for (const [k, v] of Object.entries(meta.rowHeights)) m.set(k, v)
      }
      if (meta.cfRules) {
        const m = this.ensureMetaMap('cfRules')
        m.forEach((_v, k) => m.delete(k))
        for (const [k, v] of Object.entries(meta.cfRules)) m.set(k, v)
      }
    })
  }

  /** 已挂观察器的 meta 子表（避免重复 observe） */
  private readonly observedMetaMaps = new WeakSet<Y.Map<unknown>>()

  /** 深度观察（rows 结构 + 各行内容 + meta 及其子表）；返回清理函数 */
  observe(callback: () => void): () => void {
    const attachRows = () => {
      this.rows.forEach((row) => {
        if (!this.observedRows.has(row)) {
          this.observedRows.add(row)
          row.observe(callback)
        }
      })
    }

    /**
     * Yjs 的 observe 是浅层的：meta.set(key, childMap) 会冒泡到 meta，
     * 但 childMap 内部的 set/delete **不会**。而列宽/行高/条件格式的读写
     * 全发生在子表里，不挂上子表就会「模型已改、界面不动」
     * （表现为 resetRowHeight 后 DOM 仍是旧行高）。
     */
    const attachMeta = () => {
      this.meta.forEach((value) => {
        if (value instanceof Y.Map && !this.observedMetaMaps.has(value)) {
          this.observedMetaMaps.add(value)
          value.observe(callback)
        }
      })
    }

    const onArray = () => {
      attachRows()
      callback()
    }

    const onMeta = () => {
      attachMeta() // 新建的子表（首次 setColWidth/setRowHeight/setCfRule）要补挂
      callback()
    }

    this.rows.observe(onArray)
    this.meta.observe(onMeta)
    attachRows()
    attachMeta()
    callback()

    return () => {
      this.rows.unobserve(onArray)
      this.meta.unobserve(onMeta)
      // 已挂的子表无法逐个拿到引用，统一靠 WeakSet 去重；
      // 组件销毁后这些监听随 ydoc 一起丢弃，无需显式卸载
    }
  }

  /** 稀疏文本表（导出/兼容）：返回 `${r},${c}` → 原始文本 */
  toCells(): CellMap {
    const cells: CellMap = {}
    this.rows.forEach((row, r) => {
      row.forEach((v, k) => {
        const text = typeof v === 'string' ? v : v.v
        if (text !== '') cells[`${r},${k}`] = text
      })
    })
    return cells
  }

  /** 稠密网格（含样式，导出/版本快照） */
  toGrid(): SheetCell[][] {
    const rowCount = this.rowCount
    const colCount = Math.max(this.colCount, 1)
    const grid: SheetCell[][] = []
    for (let r = 0; r < rowCount; r++) {
      const line: SheetCell[] = []
      for (let c = 0; c < colCount; c++) {
        const v = this.getRaw(r, c)
        const style = this.getStyle(r, c)
        line.push({ v, ...style })
      }
      grid.push(line)
    }
    return grid
  }

  /** 用网格快照整体替换内容（版本恢复） */
  replaceGrid(grid: SheetCell[][]): void {
    this.ydoc.transact(() => {
      this.rows.delete(0, this.rows.length)
      const maps = grid.map((line) => {
        const map = new Y.Map<CellValue>()
        line.forEach((cell, c) => {
          const { v, ...style } = cell
          if (v !== '' || Object.keys(style).length > 0) {
            map.set(String(c), Object.keys(style).length === 0 ? v : { v, ...style })
          }
        })
        return map
      })
      if (maps.length === 0) maps.push(new Y.Map<CellValue>())
      this.rows.push(maps)
    })
  }

  /** 从稀疏文本表填充（导入种子 / 旧数据迁移） */
  fillFromCells(cells: CellMap): void {
    const keys = Object.keys(cells)
    if (keys.length === 0) return

    let maxRow = -1
    let maxCol = -1
    for (const key of keys) {
      const [r, c] = key.split(',').map(Number)
      if (Number.isFinite(r) && r > maxRow) maxRow = r
      if (Number.isFinite(c) && c > maxCol) maxCol = c
    }

    this.ydoc.transact(() => {
      if (this.rows.length <= maxRow) this.seedRows(Math.max(maxRow + 1, DEFAULT_ROWS))
      for (const key of keys) {
        const [r, c] = key.split(',').map(Number)
        this.setCell(r, c, cells[key])
      }
    })
  }

  /**
   * v1（ydoc.getMap('cells')）→ v2 行模型的一次性迁移。
   * 仅在 rows 为空且存在旧数据时执行；多端同时首次打开同一旧文档的
   * 并发迁移窗口极小（毫秒级），旧测试文档建议单端先行打开。
   */
  migrateLegacyCells(): boolean {
    const legacy = this.ydoc.getMap<string>('cells')
    if (this.rows.length > 0 || legacy.size === 0) return false

    const cells: CellMap = {}
    legacy.forEach((v, k) => {
      cells[k] = v
    })
    this.fillFromCells(cells)
    legacy.clear()
    return true
  }
}

/** 网格显示列头数组 */
export function columnLabels(count: number): string[] {
  return Array.from({ length: count }, (_, i) => columnLabel(i))
}

/** 网格快照 → 预览用 HTML 表格（版本历史弹窗 v-html） */
export function gridToHtml(grid: SheetCell[][]): string {
  if (grid.length === 0) return '<p>（空表格）</p>'
  const rows = grid
    .map((line, rowIndex) => {
      const cells = line
        .map((cell) => {
          const style: string[] = []
          if (cell.b) style.push('font-weight:700')
          if (cell.bg) style.push(`background:${cell.bg}`)
          if (cell.c) style.push(`color:${cell.c}`)
          if (cell.al) style.push(`text-align:${cell.al}`)
          const styleAttr = style.length ? ` style="${style.join(';')}"` : ''
          const tag = rowIndex === 0 ? 'th' : 'td'
          const escaped = cell.v
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
          return `<${tag}${styleAttr}>${escaped}</${tag}>`
        })
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')
  return `<table border="1" cellspacing="0" cellpadding="4">${rows}</table>`
}
