<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDialog, useMessage } from 'naive-ui'
import { api, getApiErrorMessage } from '../utils/request'
import { formatTime } from '../utils/format'
import type { DocumentMeta } from '../types'

type TrashDoc = DocumentMeta & { deleted_at?: string | null }

const message = useMessage()
const dialog = useDialog()
const router = useRouter()

const loading = ref(true)
const list = ref<TrashDoc[]>([])
const operatingId = ref<number | null>(null)

async function fetchTrash(): Promise<void> {
  loading.value = true
  try {
    const { data } = await api.get('/documents/trashed')
    list.value = data.data
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function handleRestore(doc: TrashDoc): Promise<void> {
  operatingId.value = doc.id
  try {
    await api.post(`/documents/${doc.id}/restore`)
    list.value = list.value.filter((item) => item.id !== doc.id)
    message.success(`已恢复「${doc.title}」`)
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    operatingId.value = null
  }
}

function handleForceDelete(doc: TrashDoc): void {
  dialog.warning({
    title: '彻底删除',
    content: `确定彻底删除「${doc.title}」吗？删除后将无法恢复。`,
    positiveText: '彻底删除',
    negativeText: '取消',
    positiveButtonProps: { type: 'error' },
    onPositiveClick: async () => {
      operatingId.value = doc.id
      try {
        await api.delete(`/documents/${doc.id}/force`)
        list.value = list.value.filter((item) => item.id !== doc.id)
        message.success('已彻底删除')
      } catch (error) {
        message.error(getApiErrorMessage(error))
      } finally {
        operatingId.value = null
      }
    },
  })
}

onMounted(() => {
  void fetchTrash()
})
</script>

<template>
  <div>
    <div class="trash-header">
      <n-space align="center">
        <n-button size="small" quaternary @click="router.push('/')">← 返回文档</n-button>
        <h2 style="margin: 0">回收站</h2>
      </n-space>
      <n-text depth="3" style="font-size: 13px">删除的文档会保留在这里，可随时恢复</n-text>
    </div>

    <template v-if="loading">
      <n-skeleton v-for="i in 3" :key="i" height="64px" :sharp="false" style="margin-bottom: 12px" />
    </template>

    <n-empty
      v-else-if="list.length === 0"
      description="回收站是空的"
      style="margin-top: 64px"
    />

    <n-list v-else bordered class="trash-list">
      <n-list-item v-for="doc in list" :key="doc.id">
        <template #prefix>
          <n-icon size="24" depth="3">
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
              <n-tag size="tiny" round :type="doc.type === 'excel' ? 'success' : 'default'">
                {{ doc.type === 'excel' ? 'Excel' : 'MD' }}
              </n-tag>
              <span class="title-text">{{ doc.title }}</span>
            </span>
          </template>
          <template #description>
            <n-text depth="3" style="font-size: 12px">
              删除于 {{ formatTime(doc.deleted_at) }}
            </n-text>
          </template>
        </n-thing>
        <template #suffix>
          <n-space align="center">
            <n-button
              size="small"
              type="primary"
              :loading="operatingId === doc.id"
              @click="handleRestore(doc)"
            >
              恢复
            </n-button>
            <n-button
              size="small"
              type="error"
              quaternary
              :disabled="operatingId === doc.id"
              @click="handleForceDelete(doc)"
            >
              彻底删除
            </n-button>
          </n-space>
        </template>
      </n-list-item>
    </n-list>
  </div>
</template>

<style scoped>
.trash-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}
.trash-list {
  border-radius: 8px;
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
</style>
