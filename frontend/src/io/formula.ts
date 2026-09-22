import { colLabelToIndex } from './sheet-model'

/**
 * 轻量公式引擎（电子表格单元格）：
 * - 四则运算与括号：=1+2*3、=(A1+B2)/2
 * - 单元格引用：A1、$A$1（$ 忽略）
 * - 函数：SUM / AVG / MIN / MAX / COUNT，参数为表达式或区间 A1:B2
 * - 递归求值（公式引用公式），Set 防环
 * - 错误：'#ERROR!'（语法/除零等）、'#CYCLE!'（循环引用）
 */

export const FORMULA_ERROR = '#ERROR!'
export const FORMULA_CYCLE = '#CYCLE!'

/** 循环引用信号（专用异常，避免被通用 catch 吞成 #ERROR!） */
class CycleError extends Error {
  constructor() {
    super('cycle')
  }
}

export function isFormula(raw: string): boolean {
  return raw.startsWith('=')
}

/** 列头 + 行号 → 坐标（"A1" → {r:0,c:0}）；非法返回 null */
export function parseCellRef(ref: string): { r: number; c: number } | null {
  const m = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(ref.trim())
  if (!m) return null
  const c = colLabelToIndex(m[1])
  const r = Number(m[2]) - 1
  if (!Number.isFinite(r) || r < 0 || c < 0) return null
  return { r, c }
}

type Token =
  | { type: 'num'; value: number }
  | { type: 'ref'; r: number; c: number }
  | { type: 'range'; r1: number; c1: number; r2: number; c2: number }
  | { type: 'func'; name: string }
  | { type: 'op'; value: string }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' }

function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0

  while (i < expr.length) {
    const ch = expr[i]

    if (/\s/.test(ch)) {
      i++
      continue
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen' })
      i++
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen' })
      i++
      continue
    }
    if (ch === ',') {
      tokens.push({ type: 'comma' })
      i++
      continue
    }
    if ('+-*/'.includes(ch)) {
      tokens.push({ type: 'op', value: ch })
      i++
      continue
    }

    // 数字
    if (/[0-9.]/.test(ch)) {
      const m = /^\d*\.?\d+/.exec(expr.slice(i))
      if (!m) throw new Error('bad number')
      tokens.push({ type: 'num', value: Number(m[0]) })
      i += m[0].length
      continue
    }

    // 函数名 或 引用/区间（A1、$A$1、A1:B2）
    const wordMatch = /^\$?[A-Za-z]+\$?[0-9]*(?::\$?[A-Za-z]+\$?[0-9]+)?/.exec(expr.slice(i))
    if (wordMatch) {
      const word = wordMatch[0]
      const upper = word.toUpperCase()

      if (/^[A-Z]+(Sum|Avg|Min|Max|Count)?$/i.test(word) && !/\d/.test(word) && !word.includes(':')) {
        // 纯字母且不是引用（无数字）→ 函数名
        const maybeFunc = upper
        if (['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'].includes(maybeFunc)) {
          tokens.push({ type: 'func', name: maybeFunc })
          i += word.length
          continue
        }
        throw new Error('unknown identifier: ' + word)
      }

      // 区间 A1:B2
      if (word.includes(':')) {
        const [left, right] = word.split(':')
        const a = parseCellRef(left)
        const b = parseCellRef(right)
        if (!a || !b) throw new Error('bad range')
        tokens.push({
          type: 'range',
          r1: Math.min(a.r, b.r),
          c1: Math.min(a.c, b.c),
          r2: Math.max(a.r, b.r),
          c2: Math.max(a.c, b.c),
        })
        i += word.length
        continue
      }

      const ref = parseCellRef(word)
      if (!ref) throw new Error('bad ref')
      tokens.push({ type: 'ref', ...ref })
      i += word.length
      continue
    }

    throw new Error(`unexpected char: ${ch}`)
  }

  return tokens
}

export interface FormulaContext {
  /** 取单元格原始文本 */
  getRaw(r: number, c: number): string
  /** 递归求值（含公式链），带防环 */
  resolveRaw(r: number, c: number, seen: Set<string>): number | string
}

class Parser {
  private pos = 0

  constructor(
    private readonly tokens: Token[],
    private readonly ctx: FormulaContext,
    private readonly seen: Set<string>,
  ) {}

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++]
  }

  /** 表达式 = 项 ((+|-) 项)* */
  parseExpression(): number {
    let value = this.parseTerm()
    for (;;) {
      const t = this.peek()
      if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
        this.next()
        const rhs = this.parseTerm()
        value = t.value === '+' ? value + rhs : value - rhs
      } else {
        return value
      }
    }
  }

  /** 项 = 因子 ((*|/) 因子)* */
  private parseTerm(): number {
    let value = this.parseFactor()
    for (;;) {
      const t = this.peek()
      if (t?.type === 'op' && (t.value === '*' || t.value === '/')) {
        this.next()
        const rhs = this.parseFactor()
        if (t.value === '/') {
          if (rhs === 0) throw new Error('div by zero')
          value = value / rhs
        } else {
          value = value * rhs
        }
      } else {
        return value
      }
    }
  }

  /** 因子 = 数字 | 引用 | 函数 | (表达式) | 一元负号 */
  private parseFactor(): number {
    const t = this.peek()

    if (t?.type === 'op' && t.value === '-') {
      this.next()
      return -this.parseFactor()
    }
    if (t?.type === 'op' && t.value === '+') {
      this.next()
      return this.parseFactor()
    }
    if (t?.type === 'num') {
      this.next()
      return t.value
    }
    if (t?.type === 'ref') {
      this.next()
      return this.toNumber(this.ctx.resolveRaw(t.r, t.c, this.seen))
    }
    if (t?.type === 'func') {
      this.next()
      return this.parseFuncCall(t.name)
    }
    if (t?.type === 'lparen') {
      this.next()
      const value = this.parseExpression()
      const close = this.next()
      if (close?.type !== 'rparen') throw new Error('missing )')
      return value
    }

    throw new Error('unexpected factor')
  }

  private parseFuncCall(name: string): number {
    const open = this.next()
    if (open?.type !== 'lparen') throw new Error('expected (')

    const values: (number | null)[] = []

    if (this.peek()?.type === 'rparen') {
      this.next()
      return this.applyFunc(name, values)
    }

    for (;;) {
      const t = this.peek()
      if (t?.type === 'range') {
        this.next()
        for (let r = t.r1; r <= t.r2; r++) {
          for (let c = t.c1; c <= t.c2; c++) {
            // Excel 语义：区间内的非数字文本不参与聚合（null 占位）
            values.push(this.toNumberOrNull(this.ctx.resolveRaw(r, c, this.seen)))
          }
        }
      } else {
        values.push(this.parseExpression())
      }

      const sep = this.peek()
      if (sep?.type === 'comma') {
        this.next()
        continue
      }
      break
    }

    const close = this.next()
    if (close?.type !== 'rparen') throw new Error('missing )')
    return this.applyFunc(name, values)
  }

  private applyFunc(name: string, raw: (number | null)[]): number {
    // Excel 语义：聚合函数忽略区间内的非数字项
    const values = raw.filter((v): v is number => v !== null)
    switch (name) {
      case 'SUM':
        return values.reduce((a, b) => a + b, 0)
      case 'AVG':
        return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length
      case 'MIN':
        return values.length === 0 ? 0 : Math.min(...values)
      case 'MAX':
        return values.length === 0 ? 0 : Math.max(...values)
      case 'COUNT':
        return values.length
      default:
        throw new Error('unknown func')
    }
  }

  parse(): number {
    const value = this.parseExpression()
    if (this.pos !== this.tokens.length) throw new Error('trailing tokens')
    return value
  }

  /** 区间取值用：非数字文本 → null（忽略）；错误哨兵照常抛出 */
  private toNumberOrNull(resolved: number | string): number | null {
    if (typeof resolved === 'number') return resolved
    if (resolved === FORMULA_CYCLE) throw new CycleError()
    if (resolved === FORMULA_ERROR) throw new Error('propagated')
    const trimmed = resolved.trim()
    if (trimmed === '') return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }

  private toNumber(resolved: number | string): number {
    if (typeof resolved === 'number') return resolved
    if (resolved === FORMULA_CYCLE) throw new CycleError()
    if (resolved === FORMULA_ERROR) throw new Error('propagated')
    const n = Number(resolved.trim())
    if (!Number.isFinite(n)) {
      if (resolved.trim() === '') return 0
      throw new Error('NaN operand')
    }
    return n
  }
}

/** 求值单个公式（raw 以 = 开头）；非公式直接返回原文 */
export function evaluateFormula(raw: string, ctx: FormulaContext, seen: Set<string>): string {
  const expr = raw.slice(1).trim()
  if (expr === '') return FORMULA_ERROR

  try {
    const tokens = tokenize(expr)
    const value = new Parser(tokens, ctx, seen).parse()
    if (!Number.isFinite(value)) return FORMULA_ERROR
    // 浮点尾差收敛：保留 10 位并去尾零
    return String(Number(value.toFixed(10)))
  } catch (e) {
    if (e instanceof CycleError) return FORMULA_CYCLE
    return FORMULA_ERROR
  }
}

/** 供单元格渲染的求值入口（简化签名） */
export function evaluateCellDisplay(
  raw: string,
  getRaw: (r: number, c: number) => string,
  r: number,
  c: number,
): string {
  if (!isFormula(raw)) return raw

  const visited = new Set<string>()

  const resolve = (rr: number, cc: number, seen: Set<string>): number | string => {
    const key = `${rr},${cc}`
    // seen 是「当前递归栈」而非历史访问集：入栈读取、出栈释放 ——
    // 同一公式的兄弟引用（如 =A1/A1）合法，仅依赖环判定为循环
    if (seen.has(key)) throw new CycleError()
    seen.add(key)
    try {
      const cellRaw = getRaw(rr, cc)
      if (cellRaw === '') return 0
      if (!isFormula(cellRaw)) {
        const n = Number(cellRaw)
        return Number.isFinite(n) && cellRaw.trim() !== '' ? n : cellRaw
      }
      const result = evaluateFormula(
        cellRaw,
        { getRaw, resolveRaw: (a, b, s) => resolve(a, b, s) },
        seen,
      )
      // 子公式的错误/循环作为信号继续向外传播
      if (result === FORMULA_ERROR) throw new Error('propagated')
      if (result === FORMULA_CYCLE) throw new CycleError()
      const n = Number(result)
      return Number.isFinite(n) ? n : result
    } finally {
      seen.delete(key)
    }
  }

  const rootKey = `${r},${c}`
  visited.add(rootKey)
  try {
    const out = evaluateFormula(
      raw,
      { getRaw, resolveRaw: (a, b, s) => resolve(a, b, s) },
      visited,
    )
    return out
  } catch {
    return FORMULA_CYCLE
  }
}
