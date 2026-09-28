import { colLabelToIndex } from './sheet-model'

/**
 * 轻量公式引擎（电子表格单元格）：
 * - 四则运算与括号：=1+2*3、=(A1+B2)/2
 * - 比较运算：=、<>、<、>、<=、>=（优先级低于加减）
 * - 单元格引用：A1、$A$1（$ 忽略）、区间 A1:B2
 * - 字符串字面量："..." 与 '...'；布尔 TRUE/FALSE
 * - 函数见 FUNCTIONS 注册表：SUM/AVG/MIN/MAX/COUNT（聚合）、
 *   ROUND/ABS/LEN（标量）、CONCAT（值列表）、IF（惰性分支）、
 *   VLOOKUP（保留区间形状）、AND/OR（真值判定）
 * - 递归求值（公式引用公式），seen 是递归栈防环
 * - 错误：'#ERROR!'（语法/除零等）、'#CYCLE!'（循环引用）、'#N/A!'（查找未命中）
 */

export const FORMULA_ERROR = '#ERROR!'
export const FORMULA_CYCLE = '#CYCLE!'
export const FORMULA_NA = '#N/A'

/** 公式可产生的值：数字 / 文本 / 布尔 */
type FormulaValue = number | string | boolean

/** 区间（保留 2D 形状，VLOOKUP 这类函数需要） */
interface RangeBox {
  r1: number
  c1: number
  r2: number
  c2: number
}

/** 循环引用信号（专用异常，避免被通用 catch 吞成 #ERROR!） */
class CycleError extends Error {
  constructor() {
    super('cycle')
  }
}

/** 查找未命中信号（VLOOKUP 未找到 → #N/A） */
class NaError extends Error {
  constructor() {
    super('na')
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

/* ------------------------------------------------------------------ */
/*  函数注册表                                                          */
/* ------------------------------------------------------------------ */

/**
 * 函数按参数处理方式分四类：
 * - aggregate：区间摊平成数字（非数字忽略），如 SUM
 * - valueList：区间摊平成原始值（保留文本），如 CONCAT / AND / OR
 * - scalar：普通表达式参数（区间在表达式位置本就非法），如 ROUND
 * - lazy：按条件只求值被选中的分支（IF）
 * - lookup：首个参数保留区间形状，如 VLOOKUP
 */
type FuncKind = 'aggregate' | 'valueList' | 'scalar' | 'lazy' | 'lookup'

interface FuncDef {
  kind: FuncKind
}

const FUNCTIONS: Record<string, FuncDef> = {
  SUM: { kind: 'aggregate' },
  AVG: { kind: 'aggregate' },
  MIN: { kind: 'aggregate' },
  MAX: { kind: 'aggregate' },
  COUNT: { kind: 'aggregate' },
  ROUND: { kind: 'scalar' },
  ABS: { kind: 'scalar' },
  LEN: { kind: 'scalar' },
  CONCAT: { kind: 'valueList' },
  AND: { kind: 'valueList' },
  OR: { kind: 'valueList' },
  IF: { kind: 'lazy' },
  VLOOKUP: { kind: 'lookup' },
}

/** 标识符是否是已注册函数 */
function funcDef(name: string): FuncDef | undefined {
  return FUNCTIONS[name]
}

/* ------------------------------------------------------------------ */
/*  词法分析                                                            */
/* ------------------------------------------------------------------ */

type Token =
  | { type: 'num'; value: number }
  | { type: 'str'; value: string }
  | { type: 'bool'; value: boolean }
  | { type: 'ref'; r: number; c: number }
  | { type: 'range'; r1: number; c1: number; r2: number; c2: number }
  | { type: 'func'; name: string }
  | { type: 'op'; value: string }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'comma' }

/** 比较运算符（与算术共用 op 类型，靠优先级层区分） */
const CMP_OPS = ['<=', '>=', '<>', '<', '>', '=']

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

    // 字符串字面量（两种引号，暂不支持转义 —— 单元格文本里罕见）
    if (ch === '"' || ch === "'") {
      const end = expr.indexOf(ch, i + 1)
      if (end === -1) throw new Error('unterminated string')
      tokens.push({ type: 'str', value: expr.slice(i + 1, end) })
      i = end + 1
      continue
    }

    // 比较运算符（长的先匹配：<= >= <>）
    const threeChar = expr.slice(i, i + 2)
    if (threeChar === '<=' || threeChar === '>=' || threeChar === '<>') {
      tokens.push({ type: 'op', value: threeChar })
      i += 2
      continue
    }
    if (ch === '<' || ch === '>' || ch === '=') {
      tokens.push({ type: 'op', value: ch })
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

    // 函数名 / 布尔字面量 / 引用 / 区间（A1、$A$1、A1:B2）
    const wordMatch = /^\$?[A-Za-z]+\$?[0-9]*(?::\$?[A-Za-z]+\$?[0-9]+)?/.exec(expr.slice(i))
    if (wordMatch) {
      const word = wordMatch[0]
      const upper = word.toUpperCase()

      // 纯字母且不是引用（无数字）→ 标识符
      if (!/\d/.test(word) && !word.includes(':')) {
        if (upper === 'TRUE' || upper === 'FALSE') {
          tokens.push({ type: 'bool', value: upper === 'TRUE' })
          i += word.length
          continue
        }
        if (funcDef(upper)) {
          tokens.push({ type: 'func', name: upper })
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

/* ------------------------------------------------------------------ */
/*  语义辅助                                                            */
/* ------------------------------------------------------------------ */

/** 文本在比较中的次序小于数字（Excel 语义：数字 < 文本） */
function typeRank(v: FormulaValue): number {
  if (typeof v === 'number') return 0
  if (typeof v === 'boolean') return 1
  return 2
}

function compareValues(a: FormulaValue, b: FormulaValue, op: string): boolean {
  // 同为文本 → 字典序；跨类型 → 按类型序（数字/布尔 < 文本）
  if (typeof a === 'string' && typeof b === 'string') {
    const cmp = a < b ? -1 : a > b ? 1 : 0
    return applyCmp(cmp, op)
  }
  if (typeRank(a) !== typeRank(b)) {
    return applyCmp(typeRank(a) - typeRank(b), op)
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') {
    return applyCmp(Number(a) - Number(b), op)
  }
  return applyCmp(Number(a) - Number(b), op)
}

function applyCmp(cmp: number, op: string): boolean {
  switch (op) {
    case '=':
      return cmp === 0
    case '<>':
      return cmp !== 0
    case '<':
      return cmp < 0
    case '>':
      return cmp > 0
    case '<=':
      return cmp <= 0
    case '>=':
      return cmp >= 0
    default:
      throw new Error('bad operator')
  }
}

/** IF / AND / OR 的真值判定（Excel：文本条件报错） */
function truthy(v: FormulaValue): boolean {
  if (typeof v === 'boolean') return v
  if (typeof v === 'number') return v !== 0
  const t = v.trim()
  if (t === '') return false
  if (t.toUpperCase() === 'TRUE') return true
  if (t.toUpperCase() === 'FALSE') return false
  throw new Error('condition must be numeric')
}

/* ------------------------------------------------------------------ */
/*  语法分析                                                            */
/* ------------------------------------------------------------------ */

class Parser {
  private pos = 0
  // erasableSyntaxOnly：禁用构造参数属性，显式声明
  private readonly tokens: Token[]
  private readonly ctx: FormulaContext
  private readonly seen: Set<string>

  constructor(tokens: Token[], ctx: FormulaContext, seen: Set<string>) {
    this.tokens = tokens
    this.ctx = ctx
    this.seen = seen
  }

  private peek(offset = 0): Token | undefined {
    return this.tokens[this.pos + offset]
  }

  private next(): Token | undefined {
    return this.tokens[this.pos++]
  }

  /** 比较 = 表达式 ((cmp) 表达式)* —— 比较优先级最低 */
  parse(): FormulaValue {
    let left = this.parseAdditive()
    for (;;) {
      const t = this.peek()
      if (t?.type === 'op' && CMP_OPS.includes(t.value)) {
        this.next()
        const right = this.parseAdditive()
        left = compareValues(left, right, t.value)
      } else {
        return left
      }
    }
  }

  /** 加减 = 项 ((+|-) 项)* */
  private parseAdditive(): FormulaValue {
    let value = this.parseTerm()
    for (;;) {
      const t = this.peek()
      if (t?.type === 'op' && (t.value === '+' || t.value === '-')) {
        this.next()
        const rhs = this.parseTerm()
        const a = this.toNumber(value)
        const b = this.toNumber(rhs)
        value = t.value === '+' ? a + b : a - b
      } else {
        return value
      }
    }
  }

  /** 乘除 = 因子 ((*|/) 因子)* */
  private parseTerm(): FormulaValue {
    let value = this.parseFactor()
    for (;;) {
      const t = this.peek()
      if (t?.type === 'op' && (t.value === '*' || t.value === '/')) {
        this.next()
        const rhs = this.parseFactor()
        const a = this.toNumber(value)
        const b = this.toNumber(rhs)
        if (t.value === '/') {
          if (b === 0) throw new Error('div by zero')
          value = a / b
        } else {
          value = a * b
        }
      } else {
        return value
      }
    }
  }

  /** 因子 = 数字 | 字符串 | 布尔 | 引用 | 函数 | (比较) | 一元正负号 */
  private parseFactor(): FormulaValue {
    const t = this.peek()

    if (t?.type === 'op' && (t.value === '-' || t.value === '+')) {
      this.next()
      const v = this.parseFactor()
      const n = this.toNumber(v)
      return t.value === '-' ? -n : n
    }
    if (t?.type === 'num') {
      this.next()
      return t.value
    }
    if (t?.type === 'str') {
      this.next()
      return t.value
    }
    if (t?.type === 'bool') {
      this.next()
      return t.value
    }
    if (t?.type === 'ref') {
      this.next()
      return this.toValue(this.ctx.resolveRaw(t.r, t.c, this.seen))
    }
    if (t?.type === 'func') {
      this.next()
      return this.parseFuncCall(t.name)
    }
    if (t?.type === 'lparen') {
      this.next()
      const value = this.parse()
      const close = this.next()
      if (close?.type !== 'rparen') throw new Error('missing )')
      return value
    }

    throw new Error('unexpected factor')
  }

  /** 解析一个完整参数（含比较），用逗号或右括号结束 */
  private parseArg(): FormulaValue {
    return this.parse()
  }

  /**
   * 跳过一个参数的全部 token（不求值）—— IF 惰性分支用。
   * 停在深度 0 的逗号或右括号之前（两者都不消费，交由调用方处理）。
   */
  private skipArg(): void {
    let depth = 0
    while (this.pos < this.tokens.length) {
      const t = this.tokens[this.pos]
      if (t.type === 'lparen') depth++
      else if (t.type === 'rparen') {
        if (depth === 0) return
        depth--
      } else if (t.type === 'comma' && depth === 0) return
      this.pos++
    }
  }

  private expectComma(): boolean {
    if (this.peek()?.type === 'comma') {
      this.next()
      return true
    }
    return false
  }

  private expectClose(): void {
    const close = this.next()
    if (close?.type !== 'rparen') throw new Error('missing )')
  }

  private parseFuncCall(name: string): FormulaValue {
    const def = funcDef(name)
    if (!def) throw new Error('unknown func')

    const open = this.next()
    if (open?.type !== 'lparen') throw new Error('expected (')
    if (this.peek()?.type === 'rparen') {
      this.next()
      return this.applyEmpty(name, def)
    }

    let result: FormulaValue
    switch (def.kind) {
      case 'aggregate':
        result = this.applyAggregate(name)
        break
      case 'valueList':
        result = this.applyValueList(name)
        break
      case 'scalar':
        result = this.applyScalar(name)
        break
      case 'lazy':
        result = this.applyLazy()
        break
      case 'lookup':
        result = this.applyLookup()
        break
    }

    this.expectClose()
    return result
  }

  /** 空参调用：SUM() / COUNT() 等归零，其余报错 */
  private applyEmpty(name: string, def: FuncDef): FormulaValue {
    switch (def.kind) {
      case 'aggregate':
        return name === 'COUNT' ? 0 : 0
      case 'valueList':
        return name === 'CONCAT' ? '' : false
      case 'scalar':
      case 'lazy':
      case 'lookup':
        throw new Error('missing arguments')
    }
  }

  /** 聚合：区间摊平成数字，非数字忽略（Excel 语义） */
  private applyAggregate(name: string): number {
    const values = this.readValues(true).filter((v): v is number => v !== null)

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

  /** 值列表：区间摊平成原始值（保留文本），逗号分参 */
  private applyValueList(name: string): FormulaValue {
    const values = this.readValues(false)

    if (name === 'CONCAT') {
      return values.map((v) => (v === null ? '' : String(v))).join('')
    }
    if (name === 'AND') {
      if (values.length === 0) return false
      return values.every((v) => truthy(v ?? 0))
    }
    if (name === 'OR') {
      if (values.length === 0) return false
      return values.some((v) => truthy(v ?? 0))
    }
    throw new Error('unknown func')
  }

  /**
   * 读取用逗号分隔的参数列表。
   * @param numeric true = 区间摊平并转数字（null 忽略）；false = 保留原始值
   */
  private readValues(numeric: boolean): (number | null)[] | FormulaValue[] {
    const out: (number | null)[] = []
    const raw: FormulaValue[] = []

    const pushRange = (box: RangeBox): void => {
      for (let r = box.r1; r <= box.r2; r++) {
        for (let c = box.c1; c <= box.c2; c++) {
          const resolved = this.ctx.resolveRaw(r, c, this.seen)
          if (numeric) {
            out.push(this.toNumberOrNull(resolved))
          } else {
            raw.push(this.toValue(resolved))
          }
        }
      }
    }

    for (;;) {
      const t = this.peek()
      if (t?.type === 'range') {
        this.next()
        pushRange(t)
      } else {
        const value = this.parseArg()
        if (numeric) out.push(this.toNumberOrNull(value))
        else raw.push(value)
      }

      if (this.expectComma()) continue
      break
    }

    return numeric ? out : raw
  }

  /** 标量函数：普通参数（不含逗号分隔的多参） */
  private applyScalar(name: string): FormulaValue {
    const args: FormulaValue[] = []
    for (;;) {
      args.push(this.parseArg())
      if (this.expectComma()) continue
      break
    }

    switch (name) {
      case 'ROUND': {
        if (args.length < 1) throw new Error('ROUND needs a value')
        const n = this.toNumber(args[0])
        const digits = args.length > 1 ? Math.trunc(this.toNumber(args[1])) : 0
        const factor = 10 ** digits
        // JS 的 Math.round 对负数是「向 0 舍」，而 Excel 的 ROUND 是 half-away-from-zero
        // （ROUND(-2.5,0) = -3），故取绝对值定方向
        const sign = n < 0 ? -1 : 1
        // 先按十进制位收敛浮点噪声：1.005*100 在 IEEE754 下是 100.4999…，
        // 不修会舍成 1.00 而非 1.01
        const scaled = Number((Math.abs(n) * factor).toFixed(10))
        return Number((sign * Math.round(scaled) / factor).toFixed(10))
      }
      case 'ABS':
        return Math.abs(this.toNumber(args[0]))
      case 'LEN':
        return args.length === 0 ? 0 : String(args[0]).length
      default:
        throw new Error('unknown func')
    }
  }

  /**
   * IF(cond, then, else) —— 只求值被选中的分支。
   * 未选中的一侧用 skipArg 跳过 token，避免误报（如除零、循环引用）。
   */
  private applyLazy(): FormulaValue {
    const cond = truthy(this.parseArg())
    if (!this.expectComma()) throw new Error('IF needs 3 arguments')

    if (cond) {
      const thenValue = this.parseArg()
      if (this.expectComma()) this.skipArg() // 跳过 else
      return thenValue
    }

    this.skipArg() // 跳过 then
    if (!this.expectComma()) throw new Error('IF needs 3 arguments')
    return this.parseArg()
  }

  /** VLOOKUP(lookup, range, colIdx, [exact]) —— 区间保持 2D 形状 */
  private applyLookup(): FormulaValue {
    const lookup = this.parseArg()
    if (!this.expectComma()) throw new Error('VLOOKUP needs a range')

    const t = this.peek()
    if (t?.type !== 'range') throw new Error('VLOOKUP second argument must be a range')
    this.next()
    if (!this.expectComma()) throw new Error('VLOOKUP needs a column index')

    const colIdxRaw = this.parseArg()
    const colIdx = Math.trunc(this.toNumber(colIdxRaw))

    // 第四参是 range_lookup：TRUE = 近似匹配（要求数值列升序），FALSE = 精确匹配。
    // Excel 缺省是近似，这里缺省改为精确 —— 近似匹配对未排序数据会给出
    // 误导结果，是新手最常见的坑（计划既定取舍）
    let approximate = false
    if (this.expectComma()) {
      approximate = truthy(this.parseArg())
    }
    const exact = !approximate

    const colOffset = colIdx - 1
    if (!Number.isFinite(colIdx) || colIdx < 1) throw new Error('bad column index')

    let approximateRow: number | null = null
    for (let r = t.r1; r <= t.r2; r++) {
      const cell = this.ctx.resolveRaw(r, t.c1, this.seen)

      if (exact) {
        if (!this.matchesLookup(cell, lookup, true)) continue
        return this.toValue(this.ctx.resolveRaw(r, t.c1 + colOffset, this.seen))
      }

      // 近似匹配：升序列上「最后一个 <= 查找值」的行（Excel 语义），
      // 故不能遇到就返回，要遍历完取最后一条
      if (this.matchesLookup(cell, lookup, false)) approximateRow = r
    }

    if (approximateRow !== null) {
      return this.toValue(this.ctx.resolveRaw(approximateRow, t.c1 + colOffset, this.seen))
    }

    throw new NaError()
  }

  /**
   * 查找值比对。
   * 精确：文本与数字各自语义比对；近似：要求数值列升序，取首个 <= 查找值的行。
   * 任一侧是文本时按字典序（对文本列调 toNumber 会直接抛 #ERROR!）。
   */
  private matchesLookup(cell: number | string, lookup: FormulaValue, exact: boolean): boolean {
    const cellValue = this.toValue(cell)
    const eitherText = typeof cellValue === 'string' || typeof lookup === 'string'

    if (eitherText) {
      const a = String(cellValue)
      const b = String(lookup)
      return exact ? a === b : a <= b
    }

    const c = Number(cellValue)
    const l = Number(lookup)
    return exact ? c === l : c <= l
  }

  /** 取出单元格解析结果为公式值；哨兵照常抛出以便传播 */
  private toValue(resolved: number | string): FormulaValue {
    if (typeof resolved === 'number') return resolved
    if (resolved === FORMULA_CYCLE) throw new CycleError()
    if (resolved === FORMULA_NA) throw new NaError()
    if (resolved === FORMULA_ERROR) throw new Error('propagated')
    return resolved
  }

  /** 表达式位置的数字转换：空文本 → 0，其余非数字报错 */
  private toNumber(v: FormulaValue): number {
    if (typeof v === 'number') return v
    if (typeof v === 'boolean') return v ? 1 : 0
    const t = v.trim()
    if (t === '') return 0
    const n = Number(t)
    if (!Number.isFinite(n)) throw new Error('NaN operand')
    return n
  }

  /** 区间取值用：非数字文本 → null（忽略）；布尔转 1/0；错误哨兵照常抛出 */
  private toNumberOrNull(v: FormulaValue): number | null {
    if (typeof v === 'number') return v
    if (typeof v === 'boolean') return v ? 1 : 0
    if (v === FORMULA_CYCLE) throw new CycleError()
    if (v === FORMULA_NA) throw new NaError()
    if (v === FORMULA_ERROR) throw new Error('propagated')
    const trimmed = v.trim()
    if (trimmed === '') return null
    const n = Number(trimmed)
    return Number.isFinite(n) ? n : null
  }
}

/* ------------------------------------------------------------------ */
/*  求值入口                                                            */
/* ------------------------------------------------------------------ */

/** 求值单个公式（raw 以 = 开头）；非公式直接返回原文 */
export function evaluateFormula(raw: string, ctx: FormulaContext, seen: Set<string>): string {
  const expr = raw.slice(1).trim()
  if (expr === '') return FORMULA_ERROR

  try {
    const tokens = tokenize(expr)
    const value = new Parser(tokens, ctx, seen).parse()

    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return FORMULA_ERROR
      // 浮点尾差收敛：保留 10 位并去尾零
      return String(Number(value.toFixed(10)))
    }
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
    return value
  } catch (e) {
    if (e instanceof CycleError) return FORMULA_CYCLE
    if (e instanceof NaError) return FORMULA_NA
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
      // 空单元格返回空文本：算术位置由 toNumber('')=0 兜底，
      // 文本位置（CONCAT 等）则拼出空串而非 '0'
      if (cellRaw === '') return ''
      if (!isFormula(cellRaw)) {
        const n = Number(cellRaw)
        return Number.isFinite(n) && cellRaw.trim() !== '' ? n : cellRaw
      }
      const result = evaluateFormula(
        cellRaw,
        { getRaw, resolveRaw: (a, b, s) => resolve(a, b, s) },
        seen,
      )
      // 子公式的错误/循环/未命中作为信号继续向外传播
      if (result === FORMULA_ERROR) throw new Error('propagated')
      if (result === FORMULA_NA) throw new NaError()
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
    return evaluateFormula(
      raw,
      { getRaw, resolveRaw: (a, b, s) => resolve(a, b, s) },
      visited,
    )
  } catch (e) {
    if (e instanceof NaError) return FORMULA_NA
    if (e instanceof CycleError) return FORMULA_CYCLE
    return FORMULA_ERROR
  }
}
