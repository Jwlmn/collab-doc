<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, nextTick, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { Editor, EditorContent } from '@tiptap/vue-3'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import { BubbleMenu } from '@tiptap/extension-bubble-menu'
import { SlashCommand } from '../extensions/slash-command'
import { getBaseExtensions } from '../io/extensions'
import { HocuspocusProvider } from '@hocuspocus/provider'
import * as Y from 'yjs'
import { useAuthStore } from '../stores/auth'
import { api, getApiErrorMessage } from '../utils/request'
import VersionDrawer from '../components/VersionDrawer.vue'
import CommentDrawer from '../components/CommentDrawer.vue'
import EditorToolbar from '../components/EditorToolbar.vue'
import ShareModal from '../components/ShareModal.vue'
import { useImportFlowStore } from '../stores/importFlow'
import { serializeMarkdown } from '../io/markdown'
import { jsonToDocxBlob } from '../io/docx-export'
import { downloadText } from '../io/download'
import type { JSONContent } from '@tiptap/core'
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

const route = useRoute()
const router = useRouter()
const message = useMessage()
const auth = useAuthStore()

const docId = computed(() => Number(route.params.id))
const meta = ref<DocumentMeta | null>(null)
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
const shareVisible = ref(false)
const unreadComments = ref(0)
const exporting = ref(false)

/** 导出当前富文本文档为 md / docx（Excel 格式属于表格文档专属） */
async function handleExport(key: string) {
  if (!editor.value || exporting.value) return
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
    message.error(error instanceof Error ? error.message : '导出失败')
  } finally {
    exporting.value = false
  }
}

const exportOptions = [
  { key: 'md', label: 'Markdown（.md）' },
  { key: 'docx', label: 'Word 文档（.docx）' },
]

const editor = shallowRef<Editor | null>(null)
let provider: HocuspocusProvider | null = null
let ydoc: Y.Doc | null = null

const isReadonly = computed(() => meta.value?.role === 'viewer')
const canRename = computed(() => meta.value?.role === 'owner')

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

/** 稳定的用户颜色（按名字哈希） */
const userColor = computed(() => {
  const name = auth.user?.name ?? '匿名'
  const palette = ['#e57373', '#f06292', '#7986cb', '#4db6ac', '#81c784', '#ffb74d', '#9575cd']
  let hash = 0
  for (const ch of name) hash = (hash + ch.charCodeAt(0)) % palette.length
  return palette[hash]
})

function refreshCollaborators(): void {
  if (!provider) return
  const seen = new Map<string, Collaborator>()
  provider.awareness.getStates().forEach((state) => {
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
  const url = window.prompt('输入链接地址', 'https://')
  if (url) {
    editor.value.chain().focus().setLink({ href: url }).run()
  }
}

/** P0-2：新建来源进入时聚焦标题（随后清掉 query，避免刷新重复触发） */
async function focusTitleIfNew(): Promise<void> {
  if (route.query.new === undefined) return
  await nextTick()
  const el = titleInputRef.value?.$el?.querySelector('input')
  el?.focus()
  el?.select()
  void router.replace({ query: {} })
}

/** 快捷键：⌘/Ctrl+Enter 开评论抽屉；? 开快捷键说明 */
function handleKeydown(event: KeyboardEvent): void {
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

onMounted(async () => {
  window.addEventListener('keydown', handleKeydown)

  try {
    const { data } = await api.get(`/documents/${docId.value}`)
    meta.value = data.data
    titleEditing.value = meta.value.title
    document.title = `${meta.value.title} · ${PAGE_TITLE}`

    // 防呆：excel 文档误入富文本路由
    if (meta.value.type === 'excel') {
      await router.replace(`/sheet/${meta.value.id}`)
      return
    }
  } catch (error) {
    message.error(getApiErrorMessage(error))
    await router.replace('/')
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

  // 评论未读徽标
  try {
    const { data } = await api.get(`/documents/${docId.value}/comments/unread`)
    unreadComments.value = data.data.count
  } catch {
    unreadComments.value = 0
  }

  // 获取协作连接令牌（无权限或令牌失效时服务端会拒绝连接）
  let collabToken = ''
  try {
    const { data } = await api.post<never, { data: { data: CollabTokenData } }>(
      `/documents/${docId.value}/collab-token`,
    )
    collabToken = data.data.token
  } catch (error) {
    message.error(getApiErrorMessage(error))
    await router.replace('/')
    return
  }

  ydoc = new Y.Doc()

  provider = new HocuspocusProvider({
    url: import.meta.env.VITE_COLLAB_URL ?? 'ws://127.0.0.1:1234',
    name: `doc-${docId.value}`,
    document: ydoc,
    token: collabToken,
  })

  provider.on('status', (event) => {
    connectionStatus.value = event.status as typeof connectionStatus.value
    if (event.status !== 'connected') {
      synced.value = false
      syncTick.value++
    }
  })

  provider.on('synced', () => {
    synced.value = provider?.synced ?? false
    syncTick.value++
  })

  provider.on('unsyncedChanges', () => {
    syncTick.value++
  })

  provider.awareness.on('change', () => {
    refreshCollaborators()
  })
  refreshCollaborators()

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
          name: auth.user?.name ?? '匿名',
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
    },
  })

  editor.value.on('transaction', () => {
    bubbleTick.value++
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
    meta.value = data.data
    titleEditing.value = meta.value.title
  } catch (error) {
    titleEditing.value = meta.value?.title ?? ''
    message.error(getApiErrorMessage(error))
  }
}
</script>

<template>
  <div class="editor-page">
    <div class="editor-topbar">
      <n-space align="center" size="large">
        <n-button quaternary aria-label="返回文档列表" @click="router.push('/')">← 返回列表</n-button>
        <n-input
          ref="titleInputRef"
          v-model:value="titleEditing"
          class="title-input"
          placeholder="未命名文档"
          :readonly="!canRename"
          :aria-label="canRename ? '编辑文档标题' : '文档标题（仅所有者可改）'"
          @blur="handleRename"
          @keyup.enter="($event.target as HTMLInputElement).blur()"
        />
        <n-tag v-if="isReadonly" size="small" type="warning" round>🔒 只读</n-tag>
      </n-space>
      <n-space align="center" size="small">
        <n-button quaternary size="small" aria-label="快捷键说明" @click="helpVisible = true">?</n-button>
        <n-button v-if="canRename" quaternary size="small" @click="shareVisible = true">共享</n-button>
        <n-dropdown :options="exportOptions" :disabled="exporting" @select="handleExport">
          <n-button quaternary size="small" :loading="exporting" aria-label="导出">
            导出 ▾
          </n-button>
        </n-dropdown>
        <n-badge :value="unreadComments" :max="99" :show="unreadComments > 0">
          <n-button quaternary size="small" @click="commentDrawerVisible = true">评论</n-button>
        </n-badge>
        <n-button quaternary size="small" @click="versionDrawerVisible = true">版本历史</n-button>

        <n-popover trigger="click" placement="bottom-end">
          <template #trigger>
            <div class="avatar-stack" role="button" aria-label="在线协作者">
              <n-avatar
                v-for="person in collaborators.slice(0, 4)"
                :key="person.name"
                round
                :size="26"
                :color="person.color"
                style="margin-left: -8px; border: 2px solid #fff"
              >
                {{ person.name.slice(0, 1) }}
              </n-avatar>
              <n-avatar
                v-if="collaborators.length > 4"
                round
                :size="26"
                color="#909399"
                style="margin-left: -8px; border: 2px solid #fff"
              >
                +{{ collaborators.length - 4 }}
              </n-avatar>
            </div>
          </template>
          <n-space vertical size="small">
            <n-text depth="3" style="font-size: 12px">在线协作者（{{ collaborators.length }}）</n-text>
            <n-space v-for="person in collaborators" :key="person.name" align="center" size="small">
              <n-avatar round :size="22" :color="person.color">{{ person.name.slice(0, 1) }}</n-avatar>
              <n-text>{{ person.name }}</n-text>
            </n-space>
          </n-space>
        </n-popover>

        <n-tag v-if="connectionStatus !== 'connected'" :type="statusType" size="small" round>
          {{ statusText }}
        </n-tag>
        <n-tag v-else-if="!synced || hasUnsynced" type="info" size="small" round>
          同步中…
        </n-tag>
        <n-tag v-else type="success" size="small" round>✓ 已同步</n-tag>
      </n-space>
    </div>

    <!-- P1-5：纸面骨架 -->
    <div v-if="loading" class="editor-loading">
      <div class="editor-surface skeleton-surface">
        <n-skeleton height="28px" width="45%" style="margin-bottom: 28px" />
        <n-skeleton text :lines="5" />
      </div>
    </div>

    <div v-else class="editor-surface">
      <EditorToolbar :editor="editor" :readonly="isReadonly" />

      <div v-show="editor" ref="bubbleEl" class="bubble-menu" role="toolbar" aria-label="选中格式工具栏">
        <n-button
          size="tiny"
          quaternary
          aria-label="加粗"
          :type="isActive('bold') ? 'primary' : 'default'"
          :disabled="isReadonly"
          @click="editor?.chain().focus().toggleBold().run()"
        >
          <strong>B</strong>
        </n-button>
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
      </div>

      <EditorContent v-if="editor" :editor="editor" />
    </div>

    <VersionDrawer
      v-model:show="versionDrawerVisible"
      :document-id="docId"
      :editor="editor"
      :readonly="isReadonly"
    />

    <CommentDrawer
      v-model:show="commentDrawerVisible"
      :document-id="docId"
      :can-manage="auth.user?.id === meta?.user_id"
      @read="unreadComments = 0"
    />

    <ShareModal v-model:show="shareVisible" :document-id="docId" />

    <n-modal v-model:show="helpVisible" preset="card" title="快捷键" style="width: 440px">
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
}
.editor-surface :deep(.fmt-toolbar) {
  margin: 0 -56px;
  border-radius: 8px 8px 0 0;
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
  background: #1f2329;
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.24);
  z-index: 20;
  visibility: hidden;
  opacity: 0;
  transition: opacity 0.12s ease;
}
:deep(.doc-editor-content) {
  outline: none;
  font-size: 16px;
  line-height: 1.75;
  min-height: 60vh;
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
  border-left: 3px solid #d0d3d9;
  margin: 0.6em 0;
  padding-left: 1em;
  color: #666;
}
:deep(.doc-editor-content > pre) {
  background: #f4f5f7;
  border-radius: 6px;
  padding: 12px 16px;
  overflow-x: auto;
}
:deep(.doc-editor-content > code) {
  background: #f4f5f7;
  border-radius: 3px;
  padding: 2px 5px;
  font-size: 0.9em;
}
:deep(.doc-editor-content > hr) {
  border: none;
  border-top: 1px solid #e5e6eb;
  margin: 1.5em 0;
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
  background: #f2f3f5;
  border: 1px solid #e5e6eb;
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 12px;
  font-family: inherit;
}
</style>
