import { describe, expect, it } from 'vitest'
import { parseMarkdown, serializeMarkdown } from '../markdown'
import type { JSONContent } from '@tiptap/core'

const doc = (...content: JSONContent[]): JSONContent => ({ type: 'doc', content })

describe('serializeMarkdown', () => {
  it('标题与段落', () => {
    const json = doc(
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '一级标题' }] },
      { type: 'paragraph', content: [{ type: 'text', text: '普通段落' }] },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: '三级' }] },
    )
    expect(serializeMarkdown(json)).toBe('# 一级标题\n\n普通段落\n\n### 三级')
  })

  it('行内样式与链接', () => {
    const json = doc({
      type: 'paragraph',
      content: [
        { type: 'text', text: '粗' , marks: [{ type: 'bold' }] },
        { type: 'text', text: '与' },
        { type: 'text', text: '斜', marks: [{ type: 'italic' }] },
        { type: 'text', text: '与' },
        { type: 'text', text: '删', marks: [{ type: 'strike' }] },
        { type: 'text', text: '与' },
        { type: 'text', text: '码', marks: [{ type: 'code' }] },
        { type: 'text', text: '与' },
        {
          type: 'text',
          text: '链接',
          marks: [{ type: 'link', attrs: { href: 'https://example.com' } }],
        },
      ],
    })
    expect(serializeMarkdown(json)).toBe(
      '**粗**与*斜*与~~删~~与`码`与[链接](https://example.com)',
    )
  })

  it('无序与有序列表（含嵌套）', () => {
    const json = doc(
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: '甲' }] },
              {
                type: 'bulletList',
                content: [
                  {
                    type: 'listItem',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲-1' }] }],
                  },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '乙' }] }],
          },
        ],
      },
      {
        type: 'orderedList',
        attrs: { start: 1 },
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '第一步' }] }],
          },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '第二步' }] }],
          },
        ],
      },
    )
    expect(serializeMarkdown(json)).toBe(
      ['- 甲', '  - 甲-1', '- 乙', '', '1. 第一步', '2. 第二步'].join('\n'),
    )
  })

  it('引用与代码块与分割线', () => {
    const json = doc(
      {
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '引用内容' }] }],
      },
      { type: 'codeBlock', attrs: { language: 'ts' }, content: [{ type: 'text', text: 'const a = 1' }] },
      { type: 'horizontalRule' },
    )
    expect(serializeMarkdown(json)).toBe('> 引用内容\n\n```ts\nconst a = 1\n```\n\n---')
  })

  it('表格（首行为表头，含分隔行）', () => {
    const json = doc({
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '名称' }] }] },
            { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: '数量' }] }] },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '苹果' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '3' }] }] },
          ],
        },
      ],
    })
    expect(serializeMarkdown(json)).toBe(
      '| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |',
    )
  })

  it('转义 markdown 元字符', () => {
    const json = doc({
      type: 'paragraph',
      content: [{ type: 'text', text: '价格 *便宜* [链接]' }],
    })
    expect(serializeMarkdown(json)).toBe('价格 \\*便宜\\* \\[链接\\]')
  })
})

describe('parseMarkdown', () => {
  it('标题与段落', () => {
    expect(parseMarkdown('# 标题\n\n正文')).toEqual(
      doc(
        { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '标题' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '正文' }] },
      ),
    )
  })

  it('行内样式嵌套', () => {
    expect(parseMarkdown('**粗体里的*斜体***')).toEqual(
      doc({
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '粗体里的',
            marks: [{ type: 'bold' }],
          },
          {
            type: 'text',
            text: '斜体',
            marks: [
              { type: 'italic' },
              { type: 'bold' },
            ],
          },
        ],
      }),
    )
  })

  it('链接与转义', () => {
    expect(parseMarkdown('见 [文档](https://a.b/c) 与 \\*字面量\\*')).toEqual(
      doc({
        type: 'paragraph',
        content: [
          { type: 'text', text: '见 ' },
          { type: 'text', text: '文档', marks: [{ type: 'link', attrs: { href: 'https://a.b/c' } }] },
          { type: 'text', text: ' 与 *字面量*' },
        ],
      }),
    )
  })

  it('无序列表与嵌套', () => {
    const json = parseMarkdown('- 甲\n  - 甲-1\n- 乙')
    expect(json).toEqual(
      doc({
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: '甲' }] },
              {
                type: 'bulletList',
                content: [
                  {
                    type: 'listItem',
                    content: [{ type: 'paragraph', content: [{ type: 'text', text: '甲-1' }] }],
                  },
                ],
              },
            ],
          },
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: '乙' }] }],
          },
        ],
      }),
    )
  })

  it('有序列表', () => {
    expect(parseMarkdown('1. 一\n2. 二')).toEqual(
      doc({
        type: 'orderedList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '一' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '二' }] }] },
        ],
      }),
    )
  })

  it('引用、代码块、分割线', () => {
    const json = parseMarkdown('> 名言\n\n```js\nconsole.log(1)\n```\n\n---')
    expect(json).toEqual(
      doc(
        {
          type: 'blockquote',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '名言' }] }],
        },
        {
          type: 'codeBlock',
          attrs: { language: 'js' },
          content: [{ type: 'text', text: 'console.log(1)' }],
        },
        { type: 'horizontalRule' },
      ),
    )
  })

  it('表格', () => {
    const json = parseMarkdown('| A | B |\n| --- | --- |\n| 1 | 2 |')
    expect(json).toEqual(
      doc({
        type: 'table',
        content: [
          {
            type: 'tableRow',
            content: [
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
              { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
            ],
          },
          {
            type: 'tableRow',
            content: [
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '1' }] }] },
              { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] },
            ],
          },
        ],
      }),
    )
  })

  it('空文档返回空段落', () => {
    expect(parseMarkdown('')).toEqual(doc({ type: 'paragraph' }))
  })
})

describe('roundtrip（md → json → md）', () => {
  const cases = [
    '# 标题一\n\n带 **粗体** 和 *斜体* 的段落',
    '- 项目甲\n- 项目乙',
    '1. 第一步\n2. 第二步',
    '> 引用一句',
    '```python\nprint("hi")\n```',
    '---',
    '| 名称 | 数量 |\n| --- | --- |\n| 苹果 | 3 |',
    '见 [链接](https://example.com) 说明',
  ]

  for (const md of cases) {
    it(JSON.stringify(md.slice(0, 24)), () => {
      const json = parseMarkdown(md)
      const out = serializeMarkdown(json)
      expect(out).toBe(md)
    })
  }
})
