import writeXlsxFile from 'write-excel-file/browser'
import type { JSONContent } from '@tiptap/core'
import { extractTables, tableNodeToRows, toNumericIfPossible } from './tables'

interface XlsxCell {
  value: string | number
  type: typeof String | typeof Number
  fontWeight?: number
  backgroundColor?: string
}

/**
 * 文档中的全部表格 → xlsx Blob（每个表格一个工作表）。
 * 文档没有表格时抛出面向用户的错误。
 */
export async function buildTablesXlsxBlob(doc: JSONContent, title: string): Promise<Blob> {
  const tables = extractTables(doc)

  if (tables.length === 0) {
    throw new Error('文档中没有可导出的表格，请先用工具栏插入表格')
  }

  const sheets = tables.map((table, index) => {
    const rows = tableNodeToRows(table)
    const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0)

    const data = rows.map((row, rowIndex) => {
      const cells: XlsxCell[] = []
      for (let col = 0; col < maxCols; col++) {
        const text = row[col] ?? ''
        if (rowIndex === 0) {
          cells.push({
            value: text,
            type: String,
            fontWeight: 700,
            backgroundColor: '#eef0f3',
          })
          continue
        }
        const num = toNumericIfPossible(text)
        cells.push(
          num === null ? { value: text, type: String } : { value: num, type: Number },
        )
      }
      return cells
    })

    return {
      sheet: tables.length > 1 ? `表${index + 1}` : title.slice(0, 31) || 'Sheet1',
      data,
      columns: Array.from({ length: maxCols }, () => ({ width: 18 })),
    }
  })

  return writeXlsxFile(sheets).toBlob()
}

/** 文档表格 → 触发浏览器下载 .xlsx */
export async function exportTablesToXlsx(doc: JSONContent, title: string): Promise<void> {
  const blob = await buildTablesXlsxBlob(doc, title)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${title || '导出'}.xlsx`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
