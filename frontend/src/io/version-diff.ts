import { diffArrays } from 'diff'
import type { JSONContent } from '@tiptap/core'
import type { SheetCell } from './sheet-model'

/**
 * 版本对比：回答「恢复这个版本，内容会怎么变」。
 *
 * 对比方向一律是 **当前内容 → 快照内容**：
 *   - removed = 恢复后将消失的行/单元格
 *   - added   = 恢复后将出现的行/单元格
 */

export type DiffLineKind = 'equal' | 'added' | 'removed'

export interface DiffLine {
  kind: DiffLineKind
  text: string
}

/* ------------------------------------------------------------------ */
/*  MD：块级行 diff                                                     */
/* ------------------------------------------------------------------ */

/** 取节点的纯文本（递归，忽略 mark） */
function nodeText(node: JSONContent): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  return (node.content ?? []).map(nodeText).join('')
}

/** 单个块级节点 → 一行可读文本（带 markdown 风格前缀） */
function blockToLine(node: JSONContent): string {
  const text = nodeText(node)
  switch (node.type) {
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1)
      return `${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${text}`
    }
    case 'bulletList':
    case 'orderedList': {
      // 列表整体压成一行占位，具体条目在 collectLines 里逐个展开
      return ''
    }
    case 'listItem':
      return `- ${text.replace(/\n+/g, ' ').trim()}`
    case 'codeBlock':
      return text.split('\n')[0] ?? ''
    case 'blockquote':
      return `> ${text.replace(/\n+/g, ' ').trim()}`
    case 'horizontalRule':
      return '---'
    case 'tableRow':
      return (node.content ?? []).map((cell) => nodeText(cell).trim()).join(' | ')
    default:
      return text.replace(/\n+/g, ' ').trim()
  }
}

/** 递归收集块级行（展开列表项/表格行，跳过空行） */
function collectLines(nodes: JSONContent[] | undefined, out: string[], prefix = ''): void {
  if (!nodes) return
  for (const node of nodes) {
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      collectLines(node.content, out, prefix)
      continue
    }
    if (node.type === 'listItem') {
      // 列表项内通常只有段落，把条目整体压成一行并带上标记
      const text = nodeText(node).replace(/\n+/g, ' ').trim()
      if (text !== '') out.push(`${prefix}- ${text}`)
      continue
    }
    if (node.type === 'table') {
      collectLines(node.content, out, prefix)
      continue
    }
    const line = prefix + blockToLine(node)
    if (line !== prefix && line !== '') out.push(line)
  }
}

/** Tiptap JSON → 块级行文本数组 */
export function mdBlocksToLines(doc: unknown): string[] {
  const typed = doc as JSONContent | null
  if (!typed || typeof typed !== 'object') return []
  const out: string[] = []
  collectLines(typed.content, out)
  return out
}

/**
 * 当前内容 vs 快照内容的行级差异。
 * `kind: 'removed'` = 恢复后会消失；`kind: 'added'` = 恢复后会出现。
 */
export function diffLinesBetween(current: string[], snapshot: string[]): DiffLine[] {
  // 行是数组元素，用 diffArrays（diffLines 只接受按 \n 切分的字符串）
  const changes = diffArrays(current, snapshot)
  const result: DiffLine[] = []
  for (const change of changes) {
    const kind: DiffLineKind = change.added ? 'added' : change.removed ? 'removed' : 'equal'
    for (const text of change.value) result.push({ kind, text })
  }
  return result
}

/* ------------------------------------------------------------------ */
/*  Excel：行对齐的单元格 diff                                          */
/* ------------------------------------------------------------------ */

export type CellDiffStatus = 'same' | 'changed' | 'added' | 'removed'

export interface GridDiffCell {
  col: number
  status: CellDiffStatus
  /** 该格最终应显示的文本（same=当前值，changed/added=快照值，removed=当前值） */
  text: string
  /** changed 时的原值（便于 UI 展示前后对照） */
  before?: string
  after?: string
}

export interface GridDiffRow {
  status: 'same' | 'changed' | 'added' | 'removed'
  cells: GridDiffCell[]
}

export interface GridDiff {
  rows: GridDiffRow[]
  changedCells: number
  addedRows: number
  removedRows: number
}

/** 单元格文本（未定义视作空） */
function cellText(cell: SheetCell | undefined): string {
  return cell?.v ?? ''
}

/** 单元格样式指纹（值不变但样式变了也算改动） */
function cellStyleKey(cell: SheetCell | undefined): string {
  if (!cell) return ''
  const parts: string[] = []
  if (cell.b) parts.push('b')
  if (cell.c) parts.push(`c:${cell.c}`)
  if (cell.bg) parts.push(`bg:${cell.bg}`)
  if (cell.al) parts.push(`al:${cell.al}`)
  return parts.join('|')
}

/** 裁掉尾部全空的行，避免空行噪音淹没真实差异 */
function trimTrailingEmptyRows(grid: SheetCell[][]): SheetCell[][] {
  const rows = [...grid]
  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cellText(cell) === '')) {
    rows.pop()
  }
  return rows
}

/** 行签名：用于行级增删对齐（只看值，样式变化不算行增删） */
function rowSignature(row: SheetCell[] | undefined): string {
  if (!row) return ''
  return row.map(cellText).join('\t')
}

/** 比对两行的逐格差异 */
function diffRowCells(
  currentRow: SheetCell[] | undefined,
  snapshotRow: SheetCell[] | undefined,
  colCount: number,
): { cells: GridDiffCell[]; changed: number } {
  const cells: GridDiffCell[] = []
  let changed = 0
  for (let col = 0; col < colCount; col++) {
    const before = currentRow?.[col]
    const after = snapshotRow?.[col]
    const beforeText = cellText(before)
    const afterText = cellText(after)
    const valueChanged = beforeText !== afterText
    const styleChanged = cellStyleKey(before) !== cellStyleKey(after)

    const isChanged = valueChanged || styleChanged
    if (isChanged) changed++
    cells.push({
      col,
      status: isChanged ? 'changed' : 'same',
      // 恢复后这一格会是什么：changed 取快照值，same 取当前值
      text: isChanged ? afterText : beforeText,
      ...(isChanged ? { before: beforeText, after: afterText } : {}),
    })
  }
  return { cells, changed }
}

type RowOp =
  | { kind: 'equal'; cur: number; snap: number }
  | { kind: 'changed'; cur: number; snap: number }
  | { kind: 'removed'; cur: number }
  | { kind: 'added'; snap: number }

/**
 * 把 jsdiff 的行片段折成对齐操作。
 *
 * 关键：diffArrays 对「整行内容被改写」会给出 removed + added 两个相邻片段，
 * 直接照搬会把「改了一个单元格」显示成「删一行 + 增一行」。因此把相邻的
 * removed/added 逐对配成 changed，配不上的余量才保留为纯增/纯删。
 */
function alignRowOps(curSigs: string[], snapSigs: string[]): RowOp[] {
  const changes = diffArrays(curSigs, snapSigs)
  const ops: RowOp[] = []
  let cur = 0
  let snap = 0

  for (let i = 0; i < changes.length; i++) {
    const change = changes[i]
    const count = change.value.length

    if (change.removed) {
      const next = changes[i + 1]
      if (next?.added) {
        const paired = Math.min(count, next.value.length)
        for (let k = 0; k < paired; k++) ops.push({ kind: 'changed', cur: cur + k, snap: snap + k })
        for (let k = paired; k < count; k++) ops.push({ kind: 'removed', cur: cur + k })
        for (let k = paired; k < next.value.length; k++) ops.push({ kind: 'added', snap: snap + k })
        cur += count
        snap += next.value.length
        i++ // 消费掉配对的 added 片段
      } else {
        for (let k = 0; k < count; k++) ops.push({ kind: 'removed', cur: cur + k })
        cur += count
      }
    } else if (change.added) {
      // 少数情况下 added 排在 removed 前面，同样尝试与后一片段配对
      const next = changes[i + 1]
      if (next?.removed) {
        const paired = Math.min(count, next.value.length)
        for (let k = 0; k < paired; k++) ops.push({ kind: 'changed', cur: cur + k, snap: snap + k })
        for (let k = paired; k < count; k++) ops.push({ kind: 'added', snap: snap + k })
        for (let k = paired; k < next.value.length; k++) ops.push({ kind: 'removed', cur: cur + k })
        snap += count
        cur += next.value.length
        i++
      } else {
        for (let k = 0; k < count; k++) ops.push({ kind: 'added', snap: snap + k })
        snap += count
      }
    } else {
      for (let k = 0; k < count; k++) ops.push({ kind: 'equal', cur: cur + k, snap: snap + k })
      cur += count
      snap += count
    }
  }

  return ops
}

/**
 * 当前网格 vs 快照行网格的差异。
 * 行按值签名对齐（jsdiff diffArrays），配对行内再逐格比对值与样式。
 *
 * 方向：`cur` 是当前内容，`snap` 是快照 —— removed = 恢复后会消失，added = 恢复后会出现。
 */
export function diffGrids(current: SheetCell[][], snapshot: SheetCell[][]): GridDiff {
  const cur = trimTrailingEmptyRows(current)
  const snap = trimTrailingEmptyRows(snapshot)

  const curSigs = cur.map(rowSignature)
  const snapSigs = snap.map(rowSignature)
  const colCount = Math.max(
    cur.reduce((max, row) => Math.max(max, row.length), 0),
    snap.reduce((max, row) => Math.max(max, row.length), 0),
  )

  const rows: GridDiffRow[] = []
  let changedCells = 0
  let addedRows = 0
  let removedRows = 0

  for (const op of alignRowOps(curSigs, snapSigs)) {
    if (op.kind === 'removed') {
      // 整行消失：计入 removedRows，格子不再重复计入 changedCells
      const { cells } = diffRowCells(cur[op.cur], undefined, colCount)
      rows.push({ status: 'removed', cells })
      removedRows++
    } else if (op.kind === 'added') {
      const { cells } = diffRowCells(undefined, snap[op.snap], colCount)
      rows.push({ status: 'added', cells })
      addedRows++
    } else {
      const { cells, changed } = diffRowCells(cur[op.cur], snap[op.snap], colCount)
      const status: GridDiffRow['status'] =
        op.kind === 'changed' || changed > 0 ? 'changed' : 'same'
      rows.push({ status, cells })
      changedCells += changed
    }
  }

  return { rows, changedCells, addedRows, removedRows }
}

/** 汇总文案：「新增 2 行 · 删除 1 行 · 修改 5 单元格」 */
export function describeGridDiff(diff: GridDiff): string {
  const parts: string[] = []
  if (diff.addedRows > 0) parts.push(`新增 ${diff.addedRows} 行`)
  if (diff.removedRows > 0) parts.push(`删除 ${diff.removedRows} 行`)
  if (diff.changedCells > 0) parts.push(`修改 ${diff.changedCells} 单元格`)
  return parts.length > 0 ? parts.join(' · ') : '无差异'
}
