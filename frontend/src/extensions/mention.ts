import { Extension, Mark, mergeAttributes } from '@tiptap/core'
import { PluginKey } from 'prosemirror-state'
import Suggestion from '@tiptap/suggestion'
import { api } from '../utils/request'
import { createSuggestionPopup, type PopupItem } from './suggestion-popup'

/**
 * 编辑器视图注册的提及上下文：上报站内通知需要当前用户与文档 id。
 * 与斜杠命令的 imageHandler 同一模式（扩展拿不到组件级状态）。
 */
let mentionContext: { documentId: number; currentUserId: number | null } | null = null

export function setMentionContext(
  context: { documentId: number; currentUserId: number | null } | null,
): void {
  mentionContext = context
}

/**
 * @提及 标记（mark 而非节点）：文字本体就是「@姓名」，mark 只携带 userId。
 * 这样 md/docx 导出天然降级为纯文本，全文搜索也能命中提及内容。
 */
export const MentionMark = Mark.create({
  name: 'mention',
  // 光标停在提及末尾继续打字时不把新字吞进标记
  inclusive: false,

  addAttributes() {
    return {
      userId: {
        default: null,
        parseHTML: (element) => Number(element.getAttribute('data-user-id')) || null,
        renderHTML: (attributes) =>
          attributes.userId ? { 'data-user-id': String(attributes.userId) } : {},
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-mention]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-mention': '', class: 'doc-mention' }),
    ]
  },
})

interface MentionItem extends PopupItem {
  id: number
  name: string
}

/** 编辑器正文内 `@` 触发的用户建议（只读模式不要注册） */
export const MentionSuggestion = Extension.create({
  name: 'mentionSuggestion',

  addProseMirrorPlugins() {
    return [
      Suggestion<MentionItem, MentionItem>({
        editor: this.editor,
        pluginKey: new PluginKey('mentionSuggestion'),
        char: '@',
        startOfLine: false,
        minQueryLength: 0,
        // 中文输入无空格习惯，任意位置可触发（与斜杠命令一致）
        allowedPrefixes: null,
        debounce: 150,
        items: async ({ query }) => {
          const keyword = query.trim()
          if (!keyword) return []
          try {
            const { data } = await api.get('/users/search', { params: { q: keyword } })
            return (data.data as Array<{ id: number; name: string }>).map((user) => ({
              ...user,
              title: user.name,
            }))
          } catch {
            return []
          }
        },
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({
              type: 'text',
              text: `@${props.name}`,
              marks: [{ type: 'mention', attrs: { userId: props.id } }],
            })
            .insertContent(' ')
            .run()

          // 站内通知上报（幂等，服务端按文档去重）：本人提及不通知，失败不打断编辑
          if (mentionContext && props.id !== mentionContext.currentUserId) {
            void api
              .post(`/documents/${mentionContext.documentId}/mentions`, {
                user_ids: [props.id],
              })
              .catch(() => {
                /* 上报失败静默：提及已插入，通知是增强而非契约 */
              })
          }
        },
        render: () => createSuggestionPopup<MentionItem>(),
      }),
    ]
  },
})
