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
  /** 评论集合或解决状态变化，通知父级刷新角标 */
  changed: []
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

/* ---------------- 线程分组 / 解决 ---------------- */

/** 已解决线程默认折叠，开关控制是否显示 */
const showResolved = ref(false)
/** 正在回复的根评论（null = 发新评论，底部输入框共用） */
const replyingTo = ref<Comment | null>(null)

const roots = computed(() => comments.value.filter((comment) => !comment.parent_id))

const unresolvedCount = computed(() => roots.value.filter((root) => !root.resolved_at).length)
const resolvedCount = computed(() => roots.value.length - unresolvedCount.value)

const visibleRoots = computed(() =>
  showResolved.value ? roots.value : roots.value.filter((root) => !root.resolved_at),
)

function repliesOf(rootId: number): Comment[] {
  return comments.value.filter((comment) => comment.parent_id === rootId)
}

function startReply(root: Comment): void {
  replyingTo.value = root
  void nextTick(() => getTextarea()?.focus())
}

function cancelReply(): void {
  replyingTo.value = null
}

async function handleResolve(root: Comment): Promise<void> {
  const nextResolved = !root.resolved_at
  try {
    const { data } = await api.post(
      `/documents/${props.documentId}/comments/${root.id}/resolve`,
      { resolved: nextResolved },
    )
    root.resolved_at = data.data.resolved_at
    message.success(nextResolved ? '线程已标记解决' : '线程已重新打开')
    emit('changed')
  } catch (error) {
    message.error(getApiErrorMessage(error))
  }
}

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
    } else {
      // 关抽屉丢弃回复上下文，下次打开是全新评论
      replyingTo.value = null
      closeMentionPopup()
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
      ...(replyingTo.value ? { parent_id: replyingTo.value.id } : {}),
    })
    comments.value.push(data.data)
    content.value = ''
    replyingTo.value = null
    closeMentionPopup()
    // 自己刚发的评论不该算未读：推进已读水位后再让父级重算角标
    try {
      await api.post(`/documents/${props.documentId}/comments/read`)
    } catch {
      /* 水位推进失败不阻塞发送 */
    }
    emit('changed')
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
    // 删根评论时回复随服务端 FK 级联消失，本地同步清掉
    comments.value = comments.value.filter(
      (item) => item.id !== comment.id && item.parent_id !== comment.id,
    )
    if (replyingTo.value?.id === comment.id) replyingTo.value = null
    message.success('评论已删除')
    emit('changed')
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
        <!-- n-spin 必须包在 list-wrap 内部：它是 comment-body 的直接子元素时
             会占据唯一的 flex 位，导致 list-wrap 的 flex:1 落在非 flex 容器里失效，
             列表被压成一行、输入区下方留出大片空白 -->
        <div ref="listWrapRef" class="comment-list-wrap">
          <n-spin :show="loading" class="list-spin">
            <n-empty
              v-if="!loading && comments.length === 0"
              description="还没有评论，输入 @ 可提及协作者"
              style="margin-top: 48px"
            />
            <!-- 有评论但当前视图为空（全被「隐藏已解决」滤掉）时仍保留控制行，
                 否则开关会跟着空态一起消失，用户再也打不开已解决线程 -->
            <div v-else class="comment-list">
              <!-- 控制行：未解决数 + 已解决线程开关 -->
              <div v-if="roots.length > 0" class="list-controls">
                <n-text depth="3" class="controls-count">{{ unresolvedCount }} 条未解决</n-text>
                <label v-if="resolvedCount > 0" class="controls-toggle">
                  <n-switch
                    v-model:value="showResolved"
                    size="small"
                    aria-label="显示已解决线程"
                  />
                  显示已解决（{{ resolvedCount }}）
                </label>
              </div>

              <div
                v-if="visibleRoots.length === 0 && !loading"
                class="all-resolved-hint"
              >
                线程都已解决 🎉 打开上方开关可回看
              </div>

              <div
                v-for="root in visibleRoots"
                :key="root.id"
                class="comment-item"
                :class="{ resolved: !!root.resolved_at }"
              >
                <div class="comment-meta">
                  <n-avatar round :size="28" color="#4db6ac">
                    {{ (root.user.name ?? '?').slice(0, 1) }}
                  </n-avatar>
                  <span class="comment-author">{{ root.user.name ?? '未知用户' }}</span>
                  <span class="comment-time">{{ formatTime(root.created_at) }}</span>
                  <n-tag v-if="root.resolved_at" size="tiny" type="success" round>
                    ✓ 已解决
                  </n-tag>
                  <n-button text size="tiny" @click="handleResolve(root)">
                    {{ root.resolved_at ? '重新打开' : '解决' }}
                  </n-button>
                  <n-popconfirm v-if="canDelete(root)" @positive-click="handleDelete(root)">
                    <template #trigger>
                      <n-button text type="error" size="tiny" :loading="deletingId === root.id">
                        删除
                      </n-button>
                    </template>
                    确定删除该评论吗？回复会一并删除。
                  </n-popconfirm>
                </div>
                <div class="comment-content">
                  <template v-for="(segment, index) in parseContent(root.content)" :key="index">
                    <span v-if="segment.type === 'text'">{{ segment.text }}</span>
                    <span v-else class="mention-tag">@{{ segment.name }}</span>
                  </template>
                </div>

                <!-- 一层回复缩进挂在根下 -->
                <div v-if="repliesOf(root.id).length > 0" class="reply-list">
                  <div v-for="reply in repliesOf(root.id)" :key="reply.id" class="comment-reply">
                    <div class="comment-meta">
                      <n-avatar round :size="20" color="#7986cb">
                        {{ (reply.user.name ?? '?').slice(0, 1) }}
                      </n-avatar>
                      <span class="comment-author">{{ reply.user.name ?? '未知用户' }}</span>
                      <span class="comment-time">{{ formatTime(reply.created_at) }}</span>
                      <n-popconfirm v-if="canDelete(reply)" @positive-click="handleDelete(reply)">
                        <template #trigger>
                          <n-button
                            text
                            type="error"
                            size="tiny"
                            :loading="deletingId === reply.id"
                          >
                            删除
                          </n-button>
                        </template>
                        确定删除该回复吗？
                      </n-popconfirm>
                    </div>
                    <div class="comment-content">
                      <template v-for="(segment, index) in parseContent(reply.content)" :key="index">
                        <span v-if="segment.type === 'text'">{{ segment.text }}</span>
                        <span v-else class="mention-tag">@{{ segment.name }}</span>
                      </template>
                    </div>
                  </div>
                </div>

                <div class="thread-actions">
                  <n-button text size="tiny" @click="startReply(root)">回复</n-button>
                </div>
              </div>
            </div>
          </n-spin>
        </div>

        <div class="comment-input-wrap">
          <!-- 回复上下文横幅 -->
          <div v-if="replyingTo" class="reply-banner">
            <n-text depth="2" class="reply-banner-text">
              正在回复 <strong>{{ replyingTo.user.name ?? '未知用户' }}</strong>
            </n-text>
            <n-button text size="tiny" @click="cancelReply">取消</n-button>
          </div>
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
           name="comment-content" id="comment-content" />
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
            {{ replyingTo ? '发送回复' : '发送评论' }}
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
/* 吃掉除输入区外的全部高度，超出部分自身滚动 */
.comment-list-wrap {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
/* loading 遮罩要盖满整个滚动区，而不是只盖内容 */
.list-spin {
  min-height: 100%;
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
.comment-item.resolved {
  /* 已解决线程（开关打开时）弱化呈现 */
  opacity: 0.72;
}
/* 控制行：未解决数靠左，显示已解决开关靠右 */
.list-controls {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
}
.controls-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--text-2);
}
/* 回复缩进：左侧竖线区分线程层级 */
.reply-list {
  margin-top: 10px;
  padding-left: 12px;
  border-left: 2px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.comment-reply {
  padding: 8px 10px;
  background: var(--bg-surface);
  border-radius: 6px;
}
.comment-reply .comment-author {
  font-size: 13px;
}
.thread-actions {
  margin-top: 8px;
}
/* 回复上下文横幅 */
.reply-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  padding: 6px 10px;
  background: var(--bg-muted);
  border-radius: 6px;
  font-size: 13px;
}
.reply-banner-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.all-resolved-hint {
  padding: 24px 0;
  text-align: center;
  font-size: 13px;
  color: var(--text-3);
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
  color: var(--text-3);
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
/* 吸底的输入栏：不参与收缩，与滚动区之间用边框分隔 */
.comment-input-wrap {
  position: relative;
  flex: none;
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid var(--border-subtle);
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
  color: var(--text-3);
}
</style>
