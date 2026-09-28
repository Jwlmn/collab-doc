<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { JSONContent } from '@tiptap/core'
import { useDialog, useMessage } from 'naive-ui'
import { api, getApiErrorMessage } from '../utils/request'
import { formatTime } from '../utils/format'
import { useIsMobile } from '../composables/useIsMobile'
import {
  diffLinesBetween,
  mdBlocksToLines,
  type DiffLine,
} from '../io/version-diff'
import type { DocumentVersion } from '../types'

const isMobile = useIsMobile()

const props = defineProps<{
  show: boolean
  documentId: number
  editor: Editor | null
  /** viewer 只读：禁止保存与恢复版本 */
  readonly?: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const message = useMessage()
const dialog = useDialog()

const versions = ref<DocumentVersion[]>([])
const loading = ref(false)
const saving = ref(false)
const versionName = ref('')

const previewVisible = ref(false)
const previewVersion = ref<DocumentVersion | null>(null)
/** 预览弹窗的两个页签：快照本身 vs 与当前内容的差异 */
const previewTab = ref<'snapshot' | 'diff'>('snapshot')
/** 对比结果惰性计算：只有切到「与当前对比」才跑 */
const previewDiff = ref<DiffLine[]>([])

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
  if (!props.editor) return
  saving.value = true
  try {
    const payload = {
      name: versionName.value.trim() || null,
      content_json: props.editor.getJSON(),
      content_html: props.editor.getHTML(),
    }
    const { data } = await api.post(`/documents/${props.documentId}/versions`, payload)
    // 后端可能复用既有版本（内容与名称都未变），按 id 去重避免列表出现重复项
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
    const { data } = await api.get(
      `/documents/${props.documentId}/versions/${version.id}`,
    )
    previewVersion.value = data.data
    previewTab.value = 'snapshot'
    previewDiff.value = []
    previewVisible.value = true
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    previewingId.value = null
  }
}

/**
 * 恢复前把当前内容存成一条备份版本 —— 万一恢复错了，还能再恢复回去。
 * 备份失败不阻断恢复（内容与最新版本相同时后端会去重，属正常情况）。
 */
async function backupBeforeRestore(): Promise<void> {
  const ed = props.editor
  if (!ed) return
  try {
    await api.post(`/documents/${props.documentId}/versions`, {
      name: '恢复前自动保存',
      content_json: ed.getJSON(),
      content_html: ed.getHTML(),
    })
  } catch (error) {
    console.warn('[version] 恢复前备份失败', error)
  }
}

async function restoreVersion(version: DocumentVersion): Promise<void> {
  if (!props.editor || props.readonly) return
  restoringId.value = version.id
  try {
    const { data } = await api.get(
      `/documents/${props.documentId}/versions/${version.id}`,
    )
    const snapshot: DocumentVersion = data.data
    await backupBeforeRestore()
    props.editor.commands.setContent(snapshot.content_json as unknown as JSONContent)
    emit('update:show', false)
    message.success(`已恢复到「${snapshot.name ?? formatTime(snapshot.created_at)}」`)
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    restoringId.value = null
  }
}

/**
 * 计算「恢复这个版本，内容会怎么变」：当前编辑器内容 → 快照内容。
 * 红色 = 恢复后会消失；绿色 = 恢复后会出现。
 */
function computePreviewDiff(): void {
  const snapshot = previewVersion.value
  const ed = props.editor
  if (!snapshot?.content_json || !ed) {
    previewDiff.value = []
    return
  }
  previewDiff.value = diffLinesBetween(
    mdBlocksToLines(ed.getJSON()),
    mdBlocksToLines(snapshot.content_json),
  )
}

function handlePreviewTab(tab: 'snapshot' | 'diff'): void {
  previewTab.value = tab
  if (tab === 'diff' && previewDiff.value.length === 0) computePreviewDiff()
}

/** 恢复会覆盖当前内容，须确认 */
function handleRestore(version: DocumentVersion): void {
  if (!props.editor || props.readonly) return
  dialog.warning({
    title: '恢复版本',
    content: '恢复后当前未保存到版本的内容将被该快照覆盖，确定恢复吗？',
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
          placeholder="版本名称（可选，如：初稿）"
          maxlength="200"
          @keyup.enter="handleSave"
         name="version-name" id="version-name" />
        <n-button
          type="primary"
          block
          :loading="saving"
          :disabled="!editor || readonly"
          style="margin-top: 8px"
          @click="handleSave"
        >
          {{ readonly ? '只读模式无法保存版本' : '保存当前版本' }}
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
                  :disabled="readonly"
                  :loading="restoringId === version.id"
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

      <n-modal v-model:show="previewVisible" preset="card" style="width: min(720px, 92vw)" :title="previewVersion?.name || '版本预览'">
        <n-tabs v-if="editor" type="line" :value="previewTab" @update:value="handlePreviewTab">
          <n-tab-pane name="snapshot" tab="快照内容">
            <div class="preview-body" v-html="previewVersion?.content_html ?? ''" />
          </n-tab-pane>
          <n-tab-pane name="diff" tab="与当前对比">
            <div v-if="previewDiff.length === 0" class="preview-empty">无差异</div>
            <div v-else class="preview-diff">
              <div
                v-for="(line, index) in previewDiff"
                :key="index"
                class="diff-line"
                :class="`diff-${line.kind}`"
              >
                <span class="diff-mark">{{ line.kind === 'added' ? '+' : line.kind === 'removed' ? '−' : ' ' }}</span>
                <span class="diff-text">{{ line.text }}</span>
              </div>
            </div>
          </n-tab-pane>
        </n-tabs>
        <div v-else class="preview-body" v-html="previewVersion?.content_html ?? ''" />
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
  min-height: 200px;
  font-size: 16px;
  line-height: 1.75;
}
.preview-body :deep(h1) {
  font-size: 1.75em;
}
.preview-body :deep(h2) {
  font-size: 1.4em;
}
.preview-body :deep(h3) {
  font-size: 1.2em;
}
.preview-body :deep(p) {
  margin: 0.4em 0;
}
.preview-body :deep(ul),
.preview-body :deep(ol) {
  padding-left: 1.5em;
}
.preview-body :deep(blockquote) {
  border-left: 3px solid #d0d3d9;
  padding-left: 1em;
  color: #666;
}
.preview-body :deep(pre) {
  background: #f4f5f7;
  border-radius: 6px;
  padding: 12px 16px;
  overflow-x: auto;
}
.preview-body :deep(code) {
  background: #f4f5f7;
  border-radius: 3px;
  padding: 2px 5px;
}
.preview-empty {
  color: #909399;
  text-align: center;
  padding: 32px 0;
}
.preview-diff {
  max-height: 55vh;
  overflow-y: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 13px;
  line-height: 1.7;
  border: 1px solid #e5e6eb;
  border-radius: 6px;
}
.diff-line {
  display: flex;
  gap: 8px;
  padding: 1px 10px;
  white-space: pre-wrap;
  word-break: break-word;
}
.diff-mark {
  width: 12px;
  flex: none;
  text-align: center;
  opacity: 0.75;
}
.diff-added {
  background: #e8f7ee;
  color: #1a7f37;
}
.diff-removed {
  background: #fdeceb;
  color: #b42318;
}
.diff-equal {
  color: #4e5969;
}
</style>
