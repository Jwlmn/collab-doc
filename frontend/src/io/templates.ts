import type { JSONContent } from '@tiptap/core'
import { i18n } from '../i18n'

/**
 * 文档模板：新建时预置的 Tiptap JSON 种子内容。
 * 走 importFlow 既有管线（创建空文档 → 跳编辑器 → 协同首帧后 setContent），
 * schema 与 getBaseExtensions 同源，保证种子内容可直接编辑。
 * 节点只用 StarterKit 现有类型（待办用 `[ ]` 文本前缀而非 tasklist 扩展，
 * md 导出/导入天然往返）。全部文案经 i18n：种子语言跟随应用语言。
 */

export interface DocTemplate {
  key: string
  /** 同步取当前语言的模板标题（即新文档标题） */
  title: () => string
  build: () => JSONContent
}

const t = (key: string): string => i18n.global.t(key)

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
    title: () => t('templates.meeting.title'),
    build: () =>
      doc(
        paragraph(t('templates.meeting.metaLine')),
        heading(2, t('templates.meeting.attendees')),
        bulletList(t('templates.meeting.attendeesItem')),
        heading(2, t('templates.meeting.content')),
        paragraph(t('templates.meeting.contentHint')),
        heading(2, t('templates.meeting.decisions')),
        bulletList(t('templates.meeting.decisionItem')),
        heading(2, t('templates.meeting.todos')),
        bulletList(t('templates.meeting.todoItem')),
      ),
  },
  {
    key: 'weekly',
    title: () => t('templates.weekly.title'),
    build: () =>
      doc(
        paragraph(t('templates.weekly.metaLine')),
        heading(2, t('templates.weekly.work')),
        bulletList(t('templates.weekly.workItem')),
        heading(2, t('templates.weekly.progress')),
        paragraph(t('templates.weekly.progressHint')),
        heading(2, t('templates.weekly.issues')),
        bulletList(t('templates.weekly.issuesItem')),
        heading(2, t('templates.weekly.next')),
        bulletList(t('templates.weekly.nextItem')),
      ),
  },
  {
    key: 'todo',
    title: () => t('templates.todo.title'),
    build: () =>
      doc(
        paragraph(t('templates.todo.hint')),
        bulletList(t('templates.todo.item1'), t('templates.todo.item2'), t('templates.todo.item3')),
      ),
  },
]

export function findTemplate(key: string): DocTemplate | undefined {
  return DOC_TEMPLATES.find((template) => template.key === key)
}
