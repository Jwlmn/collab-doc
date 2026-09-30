import { describe, expect, it } from 'vitest'
import { getSchema } from '@tiptap/core'
import { DOC_TEMPLATES, findTemplate } from '../templates'
import { getBaseExtensions } from '../extensions'

describe('文档模板', () => {
  const schema = getSchema(getBaseExtensions())

  it('模板列表含会议纪要 / 周报 / 待办清单', () => {
    expect(DOC_TEMPLATES.map((t) => t.key)).toEqual(['meeting', 'weekly', 'todo'])
  })

  it('每个模板的种子 JSON 都能通过基础 schema 校验', () => {
    for (const template of DOC_TEMPLATES) {
      const node = schema.nodeFromJSON(template.build())
      // check() 递归校验节点类型与内容约束，非法结构会直接抛错
      expect(() => node.check(), `${template.key} 的内容不合法`).not.toThrow()
      expect(node.childCount).toBeGreaterThan(0)
    }
  })

  it('模板标题即文档标题', () => {
    for (const template of DOC_TEMPLATES) {
      expect(template.title.length).toBeGreaterThan(0)
    }
  })

  it('findTemplate 命中与未命中', () => {
    expect(findTemplate('meeting')?.title).toBe('会议纪要')
    expect(findTemplate('nope')).toBeUndefined()
  })
})
