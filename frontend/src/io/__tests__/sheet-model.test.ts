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

/* ------------------------------------------------------------------ */
/*  C4：meta（列宽 / 行高 / 条件格式）                                   */
/* ------------------------------------------------------------------ */

describe('SheetModel meta', () => {
  it('列宽与行高：未设置返回 null，设置后可读，null 恢复默认', () => {
    const { model } = createModel()
    expect(model.getColWidth(0)).toBeNull()
    expect(model.getRowHeight(0)).toBeNull()

    model.setColWidth(0, 150)
    model.setRowHeight(2, 60)
    expect(model.getColWidth(0)).toBe(150)
    expect(model.getRowHeight(2)).toBe(60)

    model.setColWidth(0, null)
    model.setRowHeight(2, null)
    expect(model.getColWidth(0)).toBeNull()
    expect(model.getRowHeight(2)).toBeNull()
  })

  it('尺寸下限保护', () => {
    const { model } = createModel()
    model.setColWidth(0, 1)
    model.setRowHeight(0, 1)
    expect(model.getColWidth(0)).toBe(24)
    expect(model.getRowHeight(0)).toBe(16)
  })

  it('insertCol 平移列宽（from 起整体右移）', () => {
    const { model } = createModel()
    model.setColWidth(0, 100)
    model.setColWidth(3, 400)

    model.insertCol(0) // 0→1, 3→4
    expect(model.getColWidth(0)).toBeNull()
    expect(model.getColWidth(1)).toBe(100)
    expect(model.getColWidth(4)).toBe(400)
  })

  it('deleteCol 丢弃被删列并左移其余', () => {
    const { model } = createModel()
    model.setColWidth(1, 200)
    model.setColWidth(4, 500)

    model.deleteCol(1)
    expect(model.getColWidth(1)).toBeNull()
    expect(model.getColWidth(3)).toBe(500) // 4 → 3
  })

  it('insertRow / deleteRow 平移行高', () => {
    const { model } = createModel()
    model.seedRows(5)
    model.setRowHeight(0, 40)
    model.setRowHeight(4, 80)

    model.insertRow(0)
    expect(model.getRowHeight(0)).toBeNull()
    expect(model.getRowHeight(1)).toBe(40)
    expect(model.getRowHeight(5)).toBe(80)

    model.deleteRow(0)
    expect(model.getRowHeight(0)).toBe(40)
    expect(model.getRowHeight(4)).toBe(80)
  })

  it('条件格式规则 CRUD', () => {
    const { model } = createModel()
    expect(model.getCfRules()).toEqual({})

    model.setCfRule('r1', {
      r1: 0, c1: 0, r2: 9, c2: 0,
      op: 'gt', value: 60,
      style: { bg: '#e8f7ee' },
    })
    expect(Object.keys(model.getCfRules())).toEqual(['r1'])
    expect(model.getCfRules().r1.op).toBe('gt')

    model.removeCfRule('r1')
    expect(model.getCfRules()).toEqual({})
  })

  it('meta 快照往返（getMetaSnapshot → applyMetaSnapshot）', () => {
    const { model } = createModel()
    model.setColWidth(2, 220)
    model.setRowHeight(1, 55)
    model.setCfRule('k', { r1: 0, c1: 0, r2: 2, c2: 2, op: 'lt', value: 0, style: { c: '#d03050' } })

    const snap = model.getMetaSnapshot()
    expect(snap.colWidths).toEqual({ '2': 220 })
    expect(snap.rowHeights).toEqual({ '1': 55 })
    expect(snap.cfRules?.k.op).toBe('lt')

    // 换一个模型恢复
    const { model: fresh } = createModel()
    fresh.applyMetaSnapshot(snap)
    expect(fresh.getColWidth(2)).toBe(220)
    expect(fresh.getRowHeight(1)).toBe(55)
    expect(fresh.getCfRules().k.value).toBe(0)
  })

  it('applyMetaSnapshot(null) 不动现状（兼容旧快照）', () => {
    const { model } = createModel()
    model.setColWidth(0, 120)
    model.applyMetaSnapshot(null)
    model.applyMetaSnapshot({})
    expect(model.getColWidth(0)).toBe(120)
  })

  it('applyMetaSnapshot 覆盖已存在的 meta', () => {
    const { model } = createModel()
    model.setColWidth(0, 120)
    model.setColWidth(5, 999)
    model.applyMetaSnapshot({ colWidths: { '0': 300 } })
    expect(model.getColWidth(0)).toBe(300)
    expect(model.getColWidth(5)).toBeNull() // 不在快照里的键被清掉
  })

  it('observe 会被 meta 变更触发', () => {
    const { model } = createModel()
    let calls = 0
    const stop = model.observe(() => {
      calls++
    })
    const before = calls
    model.setColWidth(0, 100)
    expect(calls).toBeGreaterThan(before)
    stop()
  })

  it('meta 变更经 Y.Doc 传输后可在另一端读到', () => {
    const { ydoc, model } = createModel()
    model.setColWidth(1, 180)
    model.setCfRule('x', { r1: 0, c1: 0, r2: 1, c2: 1, op: 'gt', value: 5, style: {} })

    const update = Y.encodeStateAsUpdate(ydoc)
    const peer = new Y.Doc()
    Y.applyUpdate(peer, update)
    const peerModel = new SheetModel(peer)

    expect(peerModel.getColWidth(1)).toBe(180)
    expect(peerModel.getCfRules().x.op).toBe('gt')
  })
})

/* ------------------------------------------------------------------ */
/*  合并单元格                                                          */
/* ------------------------------------------------------------------ */

describe('SheetModel merges', () => {
  it('setMerge 归一化区域，仅锚点保留内容，被覆盖格清值留样式', () => {
    const { model } = createModel()
    model.seedRows(5)
    model.setCell(1, 1, '标题')
    model.setCell(1, 2, '会被清掉')
    model.setCell(2, 1, '也会')
    model.applyStyle(2, 1, { bg: '#eef' })

    // 传入逆序坐标 → 归一化为 (1,1)-(2,2)
    const m = model.setMerge({ r1: 2, c1: 2, r2: 1, c2: 1 })
    expect(m).toEqual({ r1: 1, c1: 1, r2: 2, c2: 2 })

    expect(model.getRaw(1, 1)).toBe('标题') // 锚点内容保留
    expect(model.getRaw(1, 2)).toBe('')
    expect(model.getRaw(2, 1)).toBe('') // 清值
    expect(model.getStyle(2, 1)).toEqual({ bg: '#eef' }) // 样式保留
    expect(model.getMerges()).toHaveLength(1)
  })

  it('getMergeAt 区域内任意格命中，未合并返回 null', () => {
    const { model } = createModel()
    model.seedRows(5)
    model.setMerge({ r1: 0, c1: 0, r2: 1, c2: 2 })

    expect(model.getMergeAt(0, 0)).toEqual({ r1: 0, c1: 0, r2: 1, c2: 2 })
    expect(model.getMergeAt(1, 2)).toEqual({ r1: 0, c1: 0, r2: 1, c2: 2 })
    expect(model.getMergeAt(2, 0)).toBeNull()
    expect(model.intersectsMerge(1, 1, 3, 3)).toBe(true)
    expect(model.intersectsMerge(3, 3, 4, 4)).toBe(false)
  })

  it('新合并与旧合并相交时吞掉旧的（Excel 语义）', () => {
    const { model } = createModel()
    model.seedRows(6)
    model.setMerge({ r1: 0, c1: 0, r2: 1, c2: 1 }) // A1:B2
    model.setMerge({ r1: 2, c1: 2, r2: 3, c2: 3 }) // C3:D4

    model.setMerge({ r1: 1, c1: 1, r2: 3, c2: 3 }) // 与两者都相交
    expect(model.getMerges()).toHaveLength(1)
    expect(model.getMergeAt(0, 0)).toBeNull() // 旧 A1:B2 已被移除
    expect(model.getMergeAt(2, 2)).toEqual({ r1: 1, c1: 1, r2: 3, c2: 3 })
  })

  it('toggleMerge：选区等于现有合并 → 取消；否则新建', () => {
    const { model } = createModel()
    model.seedRows(5)

    expect(model.toggleMerge({ r1: 0, c1: 0, r2: 0, c2: 1 })).toEqual({
      r1: 0, c1: 0, r2: 0, c2: 1,
    })
    // 整体选中该合并 → 取消
    expect(model.toggleMerge({ r1: 0, c1: 0, r2: 0, c2: 1 })).toBeNull()
    expect(model.getMerges()).toHaveLength(0)

    // 1×1 区域等价于取消
    model.setMerge({ r1: 2, c1: 2, r2: 3, c2: 3 })
    expect(model.setMerge({ r1: 2, c1: 2, r2: 2, c2: 2 })).toBeNull()
    expect(model.getMerges()).toHaveLength(0)
  })

  it('insertRow 区间内插入则扩张，后方插入则平移', () => {
    const { model } = createModel()
    model.seedRows(6)
    model.setMerge({ r1: 1, c1: 0, r2: 3, c2: 0 }) // 纵向跨 1–3 行

    model.insertRow(2) // 插在区间内 → 扩张
    expect(model.getMergeAt(1, 0)).toEqual({ r1: 1, c1: 0, r2: 4, c2: 0 })

    model.insertRow(0) // 插在区间前 → 整体平移
    expect(model.getMergeAt(2, 0)).toEqual({ r1: 2, c1: 0, r2: 5, c2: 0 })
  })

  it('deleteRow 区间内收缩、整体后移平移、单行合并退化则移除', () => {
    const { model } = createModel()
    model.seedRows(8)
    model.setMerge({ r1: 2, c1: 0, r2: 5, c2: 0 })

    model.deleteRow(3) // 区间内 → 收缩
    expect(model.getMergeAt(2, 0)).toEqual({ r1: 2, c1: 0, r2: 4, c2: 0 })

    model.deleteRow(0) // 区间前 → 平移
    expect(model.getMergeAt(1, 0)).toEqual({ r1: 1, c1: 0, r2: 3, c2: 0 })

    // 单行横向合并所在行被删 → 移除
    model.setMerge({ r1: 0, c1: 2, r2: 0, c2: 4 })
    model.deleteRow(0)
    expect(model.getMergeAt(0, 3)).toBeNull()
  })

  it('insertCol / deleteCol 平移与收缩合并区间', () => {
    const { model } = createModel()
    model.seedRows(3)
    model.setMerge({ r1: 0, c1: 1, r2: 0, c2: 3 }) // 横向 B1:D1

    model.insertCol(0) // 前方插入 → 平移
    expect(model.getMergeAt(0, 2)).toEqual({ r1: 0, c1: 2, r2: 0, c2: 4 })

    model.deleteCol(0) // 平移回去
    expect(model.getMergeAt(0, 1)).toEqual({ r1: 0, c1: 1, r2: 0, c2: 3 })

    model.deleteCol(2) // 区间内（原 c2=3 的第 3 列）→ 收缩
    expect(model.getMergeAt(0, 1)).toEqual({ r1: 0, c1: 1, r2: 0, c2: 2 })
  })

  it('merges 进 meta 快照并可恢复；旧快照（无 merges）不动现状', () => {
    const { model } = createModel()
    model.seedRows(5)
    model.setMerge({ r1: 0, c1: 0, r2: 1, c2: 1 })

    const snap = model.getMetaSnapshot()
    expect(snap.merges).toEqual({ '0,0': { r1: 0, c1: 0, r2: 1, c2: 1 } })

    const { model: fresh } = createModel()
    fresh.seedRows(5)
    fresh.applyMetaSnapshot(snap)
    expect(fresh.getMergeAt(1, 1)).toEqual({ r1: 0, c1: 0, r2: 1, c2: 1 })

    // 旧快照兼容：无 merges 字段 → 现状保留
    fresh.applyMetaSnapshot({})
    expect(fresh.getMerges()).toHaveLength(1)

    // 覆盖语义：传空 merges 对 → 清掉
    fresh.applyMetaSnapshot({ merges: {} })
    expect(fresh.getMerges()).toHaveLength(0)
  })

  it('merges 子表变更会触发 observe（嵌套 Y.Map 深度观察）', () => {
    const { model } = createModel()
    let calls = 0
    const stop = model.observe(() => {
      calls++
    })
    const before = calls
    model.setMerge({ r1: 0, c1: 0, r2: 1, c2: 2 })
    expect(calls).toBeGreaterThan(before)

    const mid = calls
    model.unmergeOverlapping({ r1: 0, c1: 0, r2: 1, c2: 2 })
    expect(calls).toBeGreaterThan(mid)
    stop()
  })

  it('merges 变更经 Y.Doc 传输后可在另一端读到', () => {
    const { ydoc, model } = createModel()
    model.seedRows(5)
    model.setMerge({ r1: 1, c1: 1, r2: 2, c2: 3 })

    const peer = new Y.Doc()
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(ydoc))
    const peerModel = new SheetModel(peer)
    expect(peerModel.getMergeAt(2, 2)).toEqual({ r1: 1, c1: 1, r2: 2, c2: 3 })
  })
})
