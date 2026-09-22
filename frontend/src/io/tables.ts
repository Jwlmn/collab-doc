import type { JSONContent } from '@tiptap/core'

/** 提取文档中全部 table 节点 */
export function extractTables(doc: JSONContent): JSONContent[] {
  const tables: JSONContent[] = []

  const walk = (node: JSONContent) => {
    if (node.type === 'table') {
      tables.push(node)
      return
    }
    for (const child of node.content ?? []) walk(child)
  }

  walk(doc)
  return tables
}

/** 单元格块内容 → 纯文本（段落间空格连接） */
export function cellPlainText(content: JSONContent[] | undefined): string {
  if (!content) return ''
  return content
    .map((block) => {
      const inline = (block.content ?? [])
        .map((n) => n.text ?? '')
        .join('')
      return inline
    })
    .join(' ')
    .trim()
}

/**
 * table 节点 → 二维单元格文本（含表头行）。
 * 空单元格为 ''，行宽不齐时按最大列数补 ''。
 */
export function tableNodeToRows(table: JSONContent): string[][] {
  const rows = table.content ?? []
  const parsed: string[][] = rows.map((row) =>
    (row.content ?? []).map((cell) => cellPlainText(cell.content)),
  )

  const maxCols = parsed.reduce((max, row) => Math.max(max, row.length), 0)
  return parsed.map((row) => {
    const padded = [...row]
    while (padded.length < maxCols) padded.push('')
    return padded
  })
}

/** 数字文本 → Excel 数值单元格（保持文本则返回 null） */
export function toNumericIfPossible(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '' || !/^-?\d+(\.\d+)?$/.test(trimmed)) return null
  const num = Number(trimmed)
  return Number.isFinite(num) ? num : null
}

/** 二维文本 → Tiptap table JSON（首行为表头） */
export function rowsToTableNode(rows: string[][]): JSONContent {
  const tableRows: JSONContent[] = rows.map((row, rowIndex) => ({
    type: 'tableRow',
    content: row.map((text) => ({
      type: rowIndex === 0 ? 'tableHeader' : 'tableCell',
      content: text
        ? [{ type: 'paragraph', content: [{ type: 'text', text }] }]
        : [{ type: 'paragraph' }],
    })),
  }))

  return { type: 'table', content: tableRows }
}
