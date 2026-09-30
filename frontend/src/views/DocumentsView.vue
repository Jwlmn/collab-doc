<script setup lang="ts">
import { computed, h, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, useDialog, useMessage, useNotification, type DropdownOption } from 'naive-ui'
import { useDocumentsStore } from '../stores/documents'
import { useFoldersStore } from '../stores/folders'
import { api, getApiErrorMessage } from '../utils/request'
import ShareModal from '../components/ShareModal.vue'
import { highlight } from '../utils/highlight'
import { formatRelativeTime } from '../utils/format'
import { userColor as colorOf } from '../utils/color'
import { useIsMobile } from '../composables/useIsMobile'
import { useImportFlowStore } from '../stores/importFlow'
import { importFileToPayload, docTitleFromFilename } from '../io/importFile'
import { useI18n } from 'vue-i18n'
import { DOC_TEMPLATES, findTemplate, type DocTemplate } from '../io/templates'
import type { DocumentMeta, Folder } from '../types'

/** 按文档类型打开对应编辑器 */
function openDoc(doc: Pick<DocumentMeta, 'id' | 'type'>) {
  // 搜索态带 find，编辑器打开后跳到首个命中处
  const query = documents.searching && documents.activeQuery
    ? { find: documents.activeQuery }
    : {}
  return router.push({
    path: doc.type === 'excel' ? `/sheet/${doc.id}` : `/doc/${doc.id}`,
    query,
  })
}

const { t } = useI18n()

const documents = useDocumentsStore()
const folders = useFoldersStore()
const importFlow = useImportFlowStore()
const message = useMessage()
const notification = useNotification()
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
    message.success(t('documents.imported', { title, kind: payload.kind === 'excel' ? 'Excel' : 'MD' }))
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

const sortOptions = computed(() => [
  { label: t('documents.sortByUpdated'), value: 'updated' },
  { label: t('documents.sortByTitle'), value: 'title' },
])

const sortedList = computed(() => {
  const arr = [...documents.list]
  if (sortBy.value === 'title') {
    arr.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
  } else {
    arr.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
  }
  return arr
})

/** 文件夹筛选：0 = 全部（naive-ui 的 option value 不用 null，0 哨兵 + 真值判断兼容 clearable 的 null） */
const folderFilter = ref(0)

const folderOptions = computed(() => [
  { label: t('folders.filterAll'), value: 0 },
  ...folders.list.map((folder) => ({ label: folder.name, value: folder.id })),
])

function folderName(id: number | null | undefined): string {
  return id ? (folders.list.find((folder) => folder.id === id)?.name ?? '') : ''
}

/**
 * 列表分区渲染：置顶组在前（组内仍按当前排序），其余归「全部文档」。
 * 搜索态不分组（结果以命中为序），无置顶时保持原来的单列表。
 */
/**
 * 文件夹筛选：浏览态生效；搜索态忽略（筛选 select 同步 disabled）——
 * 搜索是全局平铺态，评论命中不带 folder 信息，只筛正文命中的那半会显得自相矛盾。
 */
const filteredByFolder = computed(() => {
  const arr = sortedList.value
  if (documents.searching || !folderFilter.value) return arr
  return arr.filter((doc) => doc.folder_id === folderFilter.value)
})

const displayGroups = computed(() => {
  const all = filteredByFolder.value
  if (documents.searching) return [{ key: 'all', title: '', docs: all }]
  const pinned = all.filter((doc) => doc.pinned)
  if (pinned.length === 0) return [{ key: 'all', title: '', docs: all }]
  const rest = all.filter((doc) => !doc.pinned)
  return [
    { key: 'pinned', title: t('documents.groupPinned'), docs: pinned },
    ...(rest.length > 0 ? [{ key: 'rest', title: t('documents.groupAll'), docs: rest }] : []),
  ]
})

const togglingPinId = ref<number | null>(null)

async function togglePin(doc: DocumentMeta) {
  if (togglingPinId.value !== null) return
  togglingPinId.value = doc.id
  try {
    const pinned = await documents.togglePin(doc)
    message.success(pinned ? t('documents.pinnedToast', { title: doc.title }) : t('documents.unpinnedToast', { title: doc.title }))
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    togglingPinId.value = null
  }
}

/** 移动文档的 in-flight 守卫（文档 id） */
const movingFolderId = ref<number | null>(null)

/** 把文档移入/移出文件夹（成功后刷新 folders 以更新 documents_count） */
async function handleMove(doc: DocumentMeta, folderId: number | null) {
  if (movingFolderId.value !== null) return
  movingFolderId.value = doc.id
  try {
    const result = await documents.setFolder(doc, folderId)
    await folders.fetch()
    message.success(
      result === null
        ? t('folders.unfiledToast', { title: doc.title })
        : t('folders.movedToast', { title: doc.title, folder: folderName(result) }),
    )
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    movingFolderId.value = null
  }
}

/** 文件夹管理弹窗状态 */
const manageVisible = ref(false)
const folderSaving = ref(false)
const newFolderName = ref('')
const editingFolderId = ref<number | null>(null)
const editingFolderName = ref('')

function openManage() {
  newFolderName.value = ''
  editingFolderId.value = null
  manageVisible.value = true
}

async function handleCreateFolder() {
  const name = newFolderName.value.trim()
  if (!name || folderSaving.value) return
  folderSaving.value = true
  try {
    const folder = await folders.create(name)
    newFolderName.value = ''
    message.success(t('folders.created', { name: folder.name }))
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    folderSaving.value = false
  }
}

function startRenameFolder(id: number) {
  editingFolderId.value = id
  editingFolderName.value = folders.list.find((folder) => folder.id === id)?.name ?? ''
}

async function handleRenameFolder() {
  const name = editingFolderName.value.trim()
  if (!name || editingFolderId.value === null) return
  try {
    await folders.rename(editingFolderId.value, name)
    editingFolderId.value = null
    message.success(t('folders.renamed', { name }))
  } catch (error) {
    message.error(getApiErrorMessage(error))
  }
}

function handleDeleteFolder(folder: Folder) {
  dialog.warning({
    title: t('folders.deleteTitle'),
    content: t('folders.deleteContent', { name: folder.name }),
    positiveText: t('common.delete'),
    negativeText: t('common.cancel'),
    positiveButtonProps: { type: 'error' },
    onPositiveClick: async () => {
      try {
        await folders.remove(folder.id)
        // 删除的是当前激活的筛选 → 重置为「全部」，否则列表会静默清空
        if (folderFilter.value === folder.id) folderFilter.value = 0
        message.success(t('folders.deleted', { name: folder.name }))
      } catch (error) {
        message.error(getApiErrorMessage(error))
      }
    },
  })
}

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
  void folders.fetch().catch((error) => message.error(getApiErrorMessage(error)))
  window.addEventListener('keydown', handleSearchShortcut)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleSearchShortcut)
})

const TEMPLATE_ICONS: Record<string, string> = {
  meeting: '🗒️',
  weekly: '📋',
  todo: '✅',
}

const createMenuOptions = computed(() => [
  { key: 'md', label: t('documents.createMd') },
  { key: 'excel', label: t('documents.createExcel') },
  { type: 'divider', key: 'd1' },
  // 模板 = 创建后经 importFlow 注入种子内容（与文件导入同一管线）
  ...DOC_TEMPLATES.map((template) => ({
    key: `tpl:${template.key}`,
    label: `${TEMPLATE_ICONS[template.key] ?? '📄'} ${t('documents.templateMenu', { title: t(`templates.${template.key}.title`) })}`,
  })),
])

/** 移动端头部收纳的「⋯」菜单（导入/回收站/管理文件夹） */
const moreMenuOptions = computed(() => [
  { key: 'import', label: t('documents.importMenu') },
  { key: 'folders', label: t('folders.manageMenu') },
  { key: 'trash', label: t('documents.trashMenu') },
])

function handleMoreMenu(key: string) {
  if (key === 'import') openImportPicker()
  else if (key === 'folders') openManage()
  else if (key === 'trash') void router.push('/trash')
}

async function handleCreate(type: 'md' | 'excel' = 'md', template?: DocTemplate) {
  creating.value = true
  try {
    const doc = await documents.create(template?.title(), type)
    // 模板种子：走 importFlow，编辑器协同首帧后一次性写入（与文件导入同管线）
    if (template) {
      importFlow.setPending({ kind: 'md', json: template.build() })
    }
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
  if (key === 'excel') {
    void handleCreate('excel')
    return
  }
  const template = key.startsWith('tpl:') ? findTemplate(key.slice(4)) : undefined
  void handleCreate('md', template)
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
    message.success(t('documents.renamed'))
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    renaming.value = false
  }
}

async function handleDelete(doc: DocumentMeta) {
  try {
    await documents.remove(doc.id)
    // 可撤销提示：直接调恢复接口（零后端改动）
    const notif = notification.success({
      content: t('documents.moveToTrash', { title: doc.title }),
      duration: 8000,
      action: () =>
        h(
          NButton,
          {
            size: 'tiny',
            type: 'primary',
            ghost: true,
            onClick: async () => {
              notif.destroy()
              try {
                await api.post(`/documents/${doc.id}/restore`)
                await documents.fetch()
                message.success(t('documents.restored', { title: doc.title }))
              } catch (error) {
                message.error(getApiErrorMessage(error))
              }
            },
          },
          { default: () => t('documents.undo') },
        ),
    })
  } catch (error) {
    message.error(getApiErrorMessage(error))
  }
}

/**
 * owner 行操作菜单：共享/重命名 + 移动到文件夹 + 管理 + 删除。
 * 桌面「移动」按钮与网格/移动端 ⋯ 共用同一份 options，只有一处构建逻辑。
 */
function ownerMenuOptions(_doc: DocumentMeta): DropdownOption[] {
  return [
    { key: 'share', label: t('documents.menuShare') },
    { key: 'rename', label: t('documents.menuRename') },
    { type: 'divider', key: 'd-folder' },
    { type: 'header', key: 'h-folder', label: t('folders.moveHeading') },
    { key: 'folder:none', label: t('folders.unfiled') },
    ...folders.list.map((folder) => ({ key: `folder:${folder.id}`, label: folder.name })),
    { type: 'divider', key: 'd-manage' },
    { key: 'folder:manage', label: t('folders.manageMenu') },
    { type: 'divider', key: 'd2' },
    { key: 'delete', label: t('documents.menuDelete'), props: { style: 'color: #d03050' } },
  ]
}

function handleOwnerMenu(key: string, doc: DocumentMeta) {
  if (key === 'folder:manage') {
    openManage()
    return
  }
  if (key.startsWith('folder:')) {
    void handleMove(doc, key === 'folder:none' ? null : Number(key.slice(7)))
    return
  }
  if (key === 'share') openShare(doc)
  else if (key === 'rename') openRename(doc)
  else if (key === 'delete') {
    dialog.warning({
      title: t('documents.deleteTitle'),
      content: t('documents.deleteContent', { title: doc.title }),
      positiveText: t('documents.deleteConfirm'),
      negativeText: t('common.cancel'),
      positiveButtonProps: { type: 'error' },
      onPositiveClick: () => handleDelete(doc),
    })
  }
}

/** 列表成员头像：所有者 + 成员按 id 去重 */
function memberAvatars(doc: DocumentMeta) {
  const people: Array<{ id: number | null; name: string; color: string }> = []
  const push = (id: number | null, name: string | null) => {
    if (!name || people.some((p) => p.id === id)) return
    people.push({ id, name, color: colorOf(name) })
  }
  push(doc.owner?.id ?? null, doc.owner?.name ?? null)
  for (const member of doc.members ?? []) push(member.id, member.name)
  return people
}

function formatTime(value?: string): string {
  return formatRelativeTime(value)
}

/**
 * 空态文案：搜索时要区分「全都没命中」与「正文没命中但评论命中」，
 * 否则会出现上面「没有找到」、下面却列出评论的自相矛盾。
 */
const emptyStateDescription = computed(() => {
  if (!documents.searching) return t('documents.emptyCreate')
  if (documents.commentHits.length > 0) {
    return t('documents.emptySearchBody', { query: documents.activeQuery })
  }
  return t('documents.emptySearchNone', { query: documents.activeQuery })
})
</script>

<template>
  <div>
    <div class="list-header">
      <h2>{{ documents.searching ? $t('documents.headingSearch') : $t('documents.headingDocs') }}</h2>
      <!-- 文件夹筛选：搜索态 disabled（该态忽略筛选，见 filteredByFolder 注释） -->
      <n-select
        v-model:value="folderFilter"
        :options="folderOptions"
        size="small"
        :disabled="documents.searching"
        :aria-label="$t('folders.filterAria')"
        name="folder-filter"
        id="folder-filter"
        class="ctl-folder"
      />
      <n-button
        size="small"
        quaternary
        :aria-label="$t('folders.manageAria')"
        class="ctl-folder-manage"
        @click="openManage()"
      >
        {{ $t('folders.manageBtn') }}
      </n-button>
      <n-select
        v-model:value="sortBy"
        :options="sortOptions"
        size="small"
        :aria-label="$t('documents.sortAria')"
        class="ctl-sort"
       name="sort-by" id="sort-by" />
      <n-button-group size="small" :aria-label="$t('documents.viewAria')" class="ctl-view">
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
        :placeholder="$t('documents.searchPlaceholder')"
        :aria-label="$t('documents.searchAria')"
        class="search-box"
      />
      <n-dropdown :options="createMenuOptions" @select="handleCreateMenu">
        <n-button type="primary" :loading="creating" class="ctl-create">{{ $t('documents.createBtn') }}</n-button>
      </n-dropdown>
      <!-- 桌面平铺；移动端收进「⋯」（与列表行操作的收纳策略一致） -->
      <template v-if="!isMobile">
        <n-button :loading="importing" class="ctl-import" @click="openImportPicker">{{ $t('documents.importBtn') }}</n-button>
        <n-button quaternary class="ctl-trash" @click="router.push('/trash')">{{ $t('documents.trashBtn') }}</n-button>
      </template>
      <n-dropdown v-else :options="moreMenuOptions" @select="handleMoreMenu">
        <n-button quaternary :aria-label="$t('documents.moreAria')" class="ctl-more">⋯</n-button>
      </n-dropdown>
      <input
        ref="fileInputRef"
        type="file"
        accept=".md,.markdown,.docx,.xlsx"
        style="display: none"
        :aria-label="$t('documents.importFileAria')"
        @change="handleImportFile"
      />
    </div>

    <!-- P1-5：初始加载骨架屏 -->
    <div v-if="documents.loading && documents.list.length === 0" class="skeleton-list">
      <n-skeleton v-for="i in 3" :key="i" height="64px" :sharp="false" style="margin-bottom: 12px" />
    </div>

    <template v-else>
      <!-- 文件夹筛选优先：命中为空就报「此文件夹还没有文档」（哪怕一篇文档都还没有） -->
      <n-empty
        v-if="!documents.searching && folderFilter !== 0 && filteredByFolder.length === 0"
        :description="$t('folders.filterEmpty')"
        style="margin-top: 64px"
      />
      <n-empty
        v-else-if="documents.list.length === 0"
        :description="emptyStateDescription"
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
      <!-- 网格视图（置顶 / 全部文档分区：组头占满整行） -->
      <div v-else-if="viewMode === 'grid'" class="doc-grid">
        <template v-for="group in displayGroups" :key="group.key">
          <div v-if="group.title" class="group-title grid-group-title">{{ group.title }}</div>
          <n-card v-for="doc in group.docs" :key="doc.id" size="small" class="doc-grid-card">
          <div
            class="grid-card-body"
            role="link"
            tabindex="0"
            :aria-label="t('documents.openDocAria', { title: doc.title })"
            @click="openDoc(doc)"
            @keydown.enter="openDoc(doc)"
          >
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
              <n-tag v-if="doc.role === 'viewer'" size="tiny" type="warning" round>{{ $t('documents.viewerTag') }}</n-tag>
              <n-tag v-else-if="doc.role === 'editor'" size="tiny" type="info" round>{{ $t('documents.editorTag') }}</n-tag>
              <n-tag v-if="folderName(doc.folder_id)" size="tiny" round>{{ folderName(doc.folder_id) }}</n-tag>
              <span
                v-if="(doc.members?.length ?? 0) > 0"
                class="member-stack"
                :aria-label="t('documents.sharedWithAria', { count: doc.members?.length })"
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
              {{ doc.role && doc.role !== 'owner' ? t('documents.sharedBy', { name: doc.owner?.name ?? $t('documents.unknownUser') }) : '' }}
              {{ formatTime(doc.updated_at) }}
            </n-text>
          </div>
          <template #footer>
            <n-space justify="space-between" align="center">
              <n-space align="center" size="small">
                <n-button
                  size="tiny"
                  quaternary
                  circle
                  :type="doc.pinned ? 'primary' : 'default'"
                  :aria-label="doc.pinned ? t('documents.unpinAria', { title: doc.title }) : t('documents.pinAria', { title: doc.title })"
                  :title="doc.pinned ? $t('documents.pinTitlePinned') : $t('documents.pinTitle')"
                  :disabled="togglingPinId !== null && togglingPinId !== doc.id"
                  @click="togglePin(doc)"
                >
                  <template #icon>
                    <n-icon size="14">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                        stroke="currentColor" stroke-width="1.5">
                        <path d="M12 17v5" />
                        <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                      </svg>
                    </n-icon>
                  </template>
                </n-button>
                <n-button size="tiny" type="primary" quaternary @click="openDoc(doc)">
                  打开
                </n-button>
              </n-space>
              <n-dropdown
                v-if="doc.role === 'owner'"
                :options="ownerMenuOptions(doc)"
                @select="(key: string) => handleOwnerMenu(key, doc)"
              >
                <n-button size="tiny" quaternary :aria-label="$t('documents.moreAria')">⋯</n-button>
              </n-dropdown>
            </n-space>
          </template>
        </n-card>
        </template>
      </div>

      <!-- 列表视图（每个分区一个 n-list） -->
      <template v-else>
        <div v-for="group in displayGroups" :key="group.key">
          <h3 v-if="group.title" class="group-title">{{ group.title }}</h3>
          <n-list bordered class="doc-list">
            <n-list-item v-for="doc in group.docs" :key="doc.id">
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
              <!-- 搜索态：正文命中片段（高亮复用标题的 highlight 工具，模板渲染非 v-html） -->
              <div v-if="documents.searching && doc.snippet" class="snippet">
                <template v-for="(seg, index) in highlight(doc.snippet, documents.activeQuery)" :key="index">
                  <mark v-if="seg.hit" class="search-hit">{{ seg.text }}</mark>
                  <template v-else>{{ seg.text }}</template>
                </template>
              </div>

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

                <!-- 文件夹徽标（folders 未加载完时名字为空，不渲染空标签） -->
                <n-tag v-if="folderName(doc.folder_id)" size="tiny" round>
                  {{ folderName(doc.folder_id) }}
                </n-tag>

                <!-- P1-8：成员头像叠堆（有共享成员时显示） -->
                <span
                  v-if="(doc.members?.length ?? 0) > 0"
                  class="member-stack"
                  :aria-label="t('documents.sharedWithAria', { count: doc.members?.length })"
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
                  {{ doc.role && doc.role !== 'owner' ? t('documents.sharedBy', { name: doc.owner?.name ?? $t('documents.unknownUser') }) : '' }}
                  更新于 {{ formatTime(doc.updated_at) }}
                </n-text>
              </n-space>
            </template>
          </n-thing>
          <template #suffix>
            <n-space align="center">
              <n-button
                size="small"
                quaternary
                circle
                :type="doc.pinned ? 'primary' : 'default'"
                :aria-label="doc.pinned ? t('documents.unpinAria', { title: doc.title }) : t('documents.pinAria', { title: doc.title })"
                :title="doc.pinned ? $t('documents.pinTitlePinned') : $t('documents.pinTitle')"
                :disabled="togglingPinId !== null && togglingPinId !== doc.id"
                @click="togglePin(doc)"
              >
                <template #icon>
                  <n-icon size="16">
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" stroke-width="1.5">
                      <path d="M12 17v5" />
                      <path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z" />
                    </svg>
                  </n-icon>
                </template>
              </n-button>
              <n-button size="small" type="primary" quaternary @click="openDoc(doc)">
                打开
              </n-button>
              <!-- 桌面：平铺操作；移动：收进「⋯」 -->
              <n-space v-if="doc.role === 'owner' && !isMobile" size="small">
                <n-dropdown
                  :options="ownerMenuOptions(doc)"
                  @select="(key: string) => handleOwnerMenu(key, doc)"
                >
                  <n-button size="small" quaternary>{{ $t('folders.moveBtn') }}</n-button>
                </n-dropdown>
                <n-button size="small" quaternary @click="openShare(doc)">{{ $t('documents.shareBtn') }}</n-button>
                <n-button size="small" @click="openRename(doc)">{{ $t('documents.renameBtn') }}</n-button>
                <n-popconfirm @positive-click="handleDelete(doc)">
                  <template #trigger>
                    <n-button size="small" type="error" quaternary>{{ $t('documents.deleteBtn') }}</n-button>
                  </template>
                  确定删除「{{ doc.title }}」吗？将进入回收站。
                </n-popconfirm>
              </n-space>
              <n-dropdown
                v-else-if="doc.role === 'owner'"
                :options="ownerMenuOptions(doc)"
                @select="(key: string) => handleOwnerMenu(key, doc)"
              >
                <n-button size="small" quaternary :aria-label="$t('documents.moreAria')">⋯</n-button>
              </n-dropdown>
            </n-space>
          </template>
        </n-list-item>
          </n-list>
        </div>
      </template>
    </template>

    <!-- 评论命中：评论不在正文索引里，单独成组展示 -->
    <div v-if="documents.searching && documents.commentHits.length > 0" class="comment-hits">
      <n-divider title placement="left">{{ $t('documents.commentHits', { count: documents.commentHits.length }) }}</n-divider>
      <n-list bordered>
        <n-list-item v-for="hit in documents.commentHits" :key="hit.id">
          <n-thing :title="hit.document_title">
            <template #description>
              <div class="comment-snippet">
                <template v-for="(seg, index) in highlight(hit.snippet ?? hit.content, documents.activeQuery)" :key="index">
                  <mark v-if="seg.hit" class="search-hit">{{ seg.text }}</mark>
                  <template v-else>{{ seg.text }}</template>
                </template>
              </div>
              <n-text depth="3" style="font-size: 12px">
                {{ hit.user?.name ?? $t('documents.unknownUser') }} · {{ formatTime(hit.created_at) }}
              </n-text>
            </template>
          </n-thing>
          <template #suffix>
            <n-button
              size="small"
              quaternary
              @click="openDoc({ id: hit.document_id, type: hit.doc_type })"
            >
              打开
            </n-button>
          </template>
        </n-list-item>
      </n-list>
    </div>

    <n-modal
      v-model:show="renameDialogVisible"
      preset="dialog"
      :title="$t('documents.renameDialogTitle')"
      :positive-text="$t('common.save')"
      :negative-text="$t('common.cancel')"
      :loading="renaming"
      @positive-click="handleRename"
    >
      <n-input v-model:value="renameTarget.title" :placeholder="$t('documents.docTitlePlaceholder')" :aria-label="$t('documents.docTitlePlaceholder')" @keyup.enter="handleRename"  name="document-title" id="document-title" />
    </n-modal>

    <!-- 文件夹管理：CRUD 全内联（重命名/删除不走 popconfirm——移动端 ⋯ 菜单无宿主，与文档删除同用 dialog） -->
    <n-modal
      v-model:show="manageVisible"
      preset="dialog"
      :title="$t('folders.manageTitle')"
      :negative-text="$t('folders.closeBtn')"
      class="folder-manage-modal"
    >
      <div class="folder-create-row">
        <n-input
          v-model:value="newFolderName"
          size="small"
          :placeholder="$t('folders.createPlaceholder')"
          :aria-label="$t('folders.createPlaceholder')"
          name="new-folder-name"
          id="new-folder-name"
          @keyup.enter="handleCreateFolder"
        />
        <n-button
          size="small"
          type="primary"
          :loading="folderSaving"
          :disabled="!newFolderName.trim()"
          @click="handleCreateFolder"
        >
          {{ $t('folders.createBtn') }}
        </n-button>
      </div>

      <n-empty
        v-if="folders.list.length === 0"
        size="small"
        :description="$t('folders.empty')"
        style="margin-top: 16px"
      />
      <div v-else class="folder-manage-list">
        <div v-for="folder in folders.list" :key="folder.id" class="folder-manage-row">
          <template v-if="editingFolderId === folder.id">
            <n-input
              v-model:value="editingFolderName"
              size="small"
              :aria-label="$t('folders.renameBtn')"
              @keyup.enter="handleRenameFolder"
            />
            <n-button size="small" type="primary" @click="handleRenameFolder">
              {{ $t('common.save') }}
            </n-button>
            <n-button size="small" quaternary @click="editingFolderId = null">
              {{ $t('common.cancel') }}
            </n-button>
          </template>
          <template v-else>
            <span class="folder-manage-name">{{ folder.name }}</span>
            <n-tag size="tiny" round :bordered="false">
              {{ $t('folders.docCount', { count: folder.documents_count ?? 0 }) }}
            </n-tag>
            <n-button size="tiny" quaternary @click="startRenameFolder(folder.id)">
              {{ $t('folders.renameBtn') }}
            </n-button>
            <n-button size="tiny" quaternary type="error" @click="handleDeleteFolder(folder)">
              {{ $t('common.delete') }}
            </n-button>
          </template>
        </div>
      </div>
    </n-modal>

    <ShareModal v-model:show="shareVisible" :document-id="shareDocumentId" />
  </div>
</template>

<style scoped>
.list-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 12px;
  margin-bottom: 16px;
}
/* 标题占左侧余下空间，控件整体靠右（替代原 space-between 双容器结构） */
.list-header h2 {
  margin: 0;
  margin-right: auto;
}
.ctl-sort {
  width: 110px;
}
.ctl-folder {
  width: 130px;
}
/* 管理弹窗：新建行与列表行 */
.folder-create-row {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}
.folder-manage-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.folder-manage-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.folder-manage-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.search-box {
  width: min(260px, 100%);
}
.doc-list {
  border-radius: 8px;
}
.search-hit {
  background: var(--search-hit-bg);
  color: inherit;
  border-radius: 2px;
  padding: 0 1px;
}
/* 正文片段：截断显示，避免长段落撑破列表项 */
.snippet,
.comment-snippet {
  font-size: 13px;
  color: var(--text-2, #646a73);
  line-height: 1.6;
  margin-top: 4px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.comment-hits {
  margin-top: 24px;
}
.skeleton-list {
  margin-top: 8px;
}
.doc-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}
/* 分区组头：列表视图为小标题，网格视图作为跨满整行的网格项 */
.group-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-3);
  margin: 18px 0 10px;
}
.group-title.grid-group-title {
  grid-column: 1 / -1;
  margin: 4px 0 0;
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
  font-size: 16px;
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
  /* 移动端三行布局：①标题+新建 ②搜索全宽 ③排序+视图+⋯ */
  .ctl-create {
    order: 1;
  }
  .search-box {
    order: 2;
    flex: 1 0 100%;
    width: 100%;
  }
  .ctl-folder {
    order: 3;
    width: 120px;
  }
  .ctl-folder-manage {
    order: 4;
  }
  .ctl-sort {
    order: 5;
  }
  .ctl-view {
    order: 6;
  }
  .ctl-more {
    order: 7;
  }
  .list-header h2 {
    font-size: 16px;
  }
}
</style>
