import type { JSONContent } from '@tiptap/core'

/**
 * 文档模板：新建时预置的 Tiptap JSON 种子内容。
 * 走 importFlow 既有管线（创建空文档 → 跳编辑器 → 协同首帧后 setContent），
 * schema 与 getBaseExtensions 同源，保证种子内容可直接编辑。
 * 节点只用 StarterKit 现有类型（待办用 `[ ]` 文本前缀而非 tasklist 扩展，
 * md 导出/导入天然往返）。
 */

export interface DocTemplate {
  key: string
  /** 同时作为新文档标题 */
  title: string
  build: () => JSONContent
}

function doc(...content: JSONContent[]): JSONContent {
  return { type: 'doc', content }
}

function text(value: string): JSONContent {
  return { type: 'text', text: value }
}

function paragraph(value?: string): JSONContent {
  return value === undefined
    ? { type: 'paragraph' }
    : { type: 'paragraph', content: [text(value)] }
}

function heading(level: 1 | 2 | 3, value: string): JSONContent {
  return { type: 'heading', attrs: { level }, content: [text(value)] }
}

function bulletList(...items: string[]): JSONContent {
  return {
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [paragraph(item)],
    })),
  }
}

export const DOC_TEMPLATES: DocTemplate[] = [
  {
    key: 'meeting',
    title: '会议纪要',
    build: () =>
      doc(
        paragraph('会议时间：＿＿＿＿　地点：＿＿＿＿　主持人：＿＿＿＿'),
        heading(2, '参会人员'),
        bulletList('（列出参会人员）'),
        heading(2, '会议内容'),
        paragraph('（记录讨论要点与结论）'),
        heading(2, '决议事项'),
        bulletList('决议一：'),
        heading(2, '待办事项'),
        bulletList('[ ] 待办一：负责人＿＿＿ 截止＿＿＿'),
      ),
  },
  {
    key: 'weekly',
    title: '周报',
    build: () =>
      doc(
        paragraph('汇报人：＿＿＿＿　周期：＿＿＿＿'),
        heading(2, '本周工作'),
        bulletList('[ ] 工作一'),
        heading(2, '进展与数据'),
        paragraph('（关键进展、数据指标）'),
        heading(2, '问题与风险'),
        bulletList('（问题描述 + 需要的支持）'),
        heading(2, '下周计划'),
        bulletList('[ ] 计划一'),
      ),
  },
  {
    key: 'todo',
    title: '待办清单',
    build: () =>
      doc(
        paragraph('（完成一项勾一项：把 [ ] 改成 [x]）'),
        bulletList('[ ] 待办一', '[ ] 待办二', '[ ] 待办三'),
      ),
  },
]

export function findTemplate(key: string): DocTemplate | undefined {
  return DOC_TEMPLATES.find((template) => template.key === key)
}
