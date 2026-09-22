export type ContentSegment =
  | { type: 'text'; text: string }
  | { type: 'mention'; name: string; userId: number }

const MENTION_PATTERN = /@\[([^\]]+)\]\(user:(\d+)\)/g

/**
 * 把评论原文中的 @[姓名](user:ID) 标记拆成文本与提及片段。
 * 未闭合或格式错误的标记按纯文本保留。
 */
export function parseContent(raw: string): ContentSegment[] {
  const segments: ContentSegment[] = []
  const regex = new RegExp(MENTION_PATTERN.source, 'g')
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ type: 'text', text: raw.slice(lastIndex, match.index) })
    }
    segments.push({ type: 'mention', name: match[1], userId: Number(match[2]) })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < raw.length) {
    segments.push({ type: 'text', text: raw.slice(lastIndex) })
  }

  return segments
}
