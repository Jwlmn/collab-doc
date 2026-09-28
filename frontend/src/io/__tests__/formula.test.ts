import { describe, expect, it } from 'vitest'
import {
  FORMULA_CYCLE,
  FORMULA_ERROR,
  FORMULA_NA,
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

/* ------------------------------------------------------------------ */
/*  C4：比较运算、字符串、新增函数                                       */
/* ------------------------------------------------------------------ */

describe('比较运算符', () => {
  const evalAt = (raw: string, grid: Record<string, string> = {}, r = 9, c = 0) =>
    evaluateCellDisplay(raw, makeGrid(grid), r, c)

  it('六种比较运算', () => {
    expect(evalAt('=1=1')).toBe('TRUE')
    expect(evalAt('=1=2')).toBe('FALSE')
    expect(evalAt('=1<>2')).toBe('TRUE')
    expect(evalAt('=1<2')).toBe('TRUE')
    expect(evalAt('=2>1')).toBe('TRUE')
    expect(evalAt('=2<=2')).toBe('TRUE')
    expect(evalAt('=2>=3')).toBe('FALSE')
  })

  it('比较优先级低于加减', () => {
    expect(evalAt('=1+1>1')).toBe('TRUE')
    expect(evalAt('=2*3=6')).toBe('TRUE')
    // 左结合：(1+1) > 1 而非 1 + (1>1)
    expect(evalAt('=1+1=2')).toBe('TRUE')
  })

  it('单元格引用参与比较', () => {
    const grid = { '0,0': '10', '1,0': '20', '0,1': '20' } // A1=10, A2=20, B1=20
    expect(evalAt('=A1<A2', grid)).toBe('TRUE')
    expect(evalAt('=A1+B1=30', grid)).toBe('TRUE')
  })

  it('字符串比较按字典序', () => {
    expect(evalAt('="apple"<"banana"')).toBe('TRUE')
    expect(evalAt('="apple"="apple"')).toBe('TRUE')
    expect(evalAt('="a"<>"b"')).toBe('TRUE')
  })

  it('跨类型比较：数字小于文本（Excel 语义）', () => {
    expect(evalAt('=1<"apple"')).toBe('TRUE')
    expect(evalAt('="apple"<1')).toBe('FALSE')
  })
})

describe('字符串字面量与布尔', () => {
  const evalAt = (raw: string, grid: Record<string, string> = {}, r = 9, c = 0) =>
    evaluateCellDisplay(raw, makeGrid(grid), r, c)

  it('双引号与单引号字符串', () => {
    expect(evalAt('="hello"')).toBe('hello')
    expect(evalAt("='world'")).toBe('world')
    expect(evalAt('=""')).toBe('')
  })

  it('字符串内可含运算符而不被切分', () => {
    expect(evalAt('="a+b"')).toBe('a+b')
    expect(evalAt('="1>2"')).toBe('1>2')
  })

  it('未闭合字符串报错', () => {
    expect(evalAt('="abc')).toBe(FORMULA_ERROR)
  })

  it('TRUE / FALSE 字面量', () => {
    expect(evalAt('=TRUE')).toBe('TRUE')
    expect(evalAt('=FALSE')).toBe('FALSE')
    expect(evalAt('=NOTMISSING')).toBe(FORMULA_ERROR) // 未知标识符仍报错
  })
})

describe('ROUND / ABS / LEN', () => {
  const evalAt = (raw: string, grid: Record<string, string> = {}, r = 9, c = 0) =>
    evaluateCellDisplay(raw, makeGrid(grid), r, c)

  it('ROUND 四舍五入', () => {
    expect(evalAt('=ROUND(3.14159,2)')).toBe('3.14')
    expect(evalAt('=ROUND(3.14159,0)')).toBe('3')
    expect(evalAt('=ROUND(2.5,0)')).toBe('3') // away-from-zero
    expect(evalAt('=ROUND(-2.5,0)')).toBe('-3')
    expect(evalAt('=ROUND(1234,-2)')).toBe('1200')
    expect(evalAt('=ROUND(1.005,2)')).toBe('1.01')
  })

  it('ROUND 参数取自单元格', () => {
    expect(evalAt('=ROUND(A1,1)', { '0,0': '1.2345' })).toBe('1.2')
    expect(evalAt('=ROUND(1.2345,A1)', { '0,0': '3' })).toBe('1.235')
  })

  it('ABS / LEN', () => {
    expect(evalAt('=ABS(-42)')).toBe('42')
    expect(evalAt('=ABS(42-100)')).toBe('58')
    expect(evalAt('=LEN("hello")')).toBe('5')
    expect(evalAt('=LEN("中文")')).toBe('2')
    expect(evalAt('=LEN(A1)', { '0,0': 'abcdef' })).toBe('6')
  })
})

describe('CONCAT', () => {
  const evalAt = (raw: string, grid: Record<string, string> = {}, r = 9, c = 0) =>
    evaluateCellDisplay(raw, makeGrid(grid), r, c)

  it('拼接字面量与单元格', () => {
    expect(evalAt('=CONCAT("a","b")')).toBe('ab')
    expect(evalAt('=CONCAT("第",A1,"名")', { '0,0': '一' })).toBe('第一名')
    expect(evalAt('=CONCAT("n=",A1)', { '0,0': '42' })).toBe('n=42')
  })

  it('区间摊平拼接（保留文本）', () => {
    expect(evalAt('=CONCAT(A1:A3)', { '0,0': 'x', '1,0': 'y', '2,0': 'z' })).toBe('xyz')
  })

  it('空格与数字转文本', () => {
    expect(evalAt('=CONCAT(1,2,3)')).toBe('123')
    expect(evalAt('=CONCAT("a",A1)', { '0,0': '' })).toBe('a')
  })
})

describe('IF 惰性求值', () => {
  const evalAt = (raw: string, grid: Record<string, string> = {}, r = 9, c = 0) =>
    evaluateCellDisplay(raw, makeGrid(grid), r, c)

  it('条件为真走 then', () => {
    expect(evalAt('=IF(1=1,10,20)')).toBe('10')
    expect(evalAt('=IF(TRUE,10,20)')).toBe('10')
    expect(evalAt('=IF(2>1,A1,20)', { '0,0': '99' })).toBe('99')
  })

  it('条件为假走 else', () => {
    expect(evalAt('=IF(1=2,10,20)')).toBe('20')
    expect(evalAt('=IF(FALSE,10,A1)', { '0,0': '99' })).toBe('99')
  })

  it('未选中的分支不会被求值（除零不报错）', () => {
    expect(evalAt('=IF(TRUE,5,1/0)')).toBe('5')
    expect(evalAt('=IF(FALSE,1/0,5)')).toBe('5')
  })

  it('未选中的分支里自引用不构成循环', () => {
    // 公式在 (9,0)，A10 自引用被跳过 → 不应 #CYCLE!
    expect(evalAt('=IF(TRUE,1,A10)')).toBe('1')
  })

  it('IF 可返回文本', () => {
    expect(evalAt('=IF(A1>60,"及格","不及格")', { '0,0': '80' })).toBe('及格')
    expect(evalAt('=IF(A1>60,"及格","不及格")', { '0,0': '50' })).toBe('不及格')
  })

  it('嵌套 IF', () => {
    const grid = { '0,0': '85' }
    expect(evalAt('=IF(A1>=90,"优",IF(A1>=60,"良","差"))', grid)).toBe('良')
    expect(evalAt('=IF(A1>=90,"优",IF(A1>=60,"良","差"))', { '0,0': '95' })).toBe('优')
    expect(evalAt('=IF(A1>=90,"优",IF(A1>=60,"良","差"))', { '0,0': '30' })).toBe('差')
  })

  it('文本条件报错（Excel 语义）', () => {
    expect(evalAt('=IF("abc",1,2)')).toBe(FORMULA_ERROR)
  })

  it('IF 参与算术时按数字', () => {
    expect(evalAt('=IF(TRUE,2,3)*10')).toBe('20')
  })
})

describe('AND / OR', () => {
  const evalAt = (raw: string, grid: Record<string, string> = {}, r = 9, c = 0) =>
    evaluateCellDisplay(raw, makeGrid(grid), r, c)

  it('AND 全真为真', () => {
    expect(evalAt('=AND(TRUE,TRUE)')).toBe('TRUE')
    expect(evalAt('=AND(TRUE,FALSE)')).toBe('FALSE')
    expect(evalAt('=AND(1=1,2>1)')).toBe('TRUE')
    expect(evalAt('=AND(1=1,2>5)')).toBe('FALSE')
  })

  it('OR 一真即真', () => {
    expect(evalAt('=OR(FALSE,FALSE)')).toBe('FALSE')
    expect(evalAt('=OR(FALSE,TRUE)')).toBe('TRUE')
    expect(evalAt('=OR(1>2,3>2)')).toBe('TRUE')
  })

  it('数字 0 视为假，文本条件报错', () => {
    expect(evalAt('=AND(1,0)')).toBe('FALSE')
    expect(evalAt('=OR(0,1)')).toBe('TRUE')
    expect(evalAt('=AND("abc")')).toBe(FORMULA_ERROR)
  })
})

describe('VLOOKUP', () => {
  // A 列 = 查找键，B 列 = 返回值
  const table = {
    '0,0': 'apple',
    '0,1': '10',
    '1,0': 'banana',
    '1,1': '20',
    '2,0': 'cherry',
    '2,1': '30',
  }
  const evalAt = (raw: string, grid: Record<string, string> = table, r = 9, c = 0) =>
    evaluateCellDisplay(raw, makeGrid(grid), r, c)

  it('精确匹配（第四参缺省即精确）', () => {
    expect(evalAt('=VLOOKUP("banana",A1:B3,2)')).toBe('20')
    expect(evalAt('=VLOOKUP("apple",A1:B3,2,TRUE)')).toBe('10')
    expect(evalAt('=VLOOKUP("cherry",A1:B3,2,FALSE)')).toBe('30')
  })

  it('查找值来自单元格', () => {
    expect(evalAt('=VLOOKUP(A1,A1:B3,2)', table)).toBe('10')
    expect(evalAt('=VLOOKUP(C1,A1:B3,2)', { ...table, '0,2': 'cherry' })).toBe('30')
  })

  it('返回列号可选', () => {
    expect(evalAt('=VLOOKUP("apple",A1:B3,1)')).toBe('apple')
  })

  it('range_lookup=TRUE 走近似匹配（升序列取首个 <= 查找值的行）', () => {
    // 数值升序表：C 列 = 分数下限，D 列 = 等级
    const scores = {
      '0,2': '0',
      '0,3': 'F',
      '1,2': '60',
      '1,3': 'D',
      '2,2': '90',
      '2,3': 'A',
    }
    expect(evalAt('=VLOOKUP(75,C1:D3,2,TRUE)', scores)).toBe('D')
    expect(evalAt('=VLOOKUP(95,C1:D3,2,TRUE)', scores)).toBe('A')
    expect(evalAt('=VLOOKUP(30,C1:D3,2,TRUE)', scores)).toBe('F')
    // 缺省（不传第四参）是精确匹配，未命中即 #N/A
    expect(evalAt('=VLOOKUP(75,C1:D3,2)', scores)).toBe(FORMULA_NA)
  })

  it('未命中返回 #N/A', () => {
    expect(evalAt('=VLOOKUP("kiwi",A1:B3,2)')).toBe(FORMULA_NA)
  })

  it('#N/A 向外传播', () => {
    expect(evalAt('=VLOOKUP("kiwi",A1:B3,2)+1')).toBe(FORMULA_NA)
    expect(evalAt('=SUM(1,VLOOKUP("kiwi",A1:B3,2))')).toBe(FORMULA_NA)
    expect(evalAt('=IF(VLOOKUP("kiwi",A1:B3,2)>0,"y","n")')).toBe(FORMULA_NA)
  })

  it('非区间第二参报错', () => {
    expect(evalAt('=VLOOKUP("apple",A1,2)')).toBe(FORMULA_ERROR)
    expect(evalAt('=VLOOKUP("apple",A1:B3)')).toBe(FORMULA_ERROR)
  })

  it('越界列号报错', () => {
    expect(evalAt('=VLOOKUP("apple",A1:B3,0)')).toBe(FORMULA_ERROR)
    expect(evalAt('=VLOOKUP("apple",A1:B3,-1)')).toBe(FORMULA_ERROR)
  })
})
