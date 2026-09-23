<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { api, getApiErrorMessage } from '../utils/request'
import { useIsMobile } from '../composables/useIsMobile'
import { useAuthStore } from '../stores/auth'
import { parseContent } from '../utils/mention'
import { formatTime } from '../utils/format'
import type { Comment, MentionUser } from '../types'

const props = defineProps<{
  show: boolean
  documentId: number
  /** 当前用户是否为文档所有者（可删除任意评论） */
  canManage: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  /** 抽屉打开并拉取评论后，通知父级未读已清零 */
  read: []
}>()

const auth = useAuthStore()
const isMobile = useIsMobile()
const listWrapRef = ref<HTMLElement | null>(null)
const message = useMessage()

const comments = ref<Comment[]>([])
const loading = ref(false)
const content = ref('')
const submitting = ref(false)
const deletingId = ref<number | null>(null)

const textareaRef = ref<HTMLTextAreaElement | null>(null)
const mentionQuery = ref<string | null>(null)
const mentionUsers = ref<MentionUser[]>([])
const mentionSearching = ref(false)

let mentionTimer: ReturnType<typeof setTimeout> | null = null

const mentionPopupVisible = computed(() => mentionQuery.value !== null)

watch(
  () => props.show,
  async (visible) => {
    if (visible) {
      await fetchComments()
      // 标记已读并通知父级清零徽标
      try {
        await api.post(`/documents/${props.documentId}/comments/read`)
        emit('read')
      } catch {
        /* 标记失败不阻塞阅读 */
      }
      await nextTick()
      getTextarea()?.focus()
    }
  },
)

async function fetchComments(): Promise<void> {
  loading.value = true
  try {
    const { data } = await api.get(`/documents/${props.documentId}/comments`)
    comments.value = data.data
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    loading.value = false
  }
}

function canDelete(comment: Comment): boolean {
  return comment.user.id === auth.user?.id || props.canManage
}

/** 取 n-input 组件内部的原生 textarea 元素 */
function getTextarea(): HTMLTextAreaElement | null {
  const ref = textareaRef.value as unknown
  if (!ref) return null
  if (ref instanceof HTMLTextAreaElement) return ref
  const root = (ref as { $el?: HTMLElement }).$el
  return root?.querySelector('textarea') ?? null
}

/** 输入监听：检测光标前的 @查询 并弹出用户列表 */
function handleInput(): void {
  const el = getTextarea()
  if (!el) return

  const caret = el.selectionStart ?? el.value.length
  const before = el.value.slice(0, caret)
  const match = before.match(/@([^\s@]{0,20})$/u)

  if (match) {
    mentionQuery.value = match[1]
    scheduleMentionSearch(match[1])
  } else {
    closeMentionPopup()
  }
}

function scheduleMentionSearch(query: string): void {
  if (mentionTimer) clearTimeout(mentionTimer)
  mentionTimer = setTimeout(async () => {
    mentionSearching.value = true
    try {
      const { data } = await api.get('/users/search', { params: { q: query } })
      // 查询期间用户可能继续输入，仅在仍处于同一查询时更新
      if (mentionQuery.value === query) {
        mentionUsers.value = data.data
      }
    } catch {
      mentionUsers.value = []
    } finally {
      mentionSearching.value = false
    }
  }, 150)
}

function closeMentionPopup(): void {
  mentionQuery.value = null
  mentionUsers.value = []
  mentionActiveIndex.value = 0
}

/** 弹层键盘导航：↑↓ 移动、Enter 选择、Esc 关闭（配合 role=listbox/option） */
const mentionActiveIndex = ref(0)

watch(mentionUsers, () => {
  mentionActiveIndex.value = 0
})

function handleMentionKeydown(event: KeyboardEvent): void {
  if (!mentionPopupVisible.value || mentionUsers.value.length === 0) return

  if (event.key === 'ArrowDown') {
    event.preventDefault()
    mentionActiveIndex.value = (mentionActiveIndex.value + 1) % mentionUsers.value.length
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    mentionActiveIndex.value =
      (mentionActiveIndex.value - 1 + mentionUsers.value.length) % mentionUsers.value.length
  } else if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
    const user = mentionUsers.value[mentionActiveIndex.value]
    if (user) {
      event.preventDefault()
      selectMention(user)
    }
  } else if (event.key === 'Escape') {
    event.preventDefault()
    closeMentionPopup()
  }
}

/** 失焦延迟关闭，给点击候选项留出时间 */
function handleBlur(): void {
  setTimeout(closeMentionPopup, 150)
}

function selectMention(user: MentionUser): void {
  const el = getTextarea()
  const full = content.value
  const caret = el?.selectionStart ?? full.length
  const before = full.slice(0, caret)
  const after = full.slice(caret)
  const replaced = before.replace(/@([^\s@]{0,20})$/u, `@[${user.name}](user:${user.id}) `)

  content.value = replaced + after
  closeMentionPopup()

  void nextTick(() => {
    el?.focus()
    const position = replaced.length
    el?.setSelectionRange(position, position)
  })
}

async function handleSubmit(): Promise<void> {
  const text = content.value.trim()
  if (!text) return

  submitting.value = true
  try {
    const { data } = await api.post(`/documents/${props.documentId}/comments`, {
      content: text,
    })
    comments.value.push(data.data)
    content.value = ''
    closeMentionPopup()
    await nextTick()
    if (listWrapRef.value) {
      listWrapRef.value.scrollTop = listWrapRef.value.scrollHeight
    }
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    submitting.value = false
  }
}

async function handleDelete(comment: Comment): Promise<void> {
  deletingId.value = comment.id
  try {
    await api.delete(`/documents/${props.documentId}/comments/${comment.id}`)
    comments.value = comments.value.filter((item) => item.id !== comment.id)
    message.success('评论已删除')
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    deletingId.value = null
  }
}

</script>

<template>
  <n-drawer :show="show" :width="isMobile ? '100%' : 420" placement="right" @update:show="emit('update:show', $event)">
    <n-drawer-content title="评论" closable>
      <div class="comment-body">
        <n-spin :show="loading">
          <div ref="listWrapRef" class="comment-list-wrap">
            <n-empty
              v-if="!loading && comments.length === 0"
              description="还没有评论，输入 @ 可提及协作者"
              style="margin-top: 48px"
            />
            <div v-else class="comment-list">
            <div v-for="comment in comments" :key="comment.id" class="comment-item">
              <div class="comment-meta">
                <n-avatar round :size="28" color="#4db6ac">
                  {{ (comment.user.name ?? '?').slice(0, 1) }}
                </n-avatar>
                <span class="comment-author">{{ comment.user.name ?? '未知用户' }}</span>
                <span class="comment-time">{{ formatTime(comment.created_at) }}</span>
                <n-popconfirm v-if="canDelete(comment)" @positive-click="handleDelete(comment)">
                  <template #trigger>
                    <n-button
                      text
                      type="error"
                      size="tiny"
                      :loading="deletingId === comment.id"
                    >
                      删除
                    </n-button>
                  </template>
                  确定删除该评论吗？
                </n-popconfirm>
              </div>
              <div class="comment-content">
                <template v-for="(segment, index) in parseContent(comment.content)" :key="index">
                  <span v-if="segment.type === 'text'">{{ segment.text }}</span>
                  <span v-else class="mention-tag">@{{ segment.name }}</span>
                </template>
              </div>
            </div>
            </div>
          </div>
        </n-spin>

        <div class="comment-input-wrap">
          <div
            v-if="mentionPopupVisible"
            id="mention-popup"
            class="mention-popup"
            role="listbox"
            aria-label="提及用户候选"
          >
            <div v-if="mentionSearching" class="mention-empty">搜索中…</div>
            <div v-else-if="mentionUsers.length === 0" class="mention-empty">无匹配用户</div>
            <div
              v-for="(user, index) in mentionUsers"
              :key="user.id"
              class="mention-item"
              :class="{ active: index === mentionActiveIndex }"
              role="option"
              :aria-selected="index === mentionActiveIndex"
              @mousedown.prevent="selectMention(user)"
              @mouseenter="mentionActiveIndex = index"
            >
              <n-avatar round :size="22" color="#7986cb">{{ user.name.slice(0, 1) }}</n-avatar>
              <span>{{ user.name }}</span>
            </div>
          </div>

          <n-input
            ref="textareaRef"
            v-model:value="content"
            type="textarea"
            :rows="3"
            placeholder="输入评论，@ 可提及用户"
            aria-label="评论内容"
            maxlength="2000"
            show-count
            @input="handleInput"
            @blur="handleBlur"
            @keydown="handleMentionKeydown"
            @keyup.enter.ctrl="handleSubmit"
            @keyup.enter.meta="handleSubmit"
          />
          <n-text depth="3" style="display: block; margin-top: 4px; font-size: 12px">
            Ctrl / ⌘ + Enter 发送
          </n-text>
          <n-button
            type="primary"
            block
            :loading="submitting"
            :disabled="!content.trim()"
            style="margin-top: 8px"
            @click="handleSubmit"
          >
            发送评论
          </n-button>
        </div>
      </div>
    </n-drawer-content>
  </n-drawer>
</template>

<style scoped>
.comment-body {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.comment-list-wrap {
  flex: 1;
  min-height: 0;
  max-height: 55vh;
  overflow-y: auto;
}
.comment-list {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.comment-item {
  padding: 12px;
  background: var(--bg-muted);
  border-radius: 8px;
}
.comment-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.comment-author {
  font-weight: 600;
  font-size: 14px;
}
.comment-time {
  flex: 1;
  font-size: 12px;
  color: #999;
}
.comment-content {
  font-size: 14px;
  line-height: 1.6;
  word-break: break-word;
  white-space: pre-wrap;
}
.mention-tag {
  color: #2080f0;
  background: rgba(32, 128, 240, 0.1);
  border-radius: 4px;
  padding: 0 4px;
  font-weight: 500;
}
.comment-input-wrap {
  position: relative;
  margin-top: 16px;
}
.mention-popup {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  right: 0;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
  max-height: 200px;
  overflow-y: auto;
  z-index: 10;
}
.mention-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 14px;
}
.mention-item:hover,
.mention-item.active {
  background: var(--bg-muted);
}
.mention-empty {
  padding: 10px 12px;
  font-size: 13px;
  color: #999;
}
</style>
