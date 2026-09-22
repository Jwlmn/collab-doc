export interface HighlightSegment {
  text: string
  hit: boolean
}

/**
 * 把文本按搜索词拆成高亮片段（大小写不敏感）。
 * 不使用 v-html，由调用方以模板渲染，天然防注入。
 */
export function highlight(text: string, query: string): HighlightSegment[] {
  const q = query.trim()
  if (!q || !text) return [{ text, hit: false }]

  const segments: HighlightSegment[] = []
  const lowerText = text.toLowerCase()
  const lowerQuery = q.toLowerCase()
  let index = 0

  while (index < text.length) {
    const found = lowerText.indexOf(lowerQuery, index)
    if (found === -1) {
      segments.push({ text: text.slice(index), hit: false })
      break
    }
    if (found > index) {
      segments.push({ text: text.slice(index, found), hit: false })
    }
    segments.push({ text: text.slice(found, found + q.length), hit: true })
    index = found + q.length
  }

  return segments
}
