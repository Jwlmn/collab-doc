import { describe, expect, it } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import {
  describeGridDiff,
  diffGrids,
  diffLinesBetween,
  mdBlocksToLines,
} from '../version-diff'
import type { SheetCell } from '../sheet-model'

function doc(...blocks: JSONContent[]): JSONContent {
  return { type: 'doc', content: blocks }
}

function paragraph(text: string): JSONContent {
  return { type: 'paragraph', content: [{ type: 'text', text }] }
}

function heading(level: number, text: string): JSONContent {
  return { type: 'heading', attrs: { level }, content: [{ type: 'text', text }] }
}

function cell(v: string, extra: Partial<SheetCell> = {}): SheetCell {
  return { v, ...extra }
}

describe('mdBlocksToLines', () => {
  it('把标题与段落转成带前缀的行', () => {
    expect(mdBlocksToLines(doc(heading(2, '标题'), paragraph('正文内容')))).toEqual([
      '## 标题',
      '正文内容',
    ])
  })

  it('展开列表项为独立行', () => {
    const list: JSONContent = {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [paragraph('甲')] },
        { type: 'listItem', content: [paragraph('乙')] },
      ],
    }
    expect(mdBlocksToLines(doc(list))).toEqual(['- 甲', '- 乙'])
  })

  it('表格行按单元格连接', () => {
    const table: JSONContent = {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [paragraph('A1')] },
            { type: 'tableCell', content: [paragraph('B1')] },
          ],
        },
      ],
    }
    expect(mdBlocksToLines(doc(table))).toEqual(['A1 | B1'])
  })

  it('空文档与非法输入返回空数组', () => {
    expect(mdBlocksToLines(doc())).toEqual([])
    expect(mdBlocksToLines(null)).toEqual([])
    expect(mdBlocksToLines('not a doc')).toEqual([])
  })
})

describe('diffLinesBetween', () => {
  it('区分新增、删除与未变（方向：当前 → 快照）', () => {
    // added = 只在快照（恢复后会出现）；removed = 只在当前（恢复后会消失）
    const lines = diffLinesBetween(['标题', '第一段', '新增段'], ['标题', '旧段', '第一段'])
    expect(lines).toEqual([
      { kind: 'equal', text: '标题' },
      { kind: 'added', text: '旧段' },
      { kind: 'equal', text: '第一段' },
      { kind: 'removed', text: '新增段' },
    ])
  })

  it('完全相同只返回 equal', () => {
    expect(diffLinesBetween(['a'], ['a'])).toEqual([{ kind: 'equal', text: 'a' }])
  })

  it('方向：removed 是恢复后会消失的行', () => {
    // 当前多出一行 b，快照没有 → 恢复后 b 消失 → removed
    const lines = diffLinesBetween(['a', 'b'], ['a'])
    expect(lines.find((l) => l.text === 'b')?.kind).toBe('removed')
  })
})

describe('diffGrids', () => {
  it('无差异时统计全零', () => {
    const grid = [[cell('1'), cell('2')]]
    const diff = diffGrids(grid, grid)
    expect(diff.rows).toHaveLength(1)
    expect(diff.rows[0].status).toBe('same')
    expect(diff.changedCells).toBe(0)
    expect(diff.addedRows).toBe(0)
    expect(diff.removedRows).toBe(0)
    expect(describeGridDiff(diff)).toBe('无差异')
  })

  it('识别单元格值变化', () => {
    const diff = diffGrids([[cell('新值')]], [[cell('旧值')]])
    expect(diff.rows[0].status).toBe('changed')
    expect(diff.rows[0].cells[0]).toMatchObject({ status: 'changed', before: '新值', after: '旧值' })
    expect(diff.changedCells).toBe(1)
    expect(describeGridDiff(diff)).toBe('修改 1 单元格')
  })

  it('值未变但样式变化也算改动', () => {
    const diff = diffGrids([[cell('1')]], [[cell('1', { b: 1 })]])
    expect(diff.rows[0].status).toBe('changed')
    expect(diff.changedCells).toBe(1)
  })

  it('当前多出的行标记为 removed（恢复后消失）', () => {
    const diff = diffGrids([[cell('a')], [cell('b')]], [[cell('a')]])
    expect(diff.removedRows).toBe(1)
    expect(diff.rows[1].status).toBe('removed')
  })

  it('快照多出的行标记为 added（恢复后出现）', () => {
    const diff = diffGrids([[cell('a')]], [[cell('a')], [cell('c')]])
    expect(diff.addedRows).toBe(1)
    expect(diff.rows[1].status).toBe('added')
    expect(describeGridDiff(diff)).toBe('新增 1 行')
  })

  it('裁掉尾部空行，空行不制造噪音', () => {
    const withBlanks = [[cell('a')], [cell('')], [cell('')]]
    const diff = diffGrids(withBlanks, [[cell('a')]])
    expect(diff.rows).toHaveLength(1)
    expect(diff.changedCells).toBe(0)
  })

  it('行位置移动按最小差异对齐（删一留一增一）', () => {
    // b、c 两行调换 → 最小 diff 是删 b、留 c、增 b，而不是两行全改
    const diff = diffGrids([[cell('b')], [cell('c')]], [[cell('c')], [cell('b')]])
    expect(diff.rows).toHaveLength(3)
    expect(diff.removedRows).toBe(1)
    expect(diff.addedRows).toBe(1)
    expect(diff.rows.filter((r) => r.status === 'same')).toHaveLength(1)
    // changedCells 只统计对齐行内的格子改动
    expect(diff.changedCells).toBe(0)
  })
})
