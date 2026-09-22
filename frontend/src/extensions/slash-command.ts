import { Extension } from '@tiptap/core'
import type { ChainedCommands } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'

export interface SlashItem {
  title: string
  keywords: string
  command: (chain: ChainedCommands) => ChainedCommands
}

/** 斜杠菜单可插入的块级命令 */
export const SLASH_ITEMS: SlashItem[] = [
  {
    title: '标题 1',
    keywords: 'h1 heading 大标题',
    command: (chain) => chain.toggleHeading({ level: 1 }),
  },
  {
    title: '标题 2',
    keywords: 'h2 heading 中标题',
    command: (chain) => chain.toggleHeading({ level: 2 }),
  },
  {
    title: '标题 3',
    keywords: 'h3 heading 小标题',
    command: (chain) => chain.toggleHeading({ level: 3 }),
  },
  {
    title: '无序列表',
    keywords: 'ul bullet list 列表',
    command: (chain) => chain.toggleBulletList(),
  },
  {
    title: '有序列表',
    keywords: 'ol ordered list 数字列表',
    command: (chain) => chain.toggleOrderedList(),
  },
  {
    title: '引用',
    keywords: 'quote blockquote 提示',
    command: (chain) => chain.toggleBlockquote(),
  },
  {
    title: '代码块',
    keywords: 'code pre 程序',
    command: (chain) => chain.toggleCodeBlock(),
  },
  {
    title: '分割线',
    keywords: 'hr divider 分隔线',
    command: (chain) => chain.setHorizontalRule(),
  },
]

function filterItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return SLASH_ITEMS
  return SLASH_ITEMS.filter(
    (item) =>
      item.title.toLowerCase().includes(q) || item.keywords.toLowerCase().includes(q),
  )
}

/**
 * 纯 DOM 渲染的斜杠菜单（挂 body，样式在 main.css 的 .slash-menu-*）。
 * 避开 VueRenderer 的应用上下文传递问题。
 */
function createSlashPopup() {
  let root: HTMLDivElement | null = null
  let items: SlashItem[] = []
  let selectedIndex = 0
  let runCommand: ((item: SlashItem) => void) | null = null

  function ensureRoot(): HTMLDivElement {
    if (root) return root
    root = document.createElement('div')
    root.className = 'slash-menu'
    root.style.display = 'none'
    document.body.appendChild(root)
    return root
  }

  function hide(): void {
    if (root) root.style.display = 'none'
    runCommand = null
  }

  function renderItems(): void {
    const el = ensureRoot()
    el.innerHTML = ''

    items.forEach((item, index) => {
      const row = document.createElement('div')
      row.className = 'slash-menu-item' + (index === selectedIndex ? ' active' : '')
      row.textContent = item.title

      row.addEventListener('mousedown', (event) => {
        event.preventDefault()
        runCommand?.(item)
        hide()
      })

      el.appendChild(row)
    })
  }

  function position(rect: DOMRect | null): void {
    if (!rect || !root) return
    const margin = 8
    let top = rect.bottom + 6
    let left = rect.left

    const width = root.offsetWidth || 220
    const height = root.offsetHeight || 160

    if (left + width > window.innerWidth - margin) {
      left = Math.max(margin, window.innerWidth - width - margin)
    }
    if (top + height > window.innerHeight - margin) {
      top = Math.max(margin, rect.top - height - 6)
    }

    root.style.top = `${top}px`
    root.style.left = `${left}px`
  }

  function show(props: {
    items: SlashItem[]
    clientRect?: (() => DOMRect | null) | null
    command: (item: SlashItem) => void
  }): void {
    items = props.items
    selectedIndex = 0
    runCommand = props.command

    if (items.length === 0) {
      hide()
      return
    }

    const el = ensureRoot()
    renderItems()
    el.style.display = 'block'
    position(props.clientRect?.() ?? null)
  }

  function update(props: {
    items: SlashItem[]
    clientRect?: (() => DOMRect | null) | null
    command: (item: SlashItem) => void
  }): void {
    show(props)
  }

  return {
    onStart: show,
    onUpdate: update,
    onExit: hide,
    onKeyDown: ({ event }: { event: KeyboardEvent }): boolean => {
      if (!root || root.style.display === 'none') return false

      switch (event.key) {
        case 'ArrowDown':
          selectedIndex = (selectedIndex + 1) % Math.max(items.length, 1)
          renderItems()
          return true
        case 'ArrowUp':
          selectedIndex = (selectedIndex - 1 + items.length) % Math.max(items.length, 1)
          renderItems()
          return true
        case 'Enter': {
          const item = items[selectedIndex]
          if (item && runCommand) {
            runCommand(item)
            hide()
            return true
          }
          return false
        }
        case 'Escape':
          hide()
          return true
        default:
          return false
      }
    },
  }
}

/** 编辑器 `/` 斜杠命令扩展（只读模式不要注册） */
export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        char: '/',
        startOfLine: false,
        minQueryLength: 0,
        // 默认 allowedPrefixes=[' ']（仅空格/行首后触发）；中文无空格习惯，改为任意位置可触发
        allowedPrefixes: null,
        command: ({ editor, range, props }) => {
          props
            .command(editor.chain().focus().deleteRange(range))
            .run()
        },
        items: ({ query }) => filterItems(query),
        render: () => createSlashPopup(),
      }),
    ]
  },
})
