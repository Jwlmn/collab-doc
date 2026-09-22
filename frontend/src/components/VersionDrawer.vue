<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Editor } from '@tiptap/vue-3'
import type { JSONContent } from '@tiptap/core'
import { useMessage } from 'naive-ui'
import { api, getApiErrorMessage } from '../utils/request'
import { useIsMobile } from '../composables/useIsMobile'
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
  if (!props.editor) return
  saving.value = true
  try {
    const payload = {
      name: versionName.value.trim() || null,
      content_json: props.editor.getJSON(),
      content_html: props.editor.getHTML(),
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

async function openPreview(version: DocumentVersion): Promise<void> {
  previewingId.value = version.id
  try {
    const { data } = await api.get(
      `/documents/${props.documentId}/versions/${version.id}`,
    )
    previewVersion.value = data.data
    previewVisible.value = true
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    previewingId.value = null
  }
}

async function handleRestore(version: DocumentVersion): Promise<void> {
  if (!props.editor) return
  restoringId.value = version.id
  try {
    const { data } = await api.get(
      `/documents/${props.documentId}/versions/${version.id}`,
    )
    const snapshot: DocumentVersion = data.data
    props.editor.commands.setContent(snapshot.content_json as unknown as JSONContent)
    emit('update:show', false)
    message.success(`已恢复到「${snapshot.name ?? formatTime(snapshot.created_at)}」`)
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    restoringId.value = null
  }
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

function formatTime(value?: string): string {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
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
        />
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

      <n-modal v-model:show="previewVisible" preset="card" style="width: min(720px, 92vw)" :title="previewVersion?.name || '版本预览'">
        <div class="preview-body" v-html="previewVersion?.content_html ?? ''" />
        <template #footer>
          <n-space justify="end">
            <n-button @click="previewVisible = false">关闭</n-button>
            <n-button
              v-if="previewVersion"
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
  font-size: 15px;
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
</style>
