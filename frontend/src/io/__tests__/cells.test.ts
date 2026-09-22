import { describe, expect, it } from 'vitest'
import { cellBounds, cellKey, cellsToRows, columnLabel, rowsToCells } from '../cells'

describe('cells', () => {
  it('rowsToCells 稀疏化存储（空串不写入）', () => {
    const cells = rowsToCells([
      ['名称', '数量'],
      ['苹果', ''],
      ['', '3'],
    ])
    expect(cells).toEqual({
      '0,0': '名称',
      '0,1': '数量',
      '1,0': '苹果',
      '2,1': '3',
    })
  })

  it('cellsToRows 还原稠密网格到数据边界', () => {
    const cells = rowsToCells([
      ['A', 'B'],
      ['1', ''],
    ])
    expect(cellsToRows(cells)).toEqual([
      ['A', 'B'],
      ['1', ''],
    ])
  })

  it('往返 rows → cells → rows 一致', () => {
    const rows = [
      ['表头1', '表头2', '表头3'],
      ['x', '99.5', ''],
      ['', '', '尾巴'],
    ]
    expect(cellsToRows(rowsToCells(rows))).toEqual(rows)
  })

  it('cellBounds 计算数据边界', () => {
    expect(cellBounds({})).toEqual({ rows: 0, cols: 0 })
    expect(cellBounds({ '0,0': 'x' })).toEqual({ rows: 1, cols: 1 })
    expect(cellBounds({ '4,7': 'x', '2,3': 'y' })).toEqual({ rows: 5, cols: 8 })
  })

  it('columnLabel 索引转 Excel 列头', () => {
    expect(columnLabel(0)).toBe('A')
    expect(columnLabel(25)).toBe('Z')
    expect(columnLabel(26)).toBe('AA')
    expect(columnLabel(27)).toBe('AB')
    expect(columnLabel(51)).toBe('AZ')
    expect(columnLabel(52)).toBe('BA')
  })

  it('cellKey 格式', () => {
    expect(cellKey(3, 12)).toBe('3,12')
  })
})
