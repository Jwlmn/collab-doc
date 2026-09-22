import { describe, expect, it } from 'vitest'
import { highlight } from '../highlight'

describe('highlight', () => {
  it('空查询返回单个非高亮片段', () => {
    expect(highlight('你好世界', '')).toEqual([{ text: '你好世界', hit: false }])
    expect(highlight('你好世界', '   ')).toEqual([{ text: '你好世界', hit: false }])
  })

  it('查询不出现时整体非高亮', () => {
    expect(highlight('你好世界', 'xyz')).toEqual([{ text: '你好世界', hit: false }])
  })

  it('拆分开头、中间、结尾的命中', () => {
    expect(highlight('abc', 'a')).toEqual([
      { text: 'a', hit: true },
      { text: 'bc', hit: false },
    ])
    expect(highlight('abc', 'b')).toEqual([
      { text: 'a', hit: false },
      { text: 'b', hit: true },
      { text: 'c', hit: false },
    ])
    expect(highlight('abc', 'c')).toEqual([
      { text: 'ab', hit: false },
      { text: 'c', hit: true },
    ])
  })

  it('大小写不敏感', () => {
    expect(highlight('Hello World', 'world')).toEqual([
      { text: 'Hello ', hit: false },
      { text: 'World', hit: true },
    ])
  })

  it('多次命中全部标记', () => {
    const segments = highlight('aa ba aa', 'aa')
    expect(segments.filter((s) => s.hit)).toHaveLength(2)
    expect(segments.map((s) => s.text).join('')).toBe('aa ba aa')
  })

  it('中文查询', () => {
    const segments = highlight('重点讨论供应链金融', '供应链金融')
    expect(segments).toEqual([
      { text: '重点讨论', hit: false },
      { text: '供应链金融', hit: true },
    ])
  })

  it('空文本', () => {
    expect(highlight('', 'x')).toEqual([{ text: '', hit: false }])
  })
})
