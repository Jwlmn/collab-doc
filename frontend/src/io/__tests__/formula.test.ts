import { describe, expect, it } from 'vitest'
import {
  FORMULA_CYCLE,
  FORMULA_ERROR,
  evaluateCellDisplay,
  isFormula,
  parseCellRef,
} from '../formula'

/** 构造极简网格上下文：cells[r][c] */
function makeGrid(cells: Record<string, string>) {
  return (r: number, c: number) => cells[`${r},${c}`] ?? ''
}

describe('formula 基础', () => {
  it('isFormula', () => {
    expect(isFormula('=1+1')).toBe(true)
    expect(isFormula('1+1')).toBe(false)
  })

  it('parseCellRef', () => {
    expect(parseCellRef('A1')).toEqual({ r: 0, c: 0 })
    expect(parseCellRef('B3')).toEqual({ r: 2, c: 1 })
    expect(parseCellRef('$C$10')).toEqual({ r: 9, c: 2 })
    expect(parseCellRef('AA1')).toEqual({ r: 0, c: 26 })
    expect(parseCellRef('bad')).toBeNull()
  })
})

describe('evaluateCellDisplay 四则运算', () => {
  // 公式位于 (9,0)，与被引用的数据格分离（写在同一格会构成自引用）
  const evalAt = (raw: string, grid: Record<string, string> = {}, r = 9, c = 0) =>
    evaluateCellDisplay(raw, makeGrid(grid), r, c)

  it('常量表达式', () => {
    expect(evalAt('=1+2*3')).toBe('7')
    expect(evalAt('=(1+2)*3')).toBe('9')
    expect(evalAt('=10/4')).toBe('2.5')
    expect(evalAt('=-5+2')).toBe('-3')
  })

  it('单元格引用', () => {
    // A1 = (0,0), B1 = (0,1)
    const grid = { '0,0': '10', '0,1': '5' }
    expect(evalAt('=A1+B1', grid)).toBe('15')
    expect(evalAt('=A1*B1', grid)).toBe('50')
    expect(evalAt('=A1/A1', grid)).toBe('1')
  })

  it('公式引用公式（链式）', () => {
    const grid = { '0,0': '2', '0,1': '=A1*3', '0,2': '=B1+1' }
    // C1 = B1+1 = 2*3+1 = 7
    expect(evalAt('=C1', grid)).toBe('7')
  })

  it('空引用视为 0，非数字文本报错', () => {
    expect(evalAt('=A1+1', {})).toBe('1')
    expect(evalAt('=A1+1', { '0,0': 'abc' })).toBe(FORMULA_ERROR)
    expect(evalAt('=A1+1', { '0,0': '3' })).toBe('4')
  })

  it('除零与语法错误', () => {
    expect(evalAt('=1/0')).toBe(FORMULA_ERROR)
    expect(evalAt('=1+')).toBe(FORMULA_ERROR)
    expect(evalAt('=SUM(')).toBe(FORMULA_ERROR)
    expect(evalAt('=')).toBe(FORMULA_ERROR)
  })

  it('非公式原样返回', () => {
    expect(evalAt('普通文本')).toBe('普通文本')
    expect(evalAt('3.14')).toBe('3.14')
  })

  it('循环引用返回 #CYCLE!', () => {
    // A1 → A2 → A1 真环（公式位于 (9,0)）
    const grid = { '0,0': '=A2', '1,0': '=A1' }
    expect(evalAt('=A1', grid)).toBe(FORMULA_CYCLE)
    // 自引用：公式格即被引用格
    expect(evaluateCellDisplay('=B1', makeGrid({ '0,1': '=B1' }), 0, 1)).toBe(FORMULA_CYCLE)
  })
})

describe('evaluateCellDisplay 函数', () => {
  const evalAt = (raw: string, grid: Record<string, string> = {}, r = 9, c = 0) =>
    evaluateCellDisplay(raw, makeGrid(grid), r, c)

  const numericRange = {
    '0,0': '1',
    '1,0': '2',
    '2,0': '3',
    '0,1': 'x',
    '1,1': '4',
  }

  it('SUM 区间', () => {
    expect(evalAt('=SUM(A1:A3)', numericRange)).toBe('6')
    expect(evalAt('=SUM(A1:A3,B2)', numericRange)).toBe('10')
    expect(evalAt('=SUM(B1:B3)', numericRange)).toBe('4') // 非数字 x 计 0
    expect(evalAt('=SUM(A1,3,4)', numericRange)).toBe('8')
  })

  it('AVG/MIN/MAX/COUNT', () => {
    expect(evalAt('=AVG(A1:A3)', numericRange)).toBe('2')
    expect(evalAt('=MIN(A1:A3)', numericRange)).toBe('1')
    expect(evalAt('=MAX(A1:A3,B2)', numericRange)).toBe('4')
    expect(evalAt('=COUNT(A1:B2)', numericRange)).toBe('3') // Excel 语义只计数值
  })

  it('SUM 聚合公式链', () => {
    const grid = { '0,0': '10', '1,0': '=A1*2' }
    // SUM(A1:A2) = 10 + 20
    expect(evalAt('=SUM(A1:A2)', grid)).toBe('30')
  })
})
