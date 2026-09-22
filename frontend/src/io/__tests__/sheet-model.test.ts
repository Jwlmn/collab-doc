import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { SheetModel, colLabelToIndex, DEFAULT_ROWS } from '../sheet-model'

function createModel(): { ydoc: Y.Doc; model: SheetModel } {
  const ydoc = new Y.Doc()
  const model = new SheetModel(ydoc)
  return { ydoc, model }
}

describe('SheetModel 行模型', () => {
  it('seedRows 创建默认行数', () => {
    const { model } = createModel()
    model.seedRows()
    expect(model.rowCount).toBe(DEFAULT_ROWS)
    expect(model.colCount).toBe(0)
  })

  it('setCell/getRaw 稀疏读写，空串删除', () => {
    const { model } = createModel()
    model.seedRows(5)
    model.setCell(1, 2, '苹果')
    expect(model.getRaw(1, 2)).toBe('苹果')
    expect(model.getRaw(0, 0)).toBe('')

    model.setCell(1, 2, '')
    expect(model.getRaw(1, 2)).toBe('')
  })

  it('colCount 跟随数据边界', () => {
    const { model } = createModel()
    model.seedRows(5)
    model.setCell(0, 0, 'a')
    model.setCell(2, 7, 'b')
    expect(model.colCount).toBe(8)
  })

  it('insertRow/deleteRow 结构操作', () => {
    const { model } = createModel()
    model.seedRows(3)
    model.setCell(1, 0, 'keep')

    model.insertRow(1) // 在第1行前插入 → keep 挪到第2行
    expect(model.rowCount).toBe(4)
    expect(model.getRaw(1, 0)).toBe('')
    expect(model.getRaw(2, 0)).toBe('keep')

    model.deleteRow(2) // 删除 keep 所在行
    expect(model.rowCount).toBe(3)
    expect(model.getRaw(2, 0)).toBe('')
  })

  it('删除仅剩的一行时清空而非移除', () => {
    const { model } = createModel()
    model.rows.push([new Y.Map()])
    model.setCell(0, 0, 'only')
    model.deleteRow(0)
    expect(model.rowCount).toBe(1)
    expect(model.getRaw(0, 0)).toBe('')
  })

  it('insertCol 右移目标列及之后', () => {
    const { model } = createModel()
    model.seedRows(2)
    model.setCell(0, 0, 'A')
    model.setCell(0, 1, 'B')
    model.setCell(1, 1, 'b')

    model.insertCol(1) // 在第1列前插入 → 原 B 移到第2列
    expect(model.getRaw(0, 0)).toBe('A')
    expect(model.getRaw(0, 1)).toBe('') // 新空列
    expect(model.getRaw(0, 2)).toBe('B')
    expect(model.getRaw(1, 2)).toBe('b')
  })

  it('deleteCol 左移后续列', () => {
    const { model } = createModel()
    model.seedRows(1)
    model.setCell(0, 0, 'A')
    model.setCell(0, 1, 'B')
    model.setCell(0, 2, 'C')

    model.deleteCol(1) // 删除 B
    expect(model.getRaw(0, 0)).toBe('A')
    expect(model.getRaw(0, 1)).toBe('C')
    expect(model.getRaw(0, 2)).toBe('')
    expect(model.colCount).toBe(2)
  })

  it('样式读写与清除', () => {
    const { model } = createModel()
    model.seedRows(1)

    model.setCell(0, 0, '标题')
    model.applyStyle(0, 0, { b: 1, bg: '#ffe' })
    expect(model.getRaw(0, 0)).toBe('标题')
    expect(model.getStyle(0, 0)).toEqual({ b: 1, bg: '#ffe' })

    model.applyStyle(0, 0, { b: null })
    expect(model.getStyle(0, 0)).toEqual({ bg: '#ffe' })

    // 文本仍在时仅清样式，不删格
    model.applyStyle(0, 0, { bg: null })
    expect(model.getRaw(0, 0)).toBe('标题')

    // 清空文本后（已无样式）→ 删除占位
    model.setCell(0, 0, '')
    expect(model.getCell(0, 0)).toBeUndefined()

    // 纯样式空格（无文本）会创建占位
    model.applyStyle(1, 1, { bg: '#eef' })
    expect(model.getStyle(1, 1)).toEqual({ bg: '#eef' })
    expect(model.getRaw(1, 1)).toBe('')
  })

  it('fillFromCells 迁移稀疏表', () => {
    const { model } = createModel()
    model.fillFromCells({ '0,0': '名', '2,3': '值' })
    expect(model.rowCount).toBeGreaterThanOrEqual(3)
    expect(model.getRaw(0, 0)).toBe('名')
    expect(model.getRaw(2, 3)).toBe('值')
  })

  it('observe 捕捉行内与结构变更', () => {
    const { model } = createModel()
    let calls = 0
    const stop = model.observe(() => {
      calls++
    })
    const base = calls

    model.seedRows(3)
    model.setCell(0, 0, 'x')
    model.insertRow(1)
    expect(calls).toBeGreaterThan(base)
    stop()
  })

  it('toCells / toGrid / replaceGrid 往返', () => {
    const { model } = createModel()
    model.seedRows(3)
    model.setCell(0, 0, '表头')
    model.setCell(1, 1, '42')
    model.applyStyle(0, 0, { b: 1 })

    const grid = model.toGrid()
    expect(grid[0][0]).toEqual({ v: '表头', b: 1 })
    expect(grid[1][1]).toEqual({ v: '42' })

    const { model: model2 } = createModel()
    model2.replaceGrid(grid)
    expect(model2.getRaw(0, 0)).toBe('表头')
    expect(model2.getStyle(0, 0)).toEqual({ b: 1 })
    expect(model2.getRaw(1, 1)).toBe('42')
    expect(model2.rowCount).toBe(model.rowCount)
  })

  it('migrateLegacyCells v1→v2', () => {
    const { ydoc, model } = createModel()
    const legacy = ydoc.getMap<string>('cells')
    legacy.set('0,0', '旧数据')
    legacy.set('1,2', 'x')

    expect(model.migrateLegacyCells()).toBe(true)
    expect(model.getRaw(0, 0)).toBe('旧数据')
    expect(model.getRaw(1, 2)).toBe('x')
    expect(legacy.size).toBe(0)
    // 已有 rows → 不再迁移
    expect(model.migrateLegacyCells()).toBe(false)
  })

  it('colLabelToIndex', () => {
    expect(colLabelToIndex('A')).toBe(0)
    expect(colLabelToIndex('Z')).toBe(25)
    expect(colLabelToIndex('AA')).toBe(26)
    expect(colLabelToIndex('AB')).toBe(27)
  })
})
