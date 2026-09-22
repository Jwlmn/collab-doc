import type { JSONContent } from '@tiptap/core'

/* ------------------------------------------------------------------ */
/*  Tiptap JSON → Markdown                                            */
/* ------------------------------------------------------------------ */

/** 表格单元格内联文本（段落间空格连接，管道符转义） */
function cellText(content: JSONContent[] | undefined): string {
  if (!content) return ''
  return content
    .map((node) => inlineToMd(node.content))
    .join(' ')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeInlineText(text: string, marks: string[]): string {
  if (marks.includes('code')) {
    return text.replace(/`/g, '\\`')
  }
  // 转义 markdown 元字符（反斜杠自身最先）
  return text.replace(/([\\`*_[\]<>])/g, '\\$1')
}

function wrapMark(type: string, inner: string, attrs?: Record<string, unknown>): string {
  switch (type) {
    case 'bold':
      return `**${inner}**`
    case 'italic':
      return `*${inner}*`
    case 'strike':
      return `~~${inner}~~`
    case 'code':
      return inner.includes('`') ? inner : `\`${inner}\``
    case 'link':
      return `[${inner}](${String(attrs?.href ?? '')})`
    default:
      return inner
  }
}

/** 行内节点序列化（marks 从内向外包裹） */
function inlineToMd(nodes: JSONContent[] | undefined): string {
  if (!nodes) return ''

  return nodes
    .map((node): string => {
      if (node.type === 'hardBreak') return '  \n'

      if (node.type === 'text') {
        const marks = (node.marks ?? []).map((m) => m.type)
        const raw = node.text ?? ''

        // code mark 优先：行内代码内不再嵌套其它样式
        if (marks.includes('code')) {
          const codeMark = node.marks?.find((m) => m.type === 'code')
          return wrapMark('code', raw, codeMark?.attrs)
        }

        let out = escapeInlineText(raw, marks)
        // 从最内层应用到外层：先包裹在 marks 数组靠后的（内层），保持视觉层级
        const ordered = [...(node.marks ?? [])].reverse()
        for (const mark of ordered) {
          if (mark.type === 'link') {
            out = wrapMark('link', out, mark.attrs)
          } else if (mark.type !== 'code') {
            out = wrapMark(mark.type, out, mark.attrs)
          }
        }
        return out
      }

      // 其它带内容的行内容器（如未来扩展）递归处理
      if (node.content) return inlineToMd(node.content)
      return ''
    })
    .join('')
}

function listToMd(node: JSONContent, ordered: boolean, depth: number): string {
  const items = node.content ?? []
  const start = Number(node.attrs?.start ?? 1)
  const indent = '  '.repeat(depth)
  const lines: string[] = []
  let counter = start

  for (const item of items) {
    const blocks = item.content ?? []
    const marker = ordered ? `${counter++}. ` : '- '

    // 首块：段落直接接 marker；标题/代码/表格等块级降级为独立行
    let first = true
    for (const block of blocks) {
      if (block.type === 'paragraph') {
        const inline = inlineToMd(block.content)
        if (first) {
          lines.push(`${indent}${marker}${inline}`)
          first = false
        } else {
          // 段落续行：与 marker 文本对齐缩进
          lines.push(`${indent}  ${inline}`)
        }
      } else if (block.type === 'bulletList' || block.type === 'orderedList') {
        lines.push(listToMd(block, block.type === 'orderedList', depth + 1))
        first = false
      } else if (block.type === 'codeBlock') {
        const fenced = codeBlockToMd(block)
        lines.push(
          fenced
            .split('\n')
            .map((l) => `${indent}  ${l}`)
            .join('\n'),
        )
        first = false
      } else if (block.type === 'blockquote') {
        const quoted = blockToMd(block)
        lines.push(
          quoted
            .split('\n')
            .map((l) => `${indent}  ${l}`)
            .join('\n'),
        )
        first = false
      } else {
        const generic = blockToMd(block)
        if (generic) {
          lines.push(`${indent}  ${generic}`)
          first = false
        }
      }
    }

    if (first) {
      // 空列表项
      lines.push(`${indent}${marker}`)
    }
  }

  return lines.join('\n')
}

function codeBlockToMd(node: JSONContent): string {
  const text = (node.content ?? []).map((n) => n.text ?? '').join('')
  const language = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
  // 内容含 ``` 时加长围栏
  const fence = /```/.test(text) ? '````' : '```'
  return `${fence}${language}\n${text}\n${fence}`
}

function tableToMd(node: JSONContent): string {
  const rows = node.content ?? []
  if (rows.length === 0) return ''

  const rowCells = (row: JSONContent): string[] =>
    (row.content ?? []).map((cell) => cellText(cell.content))

  const lines: string[] = []
  const header = rowCells(rows[0])
  lines.push(`| ${header.join(' | ')} |`)
  lines.push(`| ${header.map(() => '---').join(' | ')} |`)

  for (const row of rows.slice(1)) {
    lines.push(`| ${rowCells(row).join(' | ')} |`)
  }
  return lines.join('\n')
}

function blockToMd(node: JSONContent): string {
  switch (node.type) {
    case 'heading': {
      const level = Number(node.attrs?.level ?? 1)
      return `${'#'.repeat(Math.min(Math.max(level, 1), 6))} ${inlineToMd(node.content)}`
    }
    case 'paragraph':
      return inlineToMd(node.content)
    case 'bulletList':
      return listToMd(node, false, 0)
    case 'orderedList':
      return listToMd(node, true, 0)
    case 'codeBlock':
      return codeBlockToMd(node)
    case 'blockquote':
      return (node.content ?? [])
        .map(blockToMd)
        .filter(Boolean)
        .flatMap((line) => line.split('\n').map((l) => (l ? `> ${l}` : '>')))
        .join('\n')
    case 'horizontalRule':
      return '---'
    case 'table':
      return tableToMd(node)
    default:
      if (node.content) {
        return node.content
          .map(blockToMd)
          .filter(Boolean)
          .join('\n\n')
      }
      return ''
  }
}

/** Tiptap 文档 JSON → Markdown 文本 */
export function serializeMarkdown(doc: JSONContent): string {
  const blocks = doc.content ?? []
  return blocks
    .map(blockToMd)
    .filter((s) => s !== '')
    .join('\n\n')
}

/* ------------------------------------------------------------------ */
/*  Markdown → Tiptap JSON                                            */
/* ------------------------------------------------------------------ */

interface InlineMark {
  type: string
  attrs?: Record<string, unknown>
}

/** 解析行内 markdown（支持嵌套样式、链接、转义） */
export function parseInline(text: string): JSONContent[] {
  const nodes: JSONContent[] = []
  let buffer = ''

  const flush = () => {
    if (buffer) {
      nodes.push({ type: 'text', text: buffer })
      buffer = ''
    }
  }

  const pushText = (value: string, marks: InlineMark[]) => {
    if (!value) return
    if (marks.length === 0) {
      buffer += value
      return
    }
    flush()
    nodes.push({
      type: 'text',
      text: value,
      marks: marks.map((m) => (m.attrs ? { type: m.type, attrs: m.attrs } : { type: m.type })),
    })
  }

  let i = 0
  const len = text.length

  while (i < len) {
    const ch = text[i]

    // 转义
    if (ch === '\\' && i + 1 < len) {
      buffer += text[i + 1]
      i += 2
      continue
    }

    // 行内代码（内部不再解析）
    if (ch === '`') {
      const end = text.indexOf('`', i + 1)
      if (end > i) {
        pushText(text.slice(i + 1, end), [{ type: 'code' }])
        i = end + 1
        continue
      }
    }

    // 链接 [text](url)
    if (ch === '[') {
      const linkMatch = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(text.slice(i))
      if (linkMatch) {
        flush() // 先落盘前缀文本，保持节点顺序
        const inner = parseInline(linkMatch[1])
        for (const node of inner) {
          const marks = [...(node.marks ?? []), { type: 'link', attrs: { href: linkMatch[2] } }]
          nodes.push({ ...node, marks })
        }
        i += linkMatch[0].length
        continue
      }
    }

    // 粗体
    if (text.startsWith('**', i)) {
      let end = text.indexOf('**', i + 2)
      if (end > i + 1) {
        // `**a*b***` 类三连星：闭合右移一位，把第一个 * 让给内层斜体
        if (text[end + 2] === '*') end += 1
        flush()
        const inner = parseInline(text.slice(i + 2, end))
        for (const node of inner) {
          nodes.push({ ...node, marks: [...(node.marks ?? []), { type: 'bold' }] })
        }
        i = end + 2
        continue
      }
    }

    // 删除线
    if (text.startsWith('~~', i)) {
      const end = text.indexOf('~~', i + 2)
      if (end > i + 1) {
        flush()
        const inner = parseInline(text.slice(i + 2, end))
        for (const node of inner) {
          nodes.push({ ...node, marks: [...(node.marks ?? []), { type: 'strike' }] })
        }
        i = end + 2
        continue
      }
    }

    // 斜体（*...*，不与 ** 冲突）
    if (ch === '*' && !text.startsWith('**', i)) {
      const end = text.indexOf('*', i + 1)
      if (end > i) {
        flush()
        const inner = parseInline(text.slice(i + 1, end))
        for (const node of inner) {
          nodes.push({ ...node, marks: [...(node.marks ?? []), { type: 'italic' }] })
        }
        i = end + 1
        continue
      }
    }

    // 斜体下划线形式 _..._（单词边界简化处理）
    if (ch === '_') {
      const end = text.indexOf('_', i + 1)
      if (end > i) {
        flush()
        const inner = parseInline(text.slice(i + 1, end))
        for (const node of inner) {
          nodes.push({ ...node, marks: [...(node.marks ?? []), { type: 'italic' }] })
        }
        i = end + 1
        continue
      }
    }

    // 硬换行（行尾两空格由调用方已在文本中保留 \n 处理：md 管道里硬换行表现为两空格+换行，
    // 解析器在段落拼接前已转空格，此处忽略）
    buffer += ch
    i += 1
  }

  flush()

  // 合并相邻同 marks 文本节点（保持结构干净）
  const merged: JSONContent[] = []
  for (const node of nodes) {
    const prev = merged[merged.length - 1]
    if (
      prev &&
      prev.type === 'text' &&
      node.type === 'text' &&
      JSON.stringify(prev.marks ?? []) === JSON.stringify(node.marks ?? [])
    ) {
      prev.text = (prev.text ?? '') + (node.text ?? '')
    } else {
      merged.push(node)
    }
  }

  return merged.filter((n) => n.text !== undefined && n.text !== '')
}

function paragraph(text: string): JSONContent {
  const content = parseInline(text)
  return content.length > 0 ? { type: 'paragraph', content } : { type: 'paragraph' }
}

function parseTable(blockLines: string[]): JSONContent | null {
  if (blockLines.length < 2) return null
  const splitRow = (line: string): string[] =>
    line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split(/(?<!\\)\|/)
      .map((c) => c.replace(/\\\|/g, '|').trim())

  const headerCells = splitRow(blockLines[0])
  const rows: JSONContent[] = [
    {
      type: 'tableRow',
      content: headerCells.map((text) => ({
        type: 'tableHeader',
        content: [paragraph(text)],
      })),
    },
  ]

  for (const line of blockLines.slice(2)) {
    if (!line.includes('|')) continue
    const cells = splitRow(line)
    rows.push({
      type: 'tableRow',
      content: cells.map((text) => ({
        type: 'tableCell',
        content: [paragraph(text)],
      })),
    })
  }

  return { type: 'table', content: rows }
}

/** GFM 表格分隔行校验：每个单元格均为 --- / :---: 形式 */
function isTableSeparator(line: string): boolean {
  const cells = line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c))
}
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/

interface BlockResult {
  node: JSONContent
  next: number
}

/** 解析一组块级行（列表/引用/普通块） */
function parseBlocks(lines: string[], index: number): BlockResult {
  const line = lines[index]

  // 围栏代码块
  const fence = /^(\s*)(`{3,})(.*)$/.exec(line)
  if (fence) {
    const ticks = fence[2]
    const language = fence[3].trim()
    const body: string[] = []
    let i = index + 1
    while (i < lines.length && !lines[i].trim().startsWith(ticks)) {
      body.push(lines[i])
      i++
    }
    return {
      node: {
        type: 'codeBlock',
        attrs: language ? { language } : undefined,
        content: body.length ? [{ type: 'text', text: body.join('\n') }] : undefined,
      },
      next: Math.min(i + 1, lines.length),
    }
  }

  // 分割线
  if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
    return { node: { type: 'horizontalRule' }, next: index + 1 }
  }

  // 标题
  const heading = /^(#{1,6})\s+(.*)$/.exec(line)
  if (heading) {
    return {
      node: {
        type: 'heading',
        attrs: { level: heading[1].length },
        content: parseInline(heading[2]),
      },
      next: index + 1,
    }
  }

  // 引用
  if (/^\s*>/.test(line)) {
    const inner: string[] = []
    let i = index
    while (i < lines.length && /^\s*>/.test(lines[i])) {
      inner.push(lines[i].replace(/^\s*>\s?/, ''))
      i++
    }
    const content = parseBlockList(inner)
    return {
      node: content.length ? { type: 'blockquote', content } : { type: 'blockquote' },
      next: i,
    }
  }

  // 表格（当前行含 | 且下一行是分隔行）
  if (line.includes('|') && index + 1 < lines.length && isTableSeparator(lines[index + 1])) {
    const tableLines = [line, lines[index + 1]] // 表头 + 分隔行
    let i = index + 2
    while (i < lines.length && lines[i].includes('|')) {
      tableLines.push(lines[i])
      i++
    }
    const table = parseTable(tableLines)
    if (table) return { node: table, next: i }
  }

  // 列表
  const listMatch = LIST_ITEM.exec(line)
  if (listMatch) {
    return parseList(lines, index, listMatch)
  }

  // 段落：吃掉连续的非空、非特殊行
  const para: string[] = []
  let i = index
  while (i < lines.length) {
    const cur = lines[i]
    if (
      cur.trim() === '' ||
      /^(\s*)(`{3,})/.test(cur) ||
      /^(#{1,6})\s+/.test(cur) ||
      /^\s*>/.test(cur) ||
      LIST_ITEM.test(cur) ||
      /^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(cur)
    ) {
      break
    }
    para.push(cur.trim())
    i++
  }
  // 表格行不进段落
  if (para.length && para[0].includes('|') && i < lines.length && isTableSeparator(lines[i] ?? '')) {
    return parseBlocks(lines, index)
  }
  return { node: paragraph(para.join(' ')), next: Math.max(i, index + 1) }
}

function parseList(lines: string[], index: number, firstMatch: RegExpExecArray): BlockResult {
  const baseIndent = firstMatch[1].length
  const ordered = /\d/.test(firstMatch[2])
  const startMatch = /^(\d+)/.exec(firstMatch[2])
  const start = startMatch ? Number(startMatch[1]) : 1

  const items: JSONContent[] = []
  let i = index
  let currentBody: string[] | null = null
  let currentIndent = baseIndent

  const flushItem = () => {
    if (!currentBody) return
    const blocks = parseBlockList(currentBody)
    items.push({
      type: 'listItem',
      content: blocks.length ? blocks : [{ type: 'paragraph' }],
    })
    currentBody = null
  }

  while (i < lines.length) {
    const line = lines[i]

    if (line.trim() === '') {
      // 空行：保留给当前 item（若后面还有同级列表则结束）
      currentBody?.push('')
      i++
      continue
    }

    const match = LIST_ITEM.exec(line)
    if (match) {
      const indent = match[1].length

      if (indent < baseIndent) break // 同级结束

      if (indent > currentIndent && currentBody) {
        // 缩进更深：属于当前 item 的嵌套内容
        currentBody.push(line.slice(Math.min(indent, baseIndent + 2)))
        i++
        continue
      }

      if (indent === baseIndent) {
        const sameOrdered = /\d/.test(match[2])
        if (sameOrdered !== ordered) break // 类型切换视为新列表
        flushItem()
        currentIndent = baseIndent
        currentBody = [match[3]]
        i++
        continue
      }

      // indent < currentIndent 但 >= baseIndent：回退一级，收当前 item
      flushItem()
      currentIndent = baseIndent
      const sameOrdered2 = /\d/.test(match[2])
      if (sameOrdered2 !== ordered) {
        i--
        break
      }
      currentBody = [match[3]]
      i++
      continue
    }

    // 非列表行：续行内容
    if (currentBody) {
      currentBody.push(line.trim())
      i++
      continue
    }
    break
  }

  flushItem()

  const node: JSONContent = {
    type: ordered ? 'orderedList' : 'bulletList',
    ...(ordered && start !== 1 ? { attrs: { start } } : {}),
    content: items,
  }
  return { node, next: i }
}

function parseBlockList(lines: string[]): JSONContent[] {
  const nodes: JSONContent[] = []
  let i = 0
  while (i < lines.length) {
    if (lines[i].trim() === '') {
      i++
      continue
    }
    const { node, next } = parseBlocks(lines, i)
    if (node) nodes.push(node)
    i = Math.max(next, i + 1)
  }
  return nodes
}

/** Markdown 文本 → Tiptap 文档 JSON */
export function parseMarkdown(markdown: string): JSONContent {
  // 统一换行，去掉开头空行
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const content = parseBlockList(lines)
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}
