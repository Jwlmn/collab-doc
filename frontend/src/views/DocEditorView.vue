<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { Editor, EditorContent } from '@tiptap/vue-3'
import { relativePositionToAbsolutePosition } from '@tiptap/y-tiptap'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { BubbleMenu } from '@tiptap/extension-bubble-menu'
import { SlashCommand, setImageHandler } from '../extensions/slash-command'
import { getBaseExtensions } from '../io/extensions'
import { firstImageFile, uploadImage } from '../utils/upload'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { useAuthStore } from '../stores/auth'
import { api, getApiErrorMessage } from '../utils/request'
import { getCollabUrl } from '../utils/collab'
import { userColor as colorOf } from '../utils/color'
import VersionDrawer from '../components/VersionDrawer.vue'
import CommentDrawer from '../components/CommentDrawer.vue'
import EditorToolbar from '../components/EditorToolbar.vue'
import ShareModal from '../components/ShareModal.vue'
import ThemeToggle from '../components/ThemeToggle.vue'
import { useImportFlowStore } from '../stores/importFlow'
import { useAutoSnapshot } from '../composables/useAutoSnapshot'
import { serializeMarkdown } from '../io/markdown'
import { jsonToDocxBlob } from '../io/docx-export'
import { downloadText } from '../io/download'
import type { Editor as CoreEditor, JSONContent } from '@tiptap/core'
import type { DocumentMeta } from '../types'

interface CollabTokenData {
  token: string
  role: string
  expires_at: number
}

interface Collaborator {
  name: string
  color: string
}

const PAGE_TITLE = '多人实时协作文档'
const importFlow = useImportFlowStore()

const props = defineProps<{
  /** 公开分享令牌：存在即进入访客只读模式（由 ShareView 传入） */
  shareToken?: string
  /** 访客模式下由 ShareView 预取的文档元数据 */
  sharedMeta?: DocumentMeta
}>()

/** 访客模式：不再调用任何需要登录的接口 */
const isShare = computed(() => !!props.shareToken)

const route = useRoute()
const router = useRouter()
const message = useMessage()
const auth = useAuthStore()

// 访客态没有 /doc/:id 路由，文档 id 只能来自 sharedMeta
const docId = computed(() => Number(props.sharedMeta?.id ?? route.params.id))
const meta = ref<DocumentMeta | null>(props.sharedMeta ?? null)
const loading = ref(true)
const titleEditing = ref('')
const titleInputRef = ref<{ focus: () => void; $el?: HTMLElement } | null>(null)
const bubbleEl = ref<HTMLElement | null>(null)
const connectionStatus = ref<'connecting' | 'connected' | 'disconnected'>('connecting')
const synced = ref(false)
const syncTick = ref(0)
const collaborators = ref<Collaborator[]>([])
const bubbleTick = ref(0)
const versionDrawerVisible = ref(false)
const commentDrawerVisible = ref(false)
const helpVisible = ref(false)
const linkVisible = ref(false)
const linkUrl = ref('https://')
const shareVisible = ref(false)
const unreadComments = ref(0)
const exporting = ref(false)

/** 导出当前富文本文档为 md / docx / PDF（打印对话框另存） */
async function handleExport(key: string) {
  if (!editor.value || exporting.value) return
  if (key === 'pdf') {
    // 界面收敛见 styles/main.css 的 @media print；浏览器打印对话框里选「另存为 PDF」
    window.print()
    return
  }
  const json = editor.value.getJSON()
  const title = meta.value?.title?.trim() || '未命名文档'
  exporting.value = true
  try {
    if (key === 'md') {
      downloadText(serializeMarkdown(json), `${title}.md`, 'text/markdown')
      message.success('已导出 Markdown')
    } else if (key === 'docx') {
      const blob = await jsonToDocxBlob(json, title)
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `${title}.docx`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      message.success('已导出 Word 文档')
    }
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    exporting.value = false
  }
}

const exportOptions = [
  { key: 'md', label: 'Markdown（.md）' },
  { key: 'docx', label: 'Word 文档（.docx）' },
  { key: 'pdf', label: 'PDF（打印导出）' },
]

const editor = shallowRef<Editor | null>(null)
let provider: HocuspocusProvider | null = null
let ydoc: Y.Doc | null = null

const isReadonly = computed(() => meta.value?.role === 'viewer')
const canRename = computed(() => meta.value?.role === 'owner')

/** 内容停更 60s 后自动存一版（只读时不存） */
const autoSnapshot = useAutoSnapshot({
  documentId: () => docId.value,
  enabled: () => !isReadonly.value,
  capture: () => {
    const ed = editor.value
    if (!ed) return null
    return { content_json: ed.getJSON(), content_html: ed.getHTML() }
  },
})

const hasUnsynced = computed(() => {
  void syncTick.value
  return provider?.hasUnsyncedChanges ?? false
})

const statusText = computed(() => {
  if (connectionStatus.value === 'connecting') return '连接中…'
  return '已断开'
})

const statusType = computed(() =>
  connectionStatus.value === 'connecting' ? ('warning' as const) : ('error' as const),
)

/** 稳定的用户颜色（按名字哈希，公共实现见 utils/color） */
/**
 * 头像堆的可访问名称。
 * Lighthouse 的 label-content-name-mismatch 要求「可见文本 ⊆ 可访问名称」，
 * 而堆里的头像首字与 +N 是动态的，只能同样动态地拼进去。
 */
const avatarStackLabel = computed(() => {
  const heads = collaborators.value.slice(0, 4).map((p) => p.name.slice(0, 1)).join('')
  const extra = collaborators.value.length > 4 ? `+${collaborators.value.length - 4}` : ''
  return `在线协作者 ${heads}${extra}`
})

const userColor = computed(() => colorOf(auth.user?.name))

function refreshCollaborators(): void {
  const awareness = provider?.awareness
  if (!awareness) return
  const seen = new Map<string, Collaborator>()
  awareness.getStates().forEach((state) => {
    const user = (state as { user?: Collaborator }).user
    if (user?.name && !seen.has(user.name)) {
      seen.set(user.name, { name: user.name, color: user.color ?? '#888' })
    }
  })
  collaborators.value = Array.from(seen.values())
}

function isActive(name: string, attributes?: Record<string, unknown>): boolean {
  void bubbleTick.value
  return editor.value?.isActive(name, attributes) ?? false
}

function toggleLink(): void {
  if (!editor.value || isReadonly.value) return
  if (editor.value.isActive('link')) {
    editor.value.chain().focus().unsetLink().run()
    return
  }
  linkUrl.value = 'https://'
  linkVisible.value = true
}

/** 确认插入链接（n-modal，替代原生 prompt） */
function confirmLink(): void {
  const url = linkUrl.value.trim()
  if (!url || !editor.value) return
  editor.value.chain().focus().setLink({ href: url }).run()
  linkVisible.value = false
}

/** P0-2：新建来源进入时聚焦标题（随后清掉 query，避免刷新重复触发） */
async function focusTitleIfNew(): Promise<void> {
  if (route.query.new === undefined) return
  await nextTick()
  const active = document.activeElement
  // 用户已开始交互（如点击了网格/编辑器）则不抢焦点，避免竞态把输入导走
  if (active && active !== document.body && titleInputRef.value?.$el?.contains(active) !== true) {
    void router.replace({ query: {} })
    return
  }
  const el = titleInputRef.value?.$el?.querySelector('input')
  el?.focus()
  el?.select()
  void router.replace({ query: {} })
}

/** 在编辑器文档里找首个命中位置；找不到返回 -1 */
function findTextPos(target: Editor, query: string): number {
  const needle = query.toLowerCase()
  let pos = -1

  target.state.doc.descendants((node, nodePos) => {
    if (pos !== -1) return false
    if (!node.isText || !node.text) return true
    const index = node.text.toLowerCase().indexOf(needle)
    if (index === -1) return true
    pos = nodePos + index
    return false
  })

  return pos
}

/**
 * 从搜索列表带着 `?find=` 进来时，跳到首个命中处并清掉参数。
 *
 * `synced` 只代表 Y.js 已拉取，内容刷进 ProseMirror 还要一帧，
 * 所以这里做有界重试（约 10 次 × 60ms）；始终找不到就静默清参数 ——
 * 搜索索引是最终一致的，可能已经过期。
 */
function jumpToFind(attempt = 0): void {
  const raw = route.query.find
  const query = typeof raw === 'string' ? raw.trim() : ''
  if (!query) return

  const target = editor.value
  if (target) {
    const pos = findTextPos(target, query)
    if (pos !== -1) {
      // 必须 focus：ProseMirror 在失焦时不同步 DOM 选区，用户看不到命中位置
      target
        .chain()
        .focus()
        .setTextSelection({ from: pos, to: pos + query.length })
        .scrollIntoView()
        .run()
      const rest = { ...route.query }
      delete rest.find
      void router.replace({ query: rest })
      return
    }
  }

  if (attempt < 10) {
    setTimeout(() => jumpToFind(attempt + 1), 60)
    return
  }

  // 找不到：清参数，不留半截 query
  const rest = { ...route.query }
  delete rest.find
  void router.replace({ query: rest })
}

/* ---------------- 跟随协作者 ---------------- */

/** 正在跟随的协作者名字；null = 未跟随 */
const followName = ref<string | null>(null)

function toggleFollow(name: string): void {
  followName.value = followName.value === name ? null : name
  if (followName.value) {
    message.info(`正在跟随 ${name}（Esc 退出）`)
    applyFollow()
  }
}

/**
 * 把视口滚到目标协作者的光标处。
 *
 * awareness 里的 cursor 是 y-prosemirror 的**相对位置**（随文档演进仍有效），
 * 要经 y-sync 的 binding 映射转成 ProseMirror 绝对位置才能取坐标。
 * 相对位置在对端本地编辑后可能暂时解析不出来 —— 静默跳过，下一次
 * awareness 变化会重试。
 */
function applyFollow(): void {
  const target = followName.value
  const awareness = provider?.awareness
  const ed = editor.value
  if (!target || !awareness || !ed) return

  awareness.getStates().forEach((state, clientId) => {
    if (clientId === awareness.clientID) return
    const typed = state as {
      user?: Collaborator
      cursor?: { anchor?: unknown }
    }
    if (typed.user?.name !== target || !typed.cursor?.anchor) return

    try {
      // ProseMirror 的 Plugin 类型未声明 key（运行时一定有）
      const syncPlugin = ed.state.plugins.find((plugin) =>
        String((plugin as { key?: string }).key).startsWith('y-sync'),
      )
      const ys = syncPlugin?.getState(ed.state) as
        | { doc: unknown; type: unknown; binding: { mapping: unknown } }
        | undefined
      if (!ys?.doc || !ys.type || !ys.binding?.mapping) return

      const absolute = relativePositionToAbsolutePosition(
        ys.doc as never,
        ys.type as never,
        typed.cursor.anchor as never,
        ys.binding.mapping as never,
      )
      if (absolute === null || absolute === undefined) return

      const coords = ed.view.coordsAtPos(absolute)
      if (!Number.isFinite(coords.top)) return
      window.scrollBy({ top: coords.top - window.innerHeight / 2, behavior: 'smooth' })
    } catch {
      // 相对位置失效（对端正在改文档）：静默，等下一次 awareness 变化
    }
  })
}

/** 快捷键：⌘/Ctrl+Enter 开评论抽屉；? 开快捷键说明 */
function handleKeydown(event: KeyboardEvent): void {
  // 跟随态：Esc 优先退出（不 preventDefault，Naive 弹层仍照常关闭）
  if (event.key === 'Escape' && followName.value) {
    followName.value = null
    return
  }

  const target = event.target as HTMLElement | null
  const typing =
    !!target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable)

  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    if (!commentDrawerVisible.value) {
      event.preventDefault()
      commentDrawerVisible.value = true
    }
    return
  }

  if (!typing && event.key === '?') {
    event.preventDefault()
    helpVisible.value = !helpVisible.value
  }
}

/* ---------------- 图片：选择 / 粘贴 / 拖拽 ---------------- */

/**
 * 走文件选择器插入图片（工具栏按钮与斜杠菜单共用）。
 * 复用同一个隐藏 input，避免每次点击都新建 DOM。
 */
function pickImage(target: CoreEditor): void {
  if (isReadonly.value) return
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    input.remove()
    if (!file) return
    await insertImageFile(target, file)
  }
  input.click()
}

async function insertImageFile(target: CoreEditor, file: File): Promise<void> {
  if (isReadonly.value) return
  const hide = message.loading('图片上传中…', { duration: 0 })
  try {
    const { url } = await uploadImage(file)
    target.chain().focus().setImage({ src: url, alt: file.name }).run()
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    hide.destroy()
  }
}

/** 粘贴/拖拽里的图片 → 上传后在指定位置插入；没有图片则交回默认行为 */
function handleImageTransfer(event: ClipboardEvent | DragEvent): boolean {
  if (isReadonly.value) return false
  const data = 'clipboardData' in event ? event.clipboardData : event.dataTransfer
  const file = firstImageFile(data?.files)
  if (!file || !editor.value) return false

  event.preventDefault()
  // 拖拽：用落点定位插入位置；粘贴：用当前选区
  if (event.type === 'drop') {
    const coords = event as DragEvent
    const pos = coords.clientX !== null
      ? editor.value.view.posAtCoords({ left: coords.clientX, top: coords.clientY })
      : null
    if (pos) editor.value.chain().setTextSelection(pos.pos).run()
  }
  void insertImageFile(editor.value, file)
  return true
}

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)
  // 斜杠菜单的「图片」项：接到这里（有 message 上下文）
  setImageHandler((ed) => pickImage(ed))

  try {
    if (isShare.value) {
      // 访客：meta 已由 ShareView 传入（分享端点是访客专用的，不会 401）
      if (meta.value) {
        titleEditing.value = meta.value.title
        document.title = `${meta.value.title} · ${PAGE_TITLE}`
      }
    } else {
      const { data } = await api.get(`/documents/${docId.value}`)
      const loaded: DocumentMeta = data.data
      meta.value = loaded
      // 慢网络下用户可能已抢先把光标放进标题框开打：焦点在输入框时不回填，
      // 避免 meta 落地把正在输入的内容清掉（回车失焦后由 handleRename 兜底）
      const titleEl = titleInputRef.value?.$el
      if (!titleEl || !titleEl.contains(document.activeElement)) {
        titleEditing.value = loaded.title
      }
      document.title = `${loaded.title} · ${PAGE_TITLE}`

      // 防呆：excel 文档误入富文本路由
      if (loaded.type === 'excel') {
        await router.replace(`/sheet/${loaded.id}`)
        return
      }
    }
  } catch (error) {
    message.error(getApiErrorMessage(error))
    // 访客态没有首页权限，跳过去只会被路由守卫踢回登录
    if (!isShare.value) await router.replace('/')
    return
  } finally {
    loading.value = false
  }

  watch(
    () => meta.value?.title,
    (title) => {
      document.title = title ? `${title} · ${PAGE_TITLE}` : PAGE_TITLE
    },
  )

  // 评论未读徽标（访客无权读评论，跳过 —— 调用会 401）
  if (!isShare.value) {
    try {
      const { data } = await api.get(`/documents/${docId.value}/comments/unread`)
      unreadComments.value = data.data.count
    } catch {
      unreadComments.value = 0
    }
  }

  // 协作连接令牌：访客走分享端点（viewer 只读），成员走已鉴权端点
  let collabToken = ''
  try {
    if (isShare.value) {
      const { data } = await api.get<never, { data: { data: CollabTokenData } }>(
        `/share/${props.shareToken}/collab-token`,
      )
      collabToken = data.data.token
    } else {
      const { data } = await api.post<never, { data: { data: CollabTokenData } }>(
        `/documents/${docId.value}/collab-token`,
      )
      collabToken = data.data.token
    }
  } catch (error) {
    message.error(getApiErrorMessage(error))
    if (!isShare.value) await router.replace('/')
    return
  }

  ydoc = new Y.Doc()

  provider = new HocuspocusProvider({
    url: getCollabUrl(),
    name: `doc-${docId.value}`,
    document: ydoc,
    token: collabToken,
  })

  provider.on('status', (event: { status: 'connecting' | 'connected' | 'disconnected' }) => {
    connectionStatus.value = event.status
    if (event.status !== 'connected') {
      synced.value = false
      syncTick.value++
    }
  })

  provider.on('synced', () => {
    synced.value = provider?.synced ?? false
    syncTick.value++
  })

  // 编辑器创建必须等首次同步落地（拿齐服务端状态）；连不上则超时兜底，
  // 保持离线也能进编辑器（骨架屏期间不接受输入，不会丢用户操作）
  const firstSyncSettled = new Promise<void>((resolve) => {
    provider!.on('synced', () => resolve())
    setTimeout(resolve, 4000)
  })

  provider.on('unsyncedChanges', () => {
    syncTick.value++
  })

  provider.awareness?.on('change', () => {
    refreshCollaborators()
    applyFollow()
  })
  refreshCollaborators()

  await firstSyncSettled

  // 骨架段落（撤销安全网）：空文档在 UndoManager 创建之前先写入一个空段落。
  // 否则首次输入会把「段落节点 + 文字」作为一个 tracked 事务整体入栈：
  // 撤销连段落一起删 → y-sync 补一个默认空段落 → 重做恢复原文 → 出现重复段落。
  // 写入早于 UndoManager 构造，永不进撤销栈（与 Collaboration 的 field 保持一致）。
  const fragment = ydoc.getXmlFragment('default')
  if (fragment.length === 0) {
    ydoc.transact(() => {
      const paragraph = new Y.XmlElement('paragraph')
      paragraph.insert(0, [new Y.XmlText()])
      fragment.insert(0, [paragraph])
    })
  }

  // 等待 surface（含气泡菜单容器）渲染完成后再创建编辑器
  await nextTick()

  editor.value = new Editor({
    editable: !isReadonly.value,
    extensions: [
      // 基础 schema（StarterKit + Link + TableKit），与导入转换共用同一列表
      ...getBaseExtensions(),
      ...(bubbleEl.value
        ? [BubbleMenu.configure({ element: bubbleEl.value })]
        : []),
      Collaboration.configure({ document: ydoc }),
      CollaborationCaret.configure({
        provider,
        user: {
          // 访客没有登录态，用「访客」占位，避免两个匿名者同名撞车
          name: auth.user?.name ?? (isShare.value ? '访客' : '匿名'),
          color: userColor.value,
        },
      }),
      // 只读模式不注册斜杠命令
      ...(isReadonly.value ? [] : [SlashCommand]),
    ],
    editorProps: {
      attributes: {
        class: 'doc-editor-content',
      },
      // 截图/拖图直接进文档（返回 false 则走默认行为）
      handlePaste: (view, event) => {
        void view
        return handleImageTransfer(event as ClipboardEvent)
      },
      handleDrop: (view, event) => {
        void view
        return handleImageTransfer(event as DragEvent)
      },
    },
  })

  editor.value.on('transaction', () => {
    bubbleTick.value++
  })
  editor.value.on('update', () => {
    autoSnapshot.notifyChange()
  })

  // 导入流程：协同首帧同步后写入种子内容（空文档专属，一次性消费）
  const pending = importFlow.consumePending()
  if (pending && pending.kind === 'md') {
    const seedJson = pending.json
    const applyImport = () => {
      if (editor.value && !isReadonly.value) {
        editor.value.commands.setContent(seedJson as JSONContent)
      }
    }
    if (provider.synced) {
      applyImport()
    } else {
      // provider 的 EventEmitter 没有 once，用 on + off 实现一次性监听
      const onSynced = () => {
        provider?.off('synced', onSynced)
        applyImport()
      }
      provider.on('synced', onSynced)
    }
  } else if (pending) {
    console.warn('[doc]忽略非 md 导入载荷')
  }

  await focusTitleIfNew()

  // 搜索跳转：jumpToFind 自带重试，无需额外等 synced
  await nextTick()
  if (route.query.find) jumpToFind()
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown)
  editor.value?.destroy()
  provider?.destroy()
  ydoc?.destroy()
  editor.value = null
  provider = null
  ydoc = null
  document.title = PAGE_TITLE
})

async function handleRename() {
  const title = titleEditing.value.trim()
  if (!canRename.value) {
    titleEditing.value = meta.value?.title ?? ''
    return
  }
  if (!meta.value || !title || title === meta.value.title) {
    titleEditing.value = meta.value?.title ?? ''
    return
  }
  try {
    const { data } = await api.put(`/documents/${docId.value}`, { title })
    const updated: DocumentMeta = data.data
    meta.value = updated
    titleEditing.value = updated.title
  } catch (error) {
    titleEditing.value = meta.value?.title ?? ''
    message.error(getApiErrorMessage(error))
  }
}
</script>

<template>
  <div class="editor-page">
    <a href="#main" class="skip-link">跳到正文</a>
    <div class="editor-topbar">
      <n-space align="center" size="large">
        <n-button quaternary aria-label="← 返回列表（返回文档列表）" @click="router.push('/')">← 返回列表</n-button>
        <n-input
          ref="titleInputRef"
          v-model:value="titleEditing"
          class="title-input"
          placeholder="未命名文档"
          :readonly="!canRename"
          :aria-label="canRename ? '编辑文档标题' : '文档标题（仅所有者可改）'"
          @blur="handleRename"
          @keyup.enter="($event.target as HTMLInputElement).blur()"
         name="document-title" id="document-title" />
        <n-tag v-if="isReadonly" size="small" type="warning" round>🔒 只读</n-tag>
      </n-space>
      <n-space align="center" size="small" :wrap="true">
        <ThemeToggle />
        <n-button quaternary size="small" aria-label="?（快捷键说明）" @click="helpVisible = true">?</n-button>
        <n-button v-if="canRename" quaternary size="small" @click="shareVisible = true">共享</n-button>
        <n-dropdown :options="exportOptions" :disabled="exporting" @select="handleExport">
          <n-button quaternary size="small" :loading="exporting" aria-label="导出">
            导出 ▾
          </n-button>
        </n-dropdown>
        <!-- 访客无权读评论/版本（接口会 401），两个入口整体隐藏 -->
        <n-badge v-if="!isShare" :value="unreadComments" :max="99" :show="unreadComments > 0">
          <n-button quaternary size="small" @click="commentDrawerVisible = true">评论</n-button>
        </n-badge>
        <n-button v-if="!isShare" quaternary size="small" @click="versionDrawerVisible = true">版本历史</n-button>

        <n-popover trigger="click" placement="bottom-end">
          <template #trigger>
            <div
              class="avatar-stack"
              role="button"
              tabindex="0"
              :aria-label="avatarStackLabel"
              @keydown.enter.prevent="($event.currentTarget as HTMLElement).click()"
              @keydown.space.prevent="($event.currentTarget as HTMLElement).click()"
            >
              <n-avatar
                v-for="person in collaborators.slice(0, 4)"
                :key="person.name"
                round
                :size="26"
                :color="person.color"
                style="margin-left: -6px; border: 1.5px solid #fff"
              >
                {{ person.name.slice(0, 1) }}
              </n-avatar>
              <n-avatar
                v-if="collaborators.length > 4"
                round
                :size="26"
                color="#909399"
                style="margin-left: -6px; border: 1.5px solid #fff"
              >
                +{{ collaborators.length - 4 }}
              </n-avatar>
            </div>
          </template>
          <n-space vertical size="small">
            <n-text depth="3" style="font-size: 12px">在线协作者（{{ collaborators.length }}）</n-text>
            <n-space
              v-for="person in collaborators"
              :key="person.name"
              align="center"
              size="small"
              justify="space-between"
              style="width: 100%"
            >
              <n-space align="center" size="small">
                <n-avatar round :size="22" :color="person.color">{{ person.name.slice(0, 1) }}</n-avatar>
                <n-text>{{ person.name }}</n-text>
              </n-space>
              <n-button
                size="tiny"
                quaternary
                :type="followName === person.name ? 'primary' : 'default'"
                @click="toggleFollow(person.name)"
              >
                {{ followName === person.name ? '跟随中' : '跟随' }}
              </n-button>
            </n-space>
          </n-space>
        </n-popover>

        <n-tag
          v-if="followName"
          size="small"
          type="info"
          round
          closable
          @close="followName = null"
        >
          跟随 {{ followName }} · Esc 退出
        </n-tag>

        <span role="status" aria-live="polite" class="sync-status">
          <n-tag v-if="connectionStatus !== 'connected'" :type="statusType" size="small" round>
            {{ statusText }}
          </n-tag>
          <n-tag v-else-if="!synced || hasUnsynced" type="info" size="small" round>
            同步中…
          </n-tag>
          <n-tag v-else type="success" size="small" round>✓ 已同步</n-tag>
        </span>
      </n-space>
    </div>

    <!-- P1-5：纸面骨架（editor 未就绪前不撤，消除空纸面窗口） -->
    <div v-if="loading || !editor" class="editor-loading">
      <div class="editor-surface skeleton-surface">
        <n-skeleton height="28px" width="45%" style="margin-bottom: 28px" />
        <n-skeleton text :lines="5" />
      </div>
    </div>

    <div v-else class="editor-surface">
      <!-- 打印专用标题头（屏上不显示）：顶栏被 @media print 收掉后纸面仍要标题 -->
      <div class="print-header">
        <h1>{{ titleEditing || meta?.title || '未命名文档' }}</h1>
      </div>
      <EditorToolbar :editor="editor" :readonly="isReadonly" />

      <div v-show="editor" ref="bubbleEl" class="bubble-menu" role="toolbar" aria-label="选中格式工具栏">
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              size="tiny"
              quaternary
              aria-label="加粗 B"
              :type="isActive('bold') ? 'primary' : 'default'"
              :disabled="isReadonly"
              @click="editor?.chain().focus().toggleBold().run()"
            >
              <strong>B</strong>
            </n-button>
          </template>
          加粗
        </n-tooltip>
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              size="tiny"
              quaternary
              aria-label="斜体"
              :type="isActive('italic') ? 'primary' : 'default'"
              :disabled="isReadonly"
              @click="editor?.chain().focus().toggleItalic().run()"
            >
              <em>I</em>
            </n-button>
          </template>
          斜体
        </n-tooltip>
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              size="tiny"
              quaternary
              aria-label="删除线"
              :type="isActive('strike') ? 'primary' : 'default'"
              :disabled="isReadonly"
              @click="editor?.chain().focus().toggleStrike().run()"
            >
              <s>S</s>
            </n-button>
          </template>
          删除线
        </n-tooltip>
        <n-tooltip trigger="hover">
          <template #trigger>
            <n-button
              size="tiny"
              quaternary
              aria-label="插入链接"
              :type="isActive('link') ? 'primary' : 'default'"
              :disabled="isReadonly"
              @click="toggleLink"
            >
              🔗
            </n-button>
          </template>
          插入链接
        </n-tooltip>
      </div>

      <div id="main" class="editor-main" role="main" tabindex="-1">
        <EditorContent v-if="editor" :editor="editor" />
      </div>
    </div>

    <VersionDrawer
      v-if="!isShare"
      v-model:show="versionDrawerVisible"
      :document-id="docId"
      :editor="editor"
      :readonly="isReadonly"
    />

    <CommentDrawer
      v-if="!isShare"
      v-model:show="commentDrawerVisible"
      :document-id="docId"
      :can-manage="auth.user?.id === meta?.user_id"
      @read="unreadComments = 0"
    />

    <ShareModal v-if="!isShare" v-model:show="shareVisible" :document-id="docId" />

    <n-modal
      v-model:show="linkVisible"
      preset="dialog"
      title="插入链接"
      positive-button-text="确定"
      negative-button-text="取消"
      @positive-click="confirmLink"
    >
      <n-input
        v-model:value="linkUrl"
        placeholder="https://"
        aria-label="链接地址"
        @keyup.enter="confirmLink"
       name="link-url" id="link-url" />
    </n-modal>

    <n-modal v-model:show="helpVisible" preset="card" title="快捷键" style="width: 440px; max-width: 92vw">
      <n-table :bordered="false" :single-line="false" size="small">
        <thead>
          <tr><th>快捷键</th><th>作用</th></tr>
        </thead>
        <tbody>
          <tr><td><kbd>⌘/Ctrl + B</kbd></td><td>加粗</td></tr>
          <tr><td><kbd>⌘/Ctrl + I</kbd></td><td>斜体</td></tr>
          <tr><td><kbd>⌘/Ctrl + Z</kbd></td><td>撤销</td></tr>
          <tr><td><kbd>⇧⌘/Ctrl + Z</kbd></td><td>重做</td></tr>
          <tr><td><kbd>⌘/Ctrl + ⏎</kbd></td><td>打开评论抽屉</td></tr>
          <tr><td><kbd>⇧⌘/Ctrl + S</kbd></td><td>删除线</td></tr>
          <tr><td><kbd>⇧⌘/Ctrl + H</kbd></td><td>高亮</td></tr>
          <tr><td><kbd>/</kbd></td><td>斜杠命令菜单（标题/列表/引用…）</td></tr>
          <tr><td><kbd>/</kbd> 或 <kbd>⌘/Ctrl + K</kbd></td><td>聚焦搜索（文档列表页）</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>关闭弹层</td></tr>
          <tr><td><kbd>?</kbd></td><td>打开/关闭本说明</td></tr>
        </tbody>
      </n-table>
    </n-modal>
  </div>
</template>

<style scoped>
.editor-page {
  min-height: 100vh;
  min-height: 100dvh; /* 移动端地址栏伸缩时视口高度跟随 */
  display: flex;
  flex-direction: column;
  background: var(--bg-page);
}
.editor-topbar {
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  padding: 8px 16px;
  padding-left: calc(16px + env(safe-area-inset-left));
  padding-right: calc(16px + env(safe-area-inset-right));
  background: var(--bg-surface);
  border-bottom: 1px solid var(--border-subtle);
}
.title-input {
  width: min(320px, 42vw);
}
.title-input :deep(.n-input__state-border) {
  transition: border-color 0.2s;
}
.title-input:not(:hover):not(.n-input--focus) :deep(.n-input__state-border) {
  border-color: transparent;
}
.sync-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.avatar-stack {
  display: flex;
  align-items: center;
  padding-left: 8px;
  cursor: pointer;
}
.avatar-stack :deep(.n-avatar:first-child) {
  margin-left: 0;
}
.editor-loading {
  flex: 1;
  display: flex;
  justify-content: center;
  padding-top: 24px;
}
.skeleton-surface {
  min-height: auto;
  padding: 48px 56px;
}
.editor-surface {
  position: relative;
  flex: 1;
  max-width: 900px;
  width: 100%;
  margin: 24px auto;
  padding: 0 56px 48px;
  background: var(--bg-surface);
  border-radius: 8px;
  box-shadow: var(--shadow-card);
  min-height: calc(100vh - 128px);
  min-height: calc(100dvh - 128px);
}
.editor-surface :deep(.fmt-toolbar) {
  margin: 0 -56px;
  border-radius: 8px 8px 0 0;
}
/* 打印标题头：屏上隐藏，@media print 显示（纸面配色统一由 main.css 变量接管） */
.print-header {
  display: none;
}
@media print {
  .print-header {
    display: block;
    margin-bottom: 20px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border-subtle);
  }
  .print-header h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 600;
    color: var(--text-1);
  }
}
.editor-surface :deep(.tiptap) {
  padding-top: 32px;
}
.bubble-menu {
  position: absolute;
  top: -9999px;
  left: -9999px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  /* 跟随主题的浮层底色：浅色下白底深字、深色下深底浅字（原黑底在深色主题下与页面糊成一片） */
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.24);
  z-index: 20;
  visibility: hidden;
  opacity: 0;
  transition: opacity 0.12s ease;
}
/* 触屏（粗指针）：tiny 按钮点击区放大到 36px，桌面视觉不变 */
@media (pointer: coarse) {
  .bubble-menu :deep(.n-button) {
    min-width: 36px;
    min-height: 36px;
  }
}
:deep(.doc-editor-content) {
  /* 不加 :focus-visible 描边：contentEditable 鼠标点入也会命中，
     整块蓝色边框看起来像输入框错位；光标本身已表达聚焦 */
  outline: none;
  font-size: 16px;
  line-height: 1.75;
  min-height: 60vh;
  color: var(--text-1);
}
:deep(.doc-editor-content > h1) {
  font-size: 2em;
  margin: 0.6em 0 0.4em;
}
:deep(.doc-editor-content > h2) {
  font-size: 1.5em;
  margin: 0.6em 0 0.4em;
}
:deep(.doc-editor-content > h3) {
  font-size: 1.25em;
  margin: 0.6em 0 0.4em;
}
:deep(.doc-editor-content > p) {
  margin: 0.4em 0;
}
:deep(.doc-editor-content > ul,
      .doc-editor-content > ol) {
  padding-left: 1.5em;
  margin: 0.4em 0;
}
:deep(.doc-editor-content > blockquote) {
  border-left: 3px solid var(--border-strong);
  margin: 0.6em 0;
  padding-left: 1em;
  color: var(--text-2);
}
:deep(.doc-editor-content > pre) {
  background: var(--bg-muted);
  border-radius: 6px;
  padding: 12px 16px;
  overflow-x: auto;
}
:deep(.doc-editor-content > code) {
  background: var(--bg-muted);
  border-radius: 3px;
  padding: 2px 5px;
  font-size: 0.9em;
}
:deep(.doc-editor-content > hr) {
  border: none;
  border-top: 1px solid var(--border-subtle);
  margin: 1.5em 0;
}
/* 高亮底色恒为浅色系（默认黄 / 调色板粉彩），文字锁深墨水：
   深色主题下若继承页面浅色字，压在亮底上不可读；选色渲染的
   inline `color: inherit` 会被这条 !important 收编 */
:deep(.doc-editor-content mark) {
  color: #1f2329 !important;
  background: #fff3bf;
  border-radius: 2px;
  padding: 0 1px;
}
:deep(.collaboration-carets__caret) {
  position: relative;
  margin-left: -1px;
  margin-right: -1px;
  border-left: 1px solid currentColor;
  border-right: 1px solid currentColor;
  word-break: normal;
  pointer-events: none;
}
:deep(.collaboration-carets__label) {
  position: absolute;
  top: -1.35em;
  left: -1px;
  line-height: 1em;
  font-size: 12px;
  font-weight: 700;
  font-family: Arial, sans-serif;
  font-style: normal;
  color: #fff;
  padding: 2px 6px;
  border-radius: 3px 3px 3px 0;
  user-select: none;
}
kbd {
  background: var(--bg-muted);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 12px;
  font-family: inherit;
}
</style>
