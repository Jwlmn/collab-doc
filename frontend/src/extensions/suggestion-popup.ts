/**
 * 纯 DOM 渲染的建议弹层（挂 body，样式复用 main.css 的 .slash-menu-*）。
 * 斜杠命令与 @提及 共用同一套渲染/键盘导航，避开 VueRenderer 的
 * 应用上下文传递问题。
 */
export interface PopupItem {
  title: string
}

export function createSuggestionPopup<T extends PopupItem>() {
  let root: HTMLDivElement | null = null
  let items: T[] = []
  let selectedIndex = 0
  let runCommand: ((item: T) => void) | null = null

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
    items: T[]
    clientRect?: (() => DOMRect | null) | null
    command: (item: T) => void
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

  return {
    onStart: show,
    onUpdate: show,
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
