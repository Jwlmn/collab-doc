import { describe, expect, it } from 'vitest'
import { parseContent } from '../mention'

describe('parseContent', () => {
  it('纯文本原样返回单片段', () => {
    expect(parseContent('普通评论')).toEqual([{ type: 'text', text: '普通评论' }])
  })

  it('解析单个提及', () => {
    expect(parseContent('@[李四](user:2) 看一下')).toEqual([
      { type: 'mention', name: '李四', userId: 2 },
      { type: 'text', text: ' 看一下' },
    ])
  })

  it('解析多个提及与混合文本', () => {
    expect(parseContent('请 @[李四](user:2) 和 @[王五](user:3) 复核')).toEqual([
      { type: 'text', text: '请 ' },
      { type: 'mention', name: '李四', userId: 2 },
      { type: 'text', text: ' 和 ' },
      { type: 'mention', name: '王五', userId: 3 },
      { type: 'text', text: ' 复核' },
    ])
  })

  it('格式错误的标记按纯文本保留', () => {
    expect(parseContent('@[未闭合 和 @[](user:) 和 @裸文本')).toEqual([
      { type: 'text', text: '@[未闭合 和 @[](user:) 和 @裸文本' },
    ])
  })

  it('空字符串', () => {
    expect(parseContent('')).toEqual([])
  })

  it('拼接后与原文一致（不丢字符）', () => {
    const raw = '前 @[李四](user:2) 中 @[李四](user:2) 后'
    const joined = parseContent(raw)
      .map((s) => (s.type === 'text' ? s.text : `@[${s.name}](user:${s.userId})`))
      .join('')
    expect(joined).toBe(raw)
  })
})
