import writeXlsxFile from 'write-excel-file/browser'
import { toNumericIfPossible } from './tables'
import { evaluateCellDisplay, isFormula } from './formula'
import type { SheetCell } from './sheet-model'

/**
 * Excel 文档单元格模型：key = "行,列"（0 起），value = 文本。
 * Y.js 侧存于 ydoc.getMap('cells')，此模块为与外界（xlsx/网格）的纯转换。
 */
export type CellMap = Record<string, string>

export function cellKey(row: number, col: number): string {
  return `${row},${col}`
}

/** 二维文本行 → cells（首行 = 表头行，直接平铺为单元格） */
export function rowsToCells(rows: string[][]): CellMap {
  const cells: CellMap = {}
  rows.forEach((row, r) => {
    row.forEach((value, c) => {
      if (value !== '') cells[cellKey(r, c)] = value
    })
  })
  return cells
}

/** cells → 稠密二维文本（到数据边界，供导出） */
export function cellsToRows(cells: CellMap): string[][] {
  const { rows, cols } = cellBounds(cells)
  const grid: string[][] = []
  for (let r = 0; r < rows; r++) {
    const line: string[] = []
    for (let c = 0; c < cols; c++) {
      line.push(cells[cellKey(r, c)] ?? '')
    }
    grid.push(line)
  }
  return grid
}

/** cells 的数据边界（至少 1×1） */
export function cellBounds(cells: CellMap): { rows: number; cols: number } {
  let maxRow = -1
  let maxCol = -1
  for (const key of Object.keys(cells)) {
    const [r, c] = key.split(',').map(Number)
    if (Number.isFinite(r) && Number.isFinite(c)) {
      if (r > maxRow) maxRow = r
      if (c > maxCol) maxCol = c
    }
  }
  return { rows: maxRow + 1, cols: maxCol + 1 }
}

/** 列索引 → Excel 列头（0 → A … 25 → Z, 26 → AA） */
export function columnLabel(index: number): string {
  let n = index
  let label = ''
  do {
    label = String.fromCharCode(65 + (n % 26)) + label
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return label
}

interface XlsxCell {
  value: string | number
  type: typeof String | typeof Number
  fontWeight?: number
  backgroundColor?: string
}

/** cells → 下载 .xlsx（首行若整行都有值则作为加粗表头样式导出） */
export async function exportCellsToXlsx(cells: CellMap, title: string): Promise<void> {
  const rows = cellsToRows(cells)
  if (rows.length === 0) {
    throw new Error('表格为空，暂无可导出的内容')
  }

  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0)
  const data = rows.map((row, rowIndex) => {
    const line: XlsxCell[] = []
    for (let c = 0; c < maxCols; c++) {
      const text = row[c] ?? ''
      if (rowIndex === 0) {
        line.push({ value: text, type: String, fontWeight: 700, backgroundColor: '#eef0f3' })
        continue
      }
      const num = toNumericIfPossible(text)
      line.push(num === null ? { value: text, type: String } : { value: num, type: Number })
    }
    return line
  })

  await writeXlsxFile([
    {
      sheet: title.slice(0, 31) || 'Sheet1',
      data,
      columns: Array.from({ length: maxCols }, () => ({ width: 16 })),
    },
  ]).toFile(`${title || '导出'}.xlsx`)
}

interface StyledXlsxCell {
  value: string | number
  type: typeof String | typeof Number
  fontWeight?: number
  backgroundColor?: string
  color?: string
  align?: string
}

/**
 * 带样式的稠密网格 → 下载 .xlsx。
 * - 公式单元格导出为**计算结果**（Excel 打开即见值）
 * - 单元格样式（加粗/背景/文字色/对齐）随单元格导出
 */
export async function exportGridToXlsx(grid: SheetCell[][], title: string): Promise<void> {
  if (grid.length === 0) {
    throw new Error('表格为空，暂无可导出的内容')
  }

  const maxCols = grid.reduce((max, row) => Math.max(max, row.length), 0)
  const getRaw = (r: number, c: number) => grid[r]?.[c]?.v ?? ''

  const data = grid.map((row, r): StyledXlsxCell[] => {
    const line: StyledXlsxCell[] = []
    for (let c = 0; c < maxCols; c++) {
      const cell: SheetCell = row[c] ?? { v: '' }
      const displayed = isFormula(cell.v)
        ? evaluateCellDisplay(cell.v, getRaw, r, c)
        : cell.v

      const base: StyledXlsxCell = {
        value: displayed,
        type: String,
      }
      if (cell.bg) base.backgroundColor = cell.bg
      if (cell.c) base.color = cell.c
      if (cell.al) base.align = cell.al
      if (cell.b) base.fontWeight = 700

      // 纯数字（非公式结果文本）转数值单元格
      if (!isFormula(cell.v)) {
        const num = toNumericIfPossible(displayed)
        if (num !== null) {
          base.value = num
          base.type = Number
        }
      }
      line.push(base)
    }
    return line
  })

  await writeXlsxFile([
    {
      sheet: title.slice(0, 31) || 'Sheet1',
      data,
      columns: Array.from({ length: maxCols }, () => ({ width: 16 })),
    },
  ]).toFile(`${title || '导出'}.xlsx`)
}
