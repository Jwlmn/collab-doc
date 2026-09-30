import { Extension } from '@tiptap/core'
import { i18n } from '../i18n'
import { PluginKey } from 'prosemirror-state'
import type { ChainedCommands, Editor } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { createSuggestionPopup } from './suggestion-popup'

/**
 * 图片条目的处理器由编辑器视图注册（那里能拿到 Naive 的 message 上下文，
 * 以及工具栏已有的文件选择逻辑）。斜杠菜单只负责调用它。
 */
let imageHandler: ((editor: Editor) => void) | null = null

export function setImageHandler(handler: (editor: Editor) => void): void {
  imageHandler = handler
}

export interface SlashItem {
  title: string
  keywords: string
  command: (chain: ChainedCommands) => ChainedCommands
  /**
   * 需要跳出命令链的条目（如图片：要先走文件选择与上传）。
   * 提供时优先于 command，command 仅作类型占位。
   */
  action?: (editor: Editor) => void
}

/** 斜杠菜单可插入的块级命令 */
const SLASH_ITEMS_BUILDERS = (): SlashItem[] => [
  {
    title: i18n.global.t('slash.h1'),
    keywords: 'h1 heading 大标题',
    command: (chain) => chain.toggleHeading({ level: 1 }),
  },
  {
    title: i18n.global.t('slash.h2'),
    keywords: 'h2 heading 中标题',
    command: (chain) => chain.toggleHeading({ level: 2 }),
  },
  {
    title: i18n.global.t('slash.h3'),
    keywords: 'h3 heading 小标题',
    command: (chain) => chain.toggleHeading({ level: 3 }),
  },
  {
    title: i18n.global.t('slash.bulletList'),
    keywords: 'ul bullet list 列表',
    command: (chain) => chain.toggleBulletList(),
  },
  {
    title: i18n.global.t('slash.orderedList'),
    keywords: 'ol ordered list 数字列表',
    command: (chain) => chain.toggleOrderedList(),
  },
  {
    title: i18n.global.t('slash.quote'),
    keywords: 'quote blockquote 提示',
    command: (chain) => chain.toggleBlockquote(),
  },
  {
    title: i18n.global.t('slash.codeBlock'),
    keywords: 'code pre 程序',
    command: (chain) => chain.toggleCodeBlock(),
  },
  {
    title: i18n.global.t('slash.hr'),
    keywords: 'hr divider 分隔线',
    command: (chain) => chain.setHorizontalRule(),
  },
  {
    title: i18n.global.t('slash.image'),
    keywords: 'image img picture 图片 插图',
    // 占位：实际走 action（需要先选文件、上传）
    command: (chain) => chain,
    action: (editor) => imageHandler?.(editor),
  },
]

function filterItems(query: string): SlashItem[] {
  const items = SLASH_ITEMS_BUILDERS()
  const q = query.trim().toLowerCase()
  if (!q) return items
  return items.filter(
    (item) =>
      item.title.toLowerCase().includes(q) || item.keywords.toLowerCase().includes(q),
  )
}

/** 编辑器 `/` 斜杠命令扩展（只读模式不要注册） */
export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        // 与 @提及 的 suggestion 必须用不同 pluginKey：默认同名 key 会让
        // ProseMirror 报「Adding different instances of a keyed plugin」
        pluginKey: new PluginKey('slashSuggestion'),
        char: '/',
        startOfLine: false,
        minQueryLength: 0,
        // 默认 allowedPrefixes=[' ']（仅空格/行首后触发）；中文无空格习惯，改为任意位置可触发
        allowedPrefixes: null,
        command: ({ editor, range, props }) => {
          // 先删掉 "/" 查询串，再走条目（action 型条目跳出命令链）
          const chain = editor.chain().focus().deleteRange(range)
          if (props.action) {
            chain.run()
            props.action(editor)
            return
          }
          props.command(chain).run()
        },
        items: ({ query }) => filterItems(query),
        render: () => createSuggestionPopup<SlashItem>(),
      }),
    ]
  },
})
