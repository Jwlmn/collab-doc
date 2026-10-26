<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useDialog, useMessage } from 'naive-ui'
import { api, getApiErrorMessage } from '../utils/request'
import { formatTime } from '../utils/format'
import { useI18n } from 'vue-i18n'
import type { DocumentMeta } from '../types'

type TrashDoc = DocumentMeta & { deleted_at?: string | null }

const message = useMessage()
const dialog = useDialog()
const router = useRouter()
const { t } = useI18n()

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
    message.success(t('trash.restored', { title: doc.title }))
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    operatingId.value = null
  }
}

function handleForceDelete(doc: TrashDoc): void {
  dialog.warning({
    title: t('trash.purgeTitle'),
    content: t('trash.purgeContent', { title: doc.title }),
    positiveText: t('trash.purgeConfirm'),
    negativeText: t('common.cancel'),
    positiveButtonProps: { type: 'error' },
    onPositiveClick: async () => {
      operatingId.value = doc.id
      try {
        await api.delete(`/documents/${doc.id}/force`)
        list.value = list.value.filter((item) => item.id !== doc.id)
        message.success(t('trash.purged'))
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
      <div class="trash-heading">
        <div class="trash-title-row">
          <n-button size="small" quaternary class="back-btn" @click="router.push('/')">
            <template #icon>
              <n-icon size="16">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </n-icon>
            </template>
            {{ $t('trash.backToList') }}
          </n-button>
          <h2 class="trash-title">{{ $t('trash.heading') }}</h2>
        </div>
        <p v-if="!loading && list.length > 0" class="trash-count">
          {{ $t('trash.countHint', { count: list.length }) }}
        </p>
      </div>
      <n-text depth="3" class="trash-hint">{{ $t('trash.hint') }}</n-text>
    </div>

    <template v-if="loading">
      <n-skeleton v-for="i in 3" :key="i" height="64px" :sharp="false" style="margin-bottom: 12px" />
    </template>

    <n-empty v-else-if="list.length === 0" :description="$t('trash.empty')" class="trash-empty" />

    <n-list v-else bordered class="trash-list">
      <n-list-item v-for="doc in list" :key="doc.id" class="trash-row">
        <template #prefix>
          <span class="type-icon" :class="doc.type === 'excel' ? 'type-icon--excel' : 'type-icon--md'" aria-hidden="true">
            <svg v-if="doc.type === 'excel'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M3 9.5h18M3 14.5h18M9 4v16M15 4v16" />
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 3.5h7.2L18 7.3V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
              <path d="M14 3.5V7.5H18" />
              <path d="M9 12.5h6M9 16h4" />
            </svg>
          </span>
        </template>
        <n-thing>
          <template #header>
            <span class="title-row">
              <span class="title-text">{{ doc.title }}</span>
            </span>
          </template>
          <template #description>
            <n-text depth="3" class="deleted-at">
              {{ $t('trash.deletedAt', { time: formatTime(doc.deleted_at) }) }}
            </n-text>
          </template>
        </n-thing>
        <template #suffix>
          <n-space align="center" size="small" class="trash-actions">
            <n-button
              size="small"
              type="primary"
              :loading="operatingId === doc.id"
              @click="handleRestore(doc)"
            >
              {{ $t('trash.restore') }}
            </n-button>
            <n-button
              size="small"
              type="error"
              quaternary
              :disabled="operatingId === doc.id"
              @click="handleForceDelete(doc)"
            >
              {{ $t('trash.purge') }}
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
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 16px;
  margin-bottom: 16px;
}
.trash-heading {
  min-width: 0;
}
.trash-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}
.back-btn {
  padding-left: 8px;
  flex: none;
}
.trash-title {
  margin: 0;
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.trash-count {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-3);
}
.trash-hint {
  font-size: 13px;
}
.trash-empty {
  margin-top: 64px;
}
.trash-list {
  border-radius: var(--radius-md, 10px);
  overflow: hidden;
}
/* 与文档列表同一套类型图标：MD 蓝 / Excel 绿 */
.type-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: none;
  border-radius: 10px;
  color: var(--type-md);
  background: var(--type-md-bg);
}
.type-icon svg {
  width: 20px;
  height: 20px;
}
.type-icon--excel {
  color: var(--type-excel);
  background: var(--type-excel-bg);
}
.title-row {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.deleted-at {
  font-size: 12px;
}
.trash-row :deep(.n-list-item__main) {
  flex: 1 1 auto;
  min-width: 0;
}
.trash-row :deep(.n-list-item__suffix) {
  flex: 0 0 auto;
}
@media (max-width: 640px) {
  .trash-title {
    font-size: 20px;
  }
}
</style>
