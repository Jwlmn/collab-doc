import { describe, expect, it } from 'vitest'
import { extractTables, rowsToTableNode, tableNodeToRows, toNumericIfPossible } from '../tables'
import type { JSONContent } from '@tiptap/core'

const table = rowsToTableNode([
  ['名称', '数量'],
  ['苹果', '3'],
  ['香蕉', '2.5'],
])

describe('tables', () => {
  it('rowsToTableNode 首行为表头', () => {
    expect(table.content?.[0].content?.[0].type).toBe('tableHeader')
    expect(table.content?.[1].content?.[0].type).toBe('tableCell')
    expect(table.content?.[0].content?.[1].content?.[0].content?.[0].text).toBe('数量')
  })

  it('tableNodeToRows 还原文本（含补列）', () => {
    expect(tableNodeToRows(table)).toEqual([
      ['名称', '数量'],
      ['苹果', '3'],
      ['香蕉', '2.5'],
    ])

    const jagged: JSONContent = {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph' }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'b' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph' }] },
          ],
        },
      ],
    }
    expect(tableNodeToRows(jagged)).toEqual([
      ['', '', ''],
      ['a', 'b', ''],
    ])
  })

  it('extractTables 深度收集全部表格', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '前文' }] },
        table,
        {
          type: 'blockquote',
          content: [rowsToTableNode([['嵌套']])],
        },
      ],
    }
    expect(extractTables(doc)).toHaveLength(2)
  })

  it('toNumericIfPossible 识别数字', () => {
    expect(toNumericIfPossible('42')).toBe(42)
    expect(toNumericIfPossible('-3.14')).toBe(-3.14)
    expect(toNumericIfPossible('3.14')).toBe(3.14)
    expect(toNumericIfPossible('')).toBeNull()
    expect(toNumericIfPossible('12px')).toBeNull()
    expect(toNumericIfPossible('第3章')).toBeNull()
  })
})
