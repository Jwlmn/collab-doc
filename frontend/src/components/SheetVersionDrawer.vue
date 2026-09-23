<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDialog, useMessage } from 'naive-ui'
import { api, getApiErrorMessage } from '../utils/request'
import { formatTime } from '../utils/format'
import { useIsMobile } from '../composables/useIsMobile'
import type { SheetCell } from '../io/sheet-model'
import type { DocumentVersion } from '../types'

/** Excel 文档的版本快照载荷 */
interface SheetSnapshot {
  grid: SheetCell[][]
}

const props = defineProps<{
  show: boolean
  documentId: number
  readonly?: boolean
  /** 取当前网格快照（保存时调用） */
  capture: () => SheetSnapshot | null
  /** 恢复快照（写回协同模型） */
  restore: (grid: SheetCell[][]) => void
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const message = useMessage()
const dialog = useDialog()
const isMobile = useIsMobile()

const versions = ref<DocumentVersion[]>([])
const loading = ref(false)
const saving = ref(false)
const versionName = ref('')

const previewVisible = ref(false)
const previewVersion = ref<DocumentVersion | null>(null)
const restoringId = ref<number | null>(null)
const deletingId = ref<number | null>(null)
const previewingId = ref<number | null>(null)

const hasContent = computed(() => versions.value.length > 0)

watch(
  () => props.show,
  async (visible) => {
    if (visible) await fetchVersions()
  },
)

async function fetchVersions(): Promise<void> {
  loading.value = true
  try {
    const { data } = await api.get(`/documents/${props.documentId}/versions`)
    versions.value = data.data
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function handleSave(): Promise<void> {
  const snapshot = props.capture()
  if (!snapshot) return
  saving.value = true
  try {
    const payload = {
      name: versionName.value.trim() || null,
      content_json: snapshot,
      content_html: snapshotToHtml(snapshot),
    }
    const { data } = await api.post(`/documents/${props.documentId}/versions`, payload)
    versions.value.unshift(data.data)
    versionName.value = ''
    message.success('版本已保存')
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    saving.value = false
  }
}

function snapshotToHtml(snapshot: SheetSnapshot): string {
  // 复用简单渲染（避免循环依赖，独立小实现）
  const grid = snapshot.grid ?? []
  if (grid.length === 0) return '<p>（空表格）</p>'
  const rows = grid
    .map((line, ri) => {
      const cells = line
        .map((cell) => {
          const esc = (cell.v ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
          const tag = ri === 0 ? 'th' : 'td'
          return `<${tag}>${esc}</${tag}>`
        })
        .join('')
      return `<tr>${cells}</tr>`
    })
    .join('')
  return `<table border="1" cellspacing="0" cellpadding="4">${rows}</table>`
}

async function openPreview(version: DocumentVersion): Promise<void> {
  previewingId.value = version.id
  try {
    const { data } = await api.get(`/documents/${props.documentId}/versions/${version.id}`)
    previewVersion.value = data.data
    previewVisible.value = true
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    previewingId.value = null
  }
}

async function restoreVersion(version: DocumentVersion): Promise<void> {
  restoringId.value = version.id
  try {
    const { data } = await api.get(`/documents/${props.documentId}/versions/${version.id}`)
    const snapshot: DocumentVersion = data.data
    const payload = snapshot.content_json as unknown as SheetSnapshot
    if (!payload || !Array.isArray(payload.grid)) {
      message.error('版本快照格式无效')
      return
    }
    props.restore(payload.grid)
    emit('update:show', false)
    message.success(`已恢复到「${snapshot.name ?? formatTime(snapshot.created_at)}」`)
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    restoringId.value = null
  }
}

/** 恢复会覆盖当前表格内容，须确认 */
function handleRestore(version: DocumentVersion): void {
  dialog.warning({
    title: '恢复版本',
    content: '恢复后当前表格内容将被该快照覆盖，确定恢复吗？',
    positiveText: '恢复',
    negativeText: '取消',
    positiveButtonProps: { type: 'warning' },
    onPositiveClick: () => restoreVersion(version),
  })
}

async function handleDelete(version: DocumentVersion): Promise<void> {
  deletingId.value = version.id
  try {
    await api.delete(`/documents/${props.documentId}/versions/${version.id}`)
    versions.value = versions.value.filter((item) => item.id !== version.id)
    message.success('版本已删除')
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    deletingId.value = null
  }
}

</script>

<template>
  <n-drawer :show="show" :width="isMobile ? '100%' : 420" placement="right" @update:show="emit('update:show', $event)">
    <n-drawer-content title="版本历史" closable>
      <div class="save-box">
        <n-input
          v-model:value="versionName"
          placeholder="版本名称（可选，如：月初快照）"
          maxlength="200"
          @keyup.enter="handleSave"
        />
        <n-button
          type="primary"
          block
          :loading="saving"
          :disabled="readonly"
          style="margin-top: 8px"
          @click="handleSave"
        >
          {{ readonly ? '只读模式无法保存版本' : '保存当前表格' }}
        </n-button>
      </div>

      <n-spin :show="loading">
        <n-empty
          v-if="!loading && !hasContent"
          description="暂无版本，保存后可随时恢复"
          style="margin-top: 48px"
        />
        <n-list v-else-if="versions.length > 0" class="version-list">
          <n-list-item v-for="version in versions" :key="version.id">
            <n-thing :title="version.name || '未命名版本'">
              <template #description>
                <n-text depth="3" style="font-size: 12px">
                  {{ version.user?.name ?? '未知用户' }} · {{ formatTime(version.created_at) }}
                </n-text>
              </template>
            </n-thing>
            <template #suffix>
              <n-space justify="end" size="small">
                <n-button
                  size="tiny"
                  quaternary
                  :loading="previewingId === version.id"
                  @click="openPreview(version)"
                >
                  预览
                </n-button>
                <n-button
                  size="tiny"
                  type="primary"
                  quaternary
                  :loading="restoringId === version.id"
                  :disabled="readonly"
                  @click="handleRestore(version)"
                >
                  恢复
                </n-button>
                <n-popconfirm @positive-click="handleDelete(version)">
                  <template #trigger>
                    <n-button size="tiny" type="error" quaternary :loading="deletingId === version.id">
                      删除
                    </n-button>
                  </template>
                  确定删除该版本吗？
                </n-popconfirm>
              </n-space>
            </template>
          </n-list-item>
        </n-list>
      </n-spin>

      <n-modal
        v-model:show="previewVisible"
        preset="card"
        style="width: min(720px, 92vw)"
        :title="previewVersion?.name || '版本预览'"
      >
        <div class="preview-body" v-html="previewVersion?.content_html ?? ''" />
        <template #footer>
          <n-space justify="end">
            <n-button @click="previewVisible = false">关闭</n-button>
            <n-button
              v-if="previewVersion && !readonly"
              type="primary"
              :loading="restoringId === previewVersion.id"
              @click="handleRestore(previewVersion); previewVisible = false"
            >
              恢复此版本
            </n-button>
          </n-space>
        </template>
      </n-modal>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.save-box {
  margin-bottom: 16px;
}
.version-list {
  border-radius: 8px;
}
.preview-body {
  min-height: 120px;
  font-size: 14px;
  overflow: auto;
}
.preview-body :deep(table) {
  border-collapse: collapse;
}
.preview-body :deep(th),
.preview-body :deep(td) {
  border: 1px solid #ccc;
  padding: 4px 8px;
  min-width: 64px;
}
.preview-body :deep(th) {
  background: #f2f3f5;
}
</style>
