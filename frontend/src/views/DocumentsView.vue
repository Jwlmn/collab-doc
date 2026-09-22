<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { useDialog, useMessage, type DropdownOption } from 'naive-ui'
import { useDocumentsStore } from '../stores/documents'
import { getApiErrorMessage } from '../utils/request'
import ShareModal from '../components/ShareModal.vue'
import { highlight } from '../utils/highlight'
import { useIsMobile } from '../composables/useIsMobile'
import { useImportFlowStore } from '../stores/importFlow'
import { importFileToPayload, docTitleFromFilename } from '../io/importFile'
import type { DocumentMeta } from '../types'

/** 按文档类型打开对应编辑器 */
function openDoc(doc: Pick<DocumentMeta, 'id' | 'type'>) {
  return router.push(doc.type === 'excel' ? `/sheet/${doc.id}` : `/doc/${doc.id}`)
}

const documents = useDocumentsStore()
const importFlow = useImportFlowStore()
const message = useMessage()
const dialog = useDialog()
const router = useRouter()
const isMobile = useIsMobile()

const importing = ref(false)
const fileInputRef = ref<HTMLInputElement | null>(null)

function openImportPicker() {
  fileInputRef.value?.click()
}

/**
 * 导入文件 → 按载荷类型创建对应文档并跳转：
 * - .md/.docx → md 富文本文档
 * - .xlsx → excel 电子表格文档（互不影响）
 */
async function handleImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // 允许重复选择同一文件
  if (!file) return

  importing.value = true
  try {
    const payload = await importFileToPayload(file)
    const title = docTitleFromFilename(file.name)
    const doc = await documents.create(title, payload.kind)

    if (payload.kind === 'md' && payload.json) {
      importFlow.setPending({ kind: 'md', json: payload.json })
    } else if (payload.kind === 'excel' && payload.cells) {
      importFlow.setPending({ kind: 'excel', cells: payload.cells })
    }

    await router.push(payload.kind === 'excel' ? `/sheet/${doc.id}` : `/doc/${doc.id}`)
    message.success(`已导入「${title}」（${payload.kind === 'excel' ? 'Excel' : 'MD'}）`)
  } catch (error) {
    const msg = error instanceof Error ? error.message : getApiErrorMessage(error)
    message.error(msg)
  } finally {
    importing.value = false
  }
}

const creating = ref(false)
const renaming = ref(false)
const renameTarget = reactive({ id: 0, title: '' })
const renameDialogVisible = ref(false)

const shareVisible = ref(false)
const shareDocumentId = ref(0)

const searchInput = ref('')
const searchBoxRef = ref<{ focus: () => void } | null>(null)
let searchTimer: ReturnType<typeof setTimeout> | null = null

/** P2-5：列表偏好（排序 + 视图），localStorage 持久化 */
type SortKey = 'updated' | 'title'
type ViewMode = 'list' | 'grid'
const PREFS_KEY = 'collab-doc.listPrefs'

function loadPrefs(): { sortBy: SortKey; viewMode: ViewMode } {
  try {
    const raw = localStorage.getItem(PREFS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as { sortBy?: SortKey; viewMode?: ViewMode }
      return {
        sortBy: parsed.sortBy === 'title' ? 'title' : 'updated',
        viewMode: parsed.viewMode === 'grid' ? 'grid' : 'list',
      }
    }
  } catch {
    /* 忽略损坏的偏好数据 */
  }
  return { sortBy: 'updated', viewMode: 'list' }
}

const initialPrefs = loadPrefs()
const sortBy = ref<SortKey>(initialPrefs.sortBy)
const viewMode = ref<ViewMode>(initialPrefs.viewMode)

watch([sortBy, viewMode], () => {
  localStorage.setItem(
    PREFS_KEY,
    JSON.stringify({ sortBy: sortBy.value, viewMode: viewMode.value }),
  )
})

const sortOptions = [
  { label: '最近更新', value: 'updated' },
  { label: '按标题', value: 'title' },
]

const sortedList = computed(() => {
  const arr = [...documents.list]
  if (sortBy.value === 'title') {
    arr.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  } else {
    arr.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
  }
  return arr
})

watch(searchInput, (value) => {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(() => {
    void documents.search(value).catch((error) => message.error(getApiErrorMessage(error)))
  }, 300)
})

/** P1-2：/ 或 ⌘K 聚焦搜索框 */
function handleSearchShortcut(event: KeyboardEvent) {
  const target = event.target as HTMLElement | null
  const typing =
    !!target &&
    (target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable)

  const isFocusSearch =
    event.key === '/' ||
    ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')

  if (isFocusSearch && !typing) {
    event.preventDefault()
    searchBoxRef.value?.focus()
  }
}

onMounted(() => {
  void documents.fetch().catch((error) => message.error(getApiErrorMessage(error)))
  window.addEventListener('keydown', handleSearchShortcut)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleSearchShortcut)
})

const createMenuOptions = [
  { key: 'md', label: '📄 MD 文档（富文本）' },
  { key: 'excel', label: '📊 Excel 表格（电子表格）' },
]

async function handleCreate(type: 'md' | 'excel' = 'md') {
  creating.value = true
  try {
    const doc = await documents.create(undefined, type)
    // P0-2：创建后直达编辑器并聚焦标题
    await router.push({
      path: type === 'excel' ? `/sheet/${doc.id}` : `/doc/${doc.id}`,
      query: { new: '1' },
    })
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    creating.value = false
  }
}

function handleCreateMenu(key: string) {
  void handleCreate(key === 'excel' ? 'excel' : 'md')
}

function openRename(doc: DocumentMeta) {
  renameTarget.id = doc.id
  renameTarget.title = doc.title
  renameDialogVisible.value = true
}

function openShare(doc: DocumentMeta) {
  shareDocumentId.value = doc.id
  shareVisible.value = true
}

async function handleRename() {
  if (!renameTarget.title.trim()) return
  renaming.value = true
  try {
    await documents.rename(renameTarget.id, renameTarget.title.trim())
    renameDialogVisible.value = false
    message.success('已重命名')
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    renaming.value = false
  }
}

async function handleDelete(doc: DocumentMeta) {
  try {
    await documents.remove(doc.id)
    message.success(`已删除「${doc.title}」`)
  } catch (error) {
    message.error(getApiErrorMessage(error))
  }
}

/** 移动端「⋯」菜单：删除用对话框确认（无 popconfirm 宿主） */
function ownerMenuOptions(doc: DocumentMeta): DropdownOption[] {
  return [
    { key: 'share', label: '共享设置' },
    { key: 'rename', label: '重命名' },
    { key: 'delete', label: '删除', props: { style: 'color: #d03050' } },
  ]
}

function handleOwnerMenu(key: string, doc: DocumentMeta) {
  if (key === 'share') openShare(doc)
  else if (key === 'rename') openRename(doc)
  else if (key === 'delete') {
    dialog.warning({
      title: '删除文档',
      content: `确定删除「${doc.title}」吗？此操作不可恢复。`,
      positiveText: '删除',
      negativeText: '取消',
      positiveButtonProps: { type: 'error' },
      onPositiveClick: () => handleDelete(doc),
    })
  }
}

/** 列表成员头像：所有者 + 成员按 id 去重 */
function memberAvatars(doc: DocumentMeta) {
  const people: Array<{ id: number | null; name: string; color: string }> = []
  const palette = ['#e57373', '#7986cb', '#4db6ac', '#81c784', '#ffb74d', '#9575cd', '#f06292']
  const push = (id: number | null, name: string | null) => {
    if (!name || people.some((p) => p.id === id)) return
    let hash = 0
    for (const ch of name) hash = (hash + ch.charCodeAt(0)) % palette.length
    people.push({ id, name, color: palette[hash] })
  }
  push(doc.owner?.id ?? null, doc.owner?.name ?? null)
  for (const member of doc.members ?? []) push(member.id, member.name)
  return people
}

function formatTime(value?: string): string {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div>
    <div class="list-header">
      <h2 style="margin: 0">{{ documents.searching ? '搜索结果' : '文档' }}</h2>
      <n-space align="center" class="header-actions">
        <n-select
          v-model:value="sortBy"
          :options="sortOptions"
          size="small"
          aria-label="排序方式"
          style="width: 110px"
        />
        <n-button-group size="small" aria-label="视图切换">
          <n-button
            :type="viewMode === 'list' ? 'primary' : 'default'"
            @click="viewMode = 'list'"
          >
            列表
          </n-button>
          <n-button
            :type="viewMode === 'grid' ? 'primary' : 'default'"
            @click="viewMode = 'grid'"
          >
            网格
          </n-button>
        </n-button-group>
        <n-input
          ref="searchBoxRef"
          v-model:value="searchInput"
          name="document-search"
          clearable
          placeholder="搜索标题或正文…（/ 聚焦）"
          aria-label="搜索文档"
          class="search-box"
        />
        <n-dropdown :options="createMenuOptions" @select="handleCreateMenu">
          <n-button type="primary" :loading="creating">新建 ▾</n-button>
        </n-dropdown>
        <n-button :loading="importing" @click="openImportPicker">导入</n-button>
      </n-space>
      <input
        ref="fileInputRef"
        type="file"
        accept=".md,.markdown,.docx,.xlsx"
        style="display: none"
        aria-label="选择要导入的文件"
        @change="handleImportFile"
      />
    </div>

    <!-- P1-5：初始加载骨架屏 -->
    <div v-if="documents.loading && documents.list.length === 0" class="skeleton-list">
      <n-skeleton v-for="i in 3" :key="i" height="64px" :sharp="false" style="margin-bottom: 12px" />
    </div>

    <template v-else>
      <n-empty
        v-if="documents.list.length === 0"
        :description="documents.searching ? `没有找到与「${documents.activeQuery}」相关的文档` : '创建你的第一篇文档，开始写作'"
        style="margin-top: 64px"
      >
        <n-space v-if="!documents.searching">
          <n-button type="primary" :loading="creating" @click="handleCreate('md')">
            创建 MD 文档
          </n-button>
          <n-button type="success" :loading="creating" @click="handleCreate('excel')">
            创建 Excel 表格
          </n-button>
        </n-space>
      </n-empty>
      <!-- 网格视图 -->
      <div v-else-if="viewMode === 'grid'" class="doc-grid">
        <n-card v-for="doc in sortedList" :key="doc.id" size="small" class="doc-grid-card">
          <div class="grid-card-body" @click="openDoc(doc)">
            <div class="grid-card-title">
              <n-tag
                size="tiny"
                round
                :type="doc.type === 'excel' ? 'success' : 'default'"
                style="margin-right: 6px; vertical-align: middle"
              >
                {{ doc.type === 'excel' ? 'Excel' : 'MD' }}
              </n-tag>{{ doc.title }}
            </div>
            <n-space size="small" align="center" style="margin-top: 8px">
              <n-tag v-if="doc.role === 'viewer'" size="tiny" type="warning" round>只读</n-tag>
              <n-tag v-else-if="doc.role === 'editor'" size="tiny" type="info" round>可编辑</n-tag>
              <span
                v-if="(doc.members?.length ?? 0) > 0"
                class="member-stack"
              >
                <n-avatar
                  v-for="person in memberAvatars(doc).slice(0, 3)"
                  :key="person.id ?? person.name"
                  round
                  :size="18"
                  :color="person.color"
                >
                  {{ person.name.slice(0, 1) }}
                </n-avatar>
              </span>
            </n-space>
            <n-text depth="3" style="font-size: 12px; display: block; margin-top: 8px">
              {{ doc.role && doc.role !== 'owner' ? `由 ${doc.owner?.name ?? '他人'} 共享 · ` : '' }}
              {{ formatTime(doc.updated_at) }}
            </n-text>
          </div>
          <template #footer>
            <n-space justify="space-between" align="center">
              <n-button size="tiny" type="primary" quaternary @click="openDoc(doc)">
                打开
              </n-button>
              <n-dropdown
                v-if="doc.role === 'owner'"
                :options="ownerMenuOptions(doc)"
                @select="(key: string) => handleOwnerMenu(key, doc)"
              >
                <n-button size="tiny" quaternary aria-label="更多操作">⋯</n-button>
              </n-dropdown>
            </n-space>
          </template>
        </n-card>
      </div>

      <n-list v-else bordered class="doc-list">
        <n-list-item v-for="doc in sortedList" :key="doc.id">
          <template #prefix>
            <!-- Excel 表格图标 -->
            <n-icon v-if="doc.type === 'excel'" size="24" color="#18a058">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="4" width="18" height="16" rx="1" />
                <path d="M3 9h18M3 14.5h18M9 4v16M15 4v16" />
              </svg>
            </n-icon>
            <!-- MD 文档图标 -->
            <n-icon v-else size="24" depth="3">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1.5">
                <path d="M6 2h9l5 5v15H6z" />
                <path d="M14 2v6h6" />
              </svg>
            </n-icon>
          </template>
          <n-thing>
            <template #header>
              <span class="title-row">
                <n-tag
                  size="tiny"
                  round
                  :type="doc.type === 'excel' ? 'success' : 'default'"
                >
                  {{ doc.type === 'excel' ? 'Excel' : 'MD' }}
                </n-tag>
                <span v-if="documents.searching" class="title-text">
                  <template v-for="(seg, index) in highlight(doc.title, documents.activeQuery)" :key="index">
                    <mark v-if="seg.hit" class="search-hit">{{ seg.text }}</mark>
                    <template v-else>{{ seg.text }}</template>
                  </template>
                </span>
                <span v-else class="title-text">{{ doc.title }}</span>
              </span>
            </template>
            <template #description>
              <n-space
                :size="6"
                align="center"
                style="margin-top: 4px"
                :wrap="true"
              >
                <n-tag
                  v-if="doc.role === 'viewer'"
                  size="tiny"
                  type="warning"
                  round
                >
                  只读
                </n-tag>
                <n-tag
                  v-else-if="doc.role === 'editor'"
                  size="tiny"
                  type="info"
                  round
                >
                  可编辑
                </n-tag>

                <!-- P1-8：成员头像叠堆（有共享成员时显示） -->
                <span
                  v-if="(doc.members?.length ?? 0) > 0"
                  class="member-stack"
                  :aria-label="`共享给 ${doc.members?.length} 人`"
                >
                  <n-avatar
                    v-for="person in memberAvatars(doc).slice(0, 4)"
                    :key="person.id ?? person.name"
                    round
                    :size="20"
                    :color="person.color"
                  >
                    {{ person.name.slice(0, 1) }}
                  </n-avatar>
                  <n-avatar
                    v-if="memberAvatars(doc).length > 4"
                    round
                    :size="20"
                    color="#909399"
                  >
                    +{{ memberAvatars(doc).length - 4 }}
                  </n-avatar>
                </span>

                <n-text depth="3" style="font-size: 12px">
                  {{ doc.role && doc.role !== 'owner' ? `由 ${doc.owner?.name ?? '他人'} 共享 · ` : '' }}
                  更新于 {{ formatTime(doc.updated_at) }}
                </n-text>
              </n-space>
            </template>
          </n-thing>
          <template #suffix>
            <n-space align="center">
              <n-button size="small" type="primary" quaternary @click="openDoc(doc)">
                打开
              </n-button>
              <!-- 桌面：平铺操作；移动：收进「⋯」 -->
              <n-space v-if="doc.role === 'owner' && !isMobile" size="small">
                <n-button size="small" quaternary @click="openShare(doc)">共享</n-button>
                <n-button size="small" @click="openRename(doc)">重命名</n-button>
                <n-popconfirm @positive-click="handleDelete(doc)">
                  <template #trigger>
                    <n-button size="small" type="error" quaternary>删除</n-button>
                  </template>
                  确定删除「{{ doc.title }}」吗？
                </n-popconfirm>
              </n-space>
              <n-dropdown
                v-else-if="doc.role === 'owner'"
                :options="ownerMenuOptions(doc)"
                @select="(key: string) => handleOwnerMenu(key, doc)"
              >
                <n-button size="small" quaternary aria-label="更多操作">⋯</n-button>
              </n-dropdown>
            </n-space>
          </template>
        </n-list-item>
      </n-list>
    </template>

    <n-modal
      v-model:show="renameDialogVisible"
      preset="dialog"
      title="重命名文档"
      positive-button-text="保存"
      negative-button-text="取消"
      :loading="renaming"
      @positive-click="handleRename"
    >
      <n-input v-model:value="renameTarget.title" placeholder="文档标题" @keyup.enter="handleRename" />
    </n-modal>

    <ShareModal v-model:show="shareVisible" :document-id="shareDocumentId" />
  </div>
</template>

<style scoped>
.list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 16px;
}
.header-actions {
  flex-wrap: wrap;
}
.search-box {
  width: min(260px, 100%);
}
.doc-list {
  border-radius: 8px;
}
.search-hit {
  background: rgba(255, 212, 0, 0.45);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}
.skeleton-list {
  margin-top: 8px;
}
.doc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}
.doc-grid-card {
  cursor: pointer;
  transition: box-shadow 0.15s ease;
}
.doc-grid-card:hover {
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.09);
}
.title-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.grid-card-title {
  font-weight: 600;
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}
.member-stack {
  display: inline-flex;
  align-items: center;
}
.member-stack :deep(.n-avatar + .n-avatar) {
  margin-left: -6px;
  border: 1.5px solid #fff;
}
.member-stack :deep(.n-avatar:not(:first-child)) {
  margin-left: -6px;
}
@media (max-width: 767px) {
  .search-box {
    width: 100%;
  }
  .list-header h2 {
    font-size: 17px;
  }
}
</style>
