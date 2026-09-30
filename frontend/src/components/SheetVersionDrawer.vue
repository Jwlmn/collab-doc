<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDialog, useMessage } from 'naive-ui'
import { api, getApiErrorMessage } from '../utils/request'
import { formatTime } from '../utils/format'
import { useIsMobile } from '../composables/useIsMobile'
import { gridToHtml } from '../io/sheet-model'
import type { SheetCell, SheetMeta } from '../io/sheet-model'
import {
  describeGridDiff,
  diffGrids,
  type GridDiff,
} from '../io/version-diff'
import type { DocumentVersion } from '../types'

/** Excel 文档的版本快照载荷 */
interface SheetSnapshot {
  grid: SheetCell[][]
  /** 尺寸与条件格式；旧快照没有此字段，恢复时保持现状 */
  meta?: SheetMeta
}

const props = defineProps<{
  show: boolean
  documentId: number
  readonly?: boolean
  /** 取当前网格快照（保存时调用） */
  capture: () => SheetSnapshot | null
  /** 恢复快照（写回协同模型）；meta 缺省时保持现有尺寸与条件格式 */
  restore: (grid: SheetCell[][], meta?: SheetMeta) => void
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
/** 预览弹窗页签：快照本身 vs 与当前网格的差异 */
const previewTab = ref<'snapshot' | 'diff'>('snapshot')
/** 对比结果惰性计算：切到「与当前对比」才跑 */
const previewDiff = ref<GridDiff | null>(null)
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
      content_html: gridToHtml(snapshot.grid),
    }
    const { data } = await api.post(`/documents/${props.documentId}/versions`, payload)
    // 后端可能复用既有版本，按 id 去重避免重复项
    if (!versions.value.some((item) => item.id === data.data.id)) {
      versions.value.unshift(data.data)
    }
    versionName.value = ''
    message.success('版本已保存')
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    saving.value = false
  }
}

async function openPreview(version: DocumentVersion): Promise<void> {
  previewingId.value = version.id
  try {
    const { data } = await api.get(`/documents/${props.documentId}/versions/${version.id}`)
    previewVersion.value = data.data
    previewTab.value = 'snapshot'
    previewDiff.value = null
    previewVisible.value = true
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    previewingId.value = null
  }
}

/**
 * 计算「恢复这个版本，网格会怎么变」：当前网格 → 快照网格。
 * 汇总文案给出行/格级改动数量。
 */
function computePreviewDiff(): void {
  const snapshot = previewVersion.value?.content_json as unknown as SheetSnapshot | undefined
  const current = props.capture()
  if (!snapshot || !Array.isArray(snapshot.grid) || !current) {
    previewDiff.value = null
    return
  }
  previewDiff.value = diffGrids(current.grid, snapshot.grid)
}

function handlePreviewTab(tab: 'snapshot' | 'diff'): void {
  previewTab.value = tab
  if (tab === 'diff' && previewDiff.value === null) computePreviewDiff()
}

/**
 * 恢复前把当前网格存成备份版本 —— 恢复错了还能再恢复回去。
 * 备份失败不阻断恢复（内容与最新版本相同时后端会去重）。
 */
async function backupBeforeRestore(): Promise<void> {
  const snapshot = props.capture()
  if (!snapshot) return
  try {
    await api.post(`/documents/${props.documentId}/versions`, {
      name: '恢复前自动保存',
      content_json: snapshot,
      content_html: gridToHtml(snapshot.grid),
    })
  } catch (error) {
    console.warn('[version] 恢复前备份失败', error)
  }
}

async function restoreVersion(version: DocumentVersion): Promise<void> {
  if (props.readonly) return
  restoringId.value = version.id
  try {
    const { data } = await api.get(`/documents/${props.documentId}/versions/${version.id}`)
    const snapshot: DocumentVersion = data.data
    const payload = snapshot.content_json as unknown as SheetSnapshot
    if (!payload || !Array.isArray(payload.grid)) {
      message.error('版本快照格式无效')
      return
    }
    await backupBeforeRestore()
    props.restore(payload.grid, payload.meta)
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
  if (props.readonly) return
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
  if (props.readonly) return
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
         name="version-name" id="version-name" />
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
                <n-space :size="6" align="center" :wrap="true">
                  <n-tag v-if="version.kind && version.kind !== 'manual'" size="tiny" round>
                    自动
                  </n-tag>
                  <n-text depth="3" style="font-size: 12px">
                    {{ version.user?.name ?? '未知用户' }} · {{ formatTime(version.created_at) }}
                  </n-text>
                </n-space>
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
                    <n-button
                      size="tiny"
                      type="error"
                      quaternary
                      :disabled="readonly"
                      :loading="deletingId === version.id"
                    >
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
        <n-tabs type="line" :value="previewTab" @update:value="handlePreviewTab">
          <n-tab-pane name="snapshot" tab="快照内容">
            <div class="preview-body" v-html="previewVersion?.content_html ?? ''" />
          </n-tab-pane>
          <n-tab-pane name="diff" tab="与当前对比">
            <div v-if="!previewDiff" class="preview-empty">当前内容不可用，无法对比</div>
            <div v-else class="preview-diff">
              <div class="diff-summary">{{ describeGridDiff(previewDiff) }}</div>
              <div class="diff-table-wrap">
                <table class="diff-table">
                  <tbody>
                    <tr
                      v-for="(row, rowIndex) in previewDiff.rows"
                      :key="rowIndex"
                      :class="`diff-row-${row.status}`"
                    >
                      <td
                        v-for="cellItem in row.cells"
                        :key="cellItem.col"
                        :class="cellItem.status !== 'same' ? `diff-cell-${cellItem.status}` : ''"
                        :title="cellItem.status === 'changed' ? `${cellItem.before} → ${cellItem.after}` : ''"
                      >
                        <!-- changed 展示前后对照；其余展示恢复后的取值 -->
                        <template v-if="cellItem.status === 'changed'">
                          <span class="diff-before">{{ cellItem.before }}</span>
                          <span class="diff-arrow">→</span>
                          <span class="diff-after">{{ cellItem.after }}</span>
                        </template>
                        <template v-else>{{ cellItem.text }}</template>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </n-tab-pane>
        </n-tabs>
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
.preview-body {
  color: var(--text-1);
}
.preview-body :deep(th),
.preview-body :deep(td) {
  border: 1px solid var(--border-strong);
  padding: 4px 8px;
  min-width: 64px;
}
.preview-body :deep(th) {
  background: var(--bg-muted);
}
.preview-empty {
  color: var(--text-3);
  text-align: center;
  padding: 32px 0;
}
.preview-diff {
  max-height: 55vh;
  overflow: auto;
}
.diff-summary {
  font-size: 13px;
  color: var(--text-2);
  margin-bottom: 8px;
}
.diff-table-wrap {
  overflow: auto;
}
.diff-table {
  border-collapse: collapse;
  font-size: 13px;
}
.diff-table :deep(td) {
  border: 1px solid var(--border-subtle);
  padding: 4px 8px;
  min-width: 64px;
}
.diff-cell-changed {
  background: var(--status-warn-bg);
  color: var(--status-warn-fg);
}
.diff-before {
  text-decoration: line-through;
  opacity: 0.65;
}
.diff-arrow {
  margin: 0 4px;
  opacity: 0.6;
}
.diff-after {
  font-weight: 600;
}
.diff-cell-added {
  background: var(--status-ok-bg);
  color: var(--status-ok-fg);
}
.diff-cell-removed {
  background: var(--status-err-bg);
  color: var(--status-err-fg);
  text-decoration: line-through;
}
.diff-row-added > td:first-child {
  box-shadow: inset 3px 0 0 var(--status-ok-fg);
}
.diff-row-removed > td:first-child {
  box-shadow: inset 3px 0 0 var(--status-err-fg);
}
</style>
