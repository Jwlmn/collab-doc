<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useMessage } from 'naive-ui'
import { useAuthStore } from '../stores/auth'
import { useNotificationsStore, type NotificationItem } from '../stores/notifications'
import { getApiErrorMessage } from '../utils/request'

const auth = useAuthStore()
const notifications = useNotificationsStore()
const router = useRouter()
const message = useMessage()

const show = ref(false)
const loading = ref(false)
let pollTimer: ReturnType<typeof setInterval> | null = null

const visible = computed(() => !!auth.user)

async function load(silent = true): Promise<void> {
  if (!auth.user) return
  if (!silent) loading.value = true
  try {
    await notifications.fetch()
  } catch {
    /* 轮询失败静默，打开面板时才提示 */
  } finally {
    loading.value = false
  }
}

async function openPanel(): Promise<void> {
  show.value = true
  try {
    await load(false)
  } catch (error) {
    message.error(getApiErrorMessage(error))
  }
}

/** 通知文案 */
function describe(item: NotificationItem): string {
  const actor = item.data.actor_name ?? '有人'
  const title = item.data.document_title || '未命名文档'
  if (item.data.kind === 'mention') {
    return `${actor} 在「${title}」中 @了你`
  }
  const role = item.data.role === 'editor' ? '可编辑' : '只读'
  return `${actor} 将「${title}」共享给你（${role}）`
}

/** 点击通知：标已读 + 跳转对应文档 */
async function handleClick(item: NotificationItem): Promise<void> {
  show.value = false
  if (!item.read_at) {
    try {
      await notifications.markRead(item.id)
    } catch (error) {
      message.error(getApiErrorMessage(error))
    }
  }
  const id = item.data.document_id
  if (!id) return
  await router.push(item.data.doc_type === 'excel' ? `/sheet/${id}` : `/doc/${id}`)
}

async function handleMarkAllRead(): Promise<void> {
  try {
    await notifications.markAllRead()
  } catch (error) {
    message.error(getApiErrorMessage(error))
  }
}

function formatTime(value?: string): string {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

onMounted(() => {
  void load()
  // 轻量轮询：60s 刷新未读
  pollTimer = setInterval(() => void load(), 60_000)
})

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer)
})
</script>

<template>
  <n-popover
    v-if="visible"
    v-model:show="show"
    trigger="click"
    placement="bottom-end"
    :width="340"
    @update:show="(v: boolean) => v && openPanel()"
  >
    <template #trigger>
      <n-button quaternary circle aria-label="通知">
        <template #icon>
          <n-badge
            :value="notifications.unread"
            :max="99"
            :show="notifications.unread > 0"
            :offset="[-4, 4]"
          >
            <n-icon size="20">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" stroke-width="1.5">
                <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.7 21a2 2 0 01-3.4 0" />
              </svg>
            </n-icon>
          </n-badge>
        </template>
      </n-button>
    </template>

    <div class="bell-panel">
      <div class="bell-header">
        <span class="bell-title">通知</span>
        <n-button
          v-if="notifications.unread > 0"
          size="tiny"
          text
          type="primary"
          @click="handleMarkAllRead"
        >
          全部已读
        </n-button>
      </div>

      <n-spin :show="loading" size="small">
        <n-empty
          v-if="!loading && notifications.items.length === 0"
          description="暂无通知"
          size="small"
          style="padding: 24px 0"
        />
        <div v-else class="bell-list">
          <button
            v-for="item in notifications.items"
            :key="item.id"
            type="button"
            class="bell-item"
            :class="{ unread: !item.read_at }"
            @click="handleClick(item)"
          >
            <span class="bell-dot" :class="{ on: !item.read_at }" />
            <span class="bell-body">
              <span class="bell-text">{{ describe(item) }}</span>
              <span class="bell-time">{{ formatTime(item.created_at) }}</span>
            </span>
          </button>
        </div>
      </n-spin>
    </div>
  </n-popover>
</template>

<style scoped>
.bell-panel {
  max-height: 380px;
  display: flex;
  flex-direction: column;
}
.bell-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(0, 0, 0, 0.08);
}
.bell-title {
  font-weight: 600;
  font-size: 14px;
}
.bell-list {
  overflow-y: auto;
  max-height: 300px;
}
.bell-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 10px 4px;
  border: none;
  background: none;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
  font: inherit;
}
.bell-item:hover {
  background: rgba(0, 0, 0, 0.04);
}
.bell-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 6px;
  flex-shrink: 0;
  background: transparent;
}
.bell-dot.on {
  background: #2080f0;
}
.bell-body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.bell-text {
  font-size: 13px;
  line-height: 1.45;
  word-break: break-word;
}
.bell-item.unread .bell-text {
  font-weight: 600;
}
.bell-time {
  font-size: 11px;
  color: rgba(0, 0, 0, 0.4);
}
</style>
