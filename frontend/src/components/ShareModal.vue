<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { api, getApiErrorMessage } from '../utils/request'
import type { DocumentMember } from '../types'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const props = defineProps<{
  show: boolean
  documentId: number
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
}>()

const message = useMessage()

const members = ref<DocumentMember[]>([])
const loading = ref(false)
const adding = ref(false)
const changingId = ref<number | null>(null)
const removingId = ref<number | null>(null)

const inviteForm = reactive({ email: '', role: 'viewer' as 'viewer' | 'editor' })

/** 联想搜索：用户名/邮箱关键词 → 弹层选择填入（服务端已排除所有者与已有成员） */
interface InviteSuggestion {
  id: number
  name: string
  email: string
}
const suggestions = ref<InviteSuggestion[]>([])
const suggestOpen = ref(false)
const suggestActive = ref(0)
/** 已通过联想选中的邮箱：输入未变时不再弹层 */
const pickedEmail = ref('')
let suggestTimer: ReturnType<typeof setTimeout> | null = null

watch(() => inviteForm.email, (value) => {
  const q = value.trim()
  if (suggestTimer) clearTimeout(suggestTimer)
  if (!q || q === pickedEmail.value) {
    suggestions.value = []
    suggestOpen.value = false
    return
  }
  suggestTimer = setTimeout(async () => {
    try {
      const { data } = await api.get(`/documents/${props.documentId}/members/search`, {
        params: { q },
      })
      // 查询期间继续输入的旧结果丢弃：仅在关键词未变时更新
      if (inviteForm.email.trim() !== q) return
      suggestions.value = data.data
      suggestActive.value = 0
      suggestOpen.value = data.data.length > 0
    } catch {
      suggestions.value = []
      suggestOpen.value = false
    }
  }, 200)
})

function selectSuggestion(user: InviteSuggestion): void {
  inviteForm.email = user.email
  pickedEmail.value = user.email
  suggestions.value = []
  suggestOpen.value = false
}

function closeSuggest(): void {
  suggestOpen.value = false
}

/** 输入框键盘：弹层开着时 ↑↓/Enter/Esc 走选择，否则 Enter 提交添加 */
function handleInviteKeydown(event: KeyboardEvent): void {
  if (suggestOpen.value && suggestions.value.length > 0) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      suggestActive.value = (suggestActive.value + 1) % suggestions.value.length
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      suggestActive.value =
        (suggestActive.value - 1 + suggestions.value.length) % suggestions.value.length
      return
    }
    if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
      event.preventDefault()
      const user = suggestions.value[suggestActive.value]
      if (user) selectSuggestion(user)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      suggestOpen.value = false
      return
    }
  }
  if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
    event.preventDefault()
    void handleAdd()
  }
}

watch(
  () => props.show,
  async (visible) => {
    if (visible) {
      suggestOpen.value = false
      suggestions.value = []
      await fetchMembers()
    }
  },
)

async function fetchMembers(): Promise<void> {
  loading.value = true
  try {
    const { data } = await api.get(`/documents/${props.documentId}/members`)
    members.value = data.data
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    loading.value = false
  }
}

async function handleAdd(): Promise<void> {
  const email = inviteForm.email.trim()
  if (!email) return

  adding.value = true
  try {
    const { data } = await api.post(`/documents/${props.documentId}/members`, {
      email,
      role: inviteForm.role,
    })
    members.value.push(data.data)
    inviteForm.email = ''
    pickedEmail.value = ''
    suggestOpen.value = false
    message.success(t('share.addedMember', { name: data.data.user.name }))
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    adding.value = false
  }
}

async function handleRoleChange(member: DocumentMember, role: 'viewer' | 'editor'): Promise<void> {
  changingId.value = member.id
  try {
    const { data } = await api.put(
      `/documents/${props.documentId}/members/${member.id}`,
      { role },
    )
    member.role = data.data.role
    message.success(t('share.roleSet', { name: member.user.name, role: role === 'editor' ? t('documents.editorTag') : t('documents.viewerTag') }))
  } catch (error) {
    message.error(getApiErrorMessage(error))
    await fetchMembers()
  } finally {
    changingId.value = null
  }
}

async function handleRemove(member: DocumentMember): Promise<void> {
  removingId.value = member.id
  try {
    await api.delete(`/documents/${props.documentId}/members/${member.id}`)
    members.value = members.value.filter((item) => item.id !== member.id)
    message.success(t('share.removed', { name: member.user.name }))
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    removingId.value = null
  }
}

const copyingInvite = ref(false)
const linkFallback = ref('')
const linkFallbackVisible = ref(false)

/** P2-4：生成邀请链接并复制到剪贴板 */
/* ---------------- 公开只读分享链接 ---------------- */

const shareExpiry = ref<number | null>(null)   // null = 永不过期
const shareLink = ref('')                       // 已签发的完整 URL（会话内保留）
const shareExpiresAt = ref<string | null>(null)
const creatingShare = ref(false)
const revokingShare = ref(false)

const shareExpiryOptions = computed(() => [
  { label: t('share.expiryNever'), value: null as number | null },
  { label: t('share.expiryDays', { days: 1 }), value: 1 },
  { label: t('share.expiryDays', { days: 7 }), value: 7 },
  { label: t('share.expiryDays', { days: 30 }), value: 30 },
])

/** 生成（或按新有效期重新签发）公开只读链接 */
async function createShareLink(): Promise<void> {
  creatingShare.value = true
  try {
    const body: Record<string, unknown> = {}
    if (shareExpiry.value !== null) body.expires_in_days = shareExpiry.value

    const { data } = await api.post(`/documents/${props.documentId}/share-link`, body)
    shareLink.value = window.location.origin + data.data.path
    shareExpiresAt.value = data.data.expires_at ?? null
    await copyToClipboard(shareLink.value, t('share.shareCopied'))
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    creatingShare.value = false
  }
}

/** 撤销该文档全部公开链接 */
async function revokeShareLink(): Promise<void> {
  revokingShare.value = true
  try {
    await api.delete(`/documents/${props.documentId}/share-link`)
    shareLink.value = ''
    shareExpiresAt.value = null
    message.success(t('share.shareRevoked'))
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    revokingShare.value = false
  }
}

/** 剪贴板写入，失败降级为手动复制弹窗 */
async function copyToClipboard(url: string, successText: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(url)
    message.success(successText)
  } catch {
    message.warning(t('share.copyFail'))
    linkFallback.value = url
    linkFallbackVisible.value = true
  }
}

async function copyShareLink(): Promise<void> {
  if (!shareLink.value) return
  await copyToClipboard(shareLink.value, t('share.linkCopied'))
}

async function copyInviteLink(): Promise<void> {
  copyingInvite.value = true
  try {
    const { data } = await api.post(`/documents/${props.documentId}/invite-link`)
    const url = window.location.origin + data.data.path
    try {
      await copyToClipboard(url, t('share.inviteCopied'))
    } catch {
      /* copyToClipboard 内部已处理降级，这里只兜异常 */
    }
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    copyingInvite.value = false
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    style="width: min(520px, 92vw)"
    :title="$t('share.modalTitle')"
    @update:show="emit('update:show', $event)"
  >
    <div class="invite-row">
      <div class="invite-input-wrap">
        <n-input
          v-model:value="inviteForm.email"
          :placeholder="$t('share.inviteSearchPlaceholder')"
          :aria-label="$t('share.inviteSearchAria')"
          @keydown="handleInviteKeydown"
          @blur="closeSuggest"
         name="invite-query" id="invite-query" />
        <div
          v-if="suggestOpen && suggestions.length > 0"
          class="suggest-popup"
          role="listbox"
          :aria-label="$t('share.memberResultsAria')"
        >
          <div
            v-for="(user, index) in suggestions"
            :key="user.id"
            class="suggest-item"
            :class="{ active: index === suggestActive }"
            role="option"
            :aria-selected="index === suggestActive"
            @mousedown.prevent="selectSuggestion(user)"
            @mouseenter="suggestActive = index"
          >
            <span class="suggest-name">{{ user.name }}</span>
            <span class="suggest-email">{{ user.email }}</span>
          </div>
        </div>
      </div>
      <n-select
        v-model:value="inviteForm.role"
        :aria-label="$t('share.roleAria')"
        :options="[
          { label: t('documents.viewerTag'), value: 'viewer' },
          { label: t('documents.editorTag'), value: 'editor' },
        ]"
        style="width: 110px"
       name="invite-role" id="invite-role" />
      <n-button type="primary" :loading="adding" @click="handleAdd">{{ $t('share.addBtn') }}</n-button>
    </div>

    <n-button
      quaternary
      size="small"
      block
      :loading="copyingInvite"
      style="margin-bottom: 14px"
      @click="copyInviteLink"
    >
      {{ $t('share.inviteCopyBtn') }}
    </n-button>

    <div class="public-share">
      <n-divider title placement="left" style="margin: 8px 0 12px">{{ $t('share.publicDivider') }}</n-divider>
      <n-text depth="3" style="font-size: 12px; display: block; margin-bottom: 8px">
        {{ $t('share.publicHint') }}
      </n-text>

      <div class="public-share-row">
        <n-select
          v-model:value="shareExpiry"
          :options="shareExpiryOptions"
          size="small"
          :aria-label="$t('share.expiryAria')"
          style="width: 130px"
         name="share-expiry" id="share-expiry" />
        <n-button type="primary" size="small" :loading="creatingShare" @click="createShareLink">
          {{ shareLink ? $t('share.reissue') : $t('share.generate') }}
        </n-button>
      </div>

      <div v-if="shareLink" class="public-share-link">
        <n-input
          :value="shareLink"
          readonly
          size="small"
          :aria-label="$t('share.shareLinkAria')"
          @focus="($event.target as HTMLInputElement).select()"
         name="share-link" id="share-link" />
        <n-space size="small" style="margin-top: 8px">
          <n-button size="small" quaternary @click="copyShareLink">{{ $t('share.copyBtn') }}</n-button>
          <n-popconfirm @positive-click="revokeShareLink">
            <template #trigger>
              <n-button size="small" type="error" quaternary :loading="revokingShare">{{ $t('share.revokeBtn') }}</n-button>
            </template>
            {{ $t('share.revokeConfirm') }}
          </n-popconfirm>
        </n-space>
        <n-text v-if="shareExpiresAt" depth="3" style="font-size: 12px; display: block; margin-top: 6px">
          {{ $t('share.validUntil', { time: new Date(shareExpiresAt).toLocaleString() }) }}
        </n-text>
      </div>
    </div>

    <n-spin :show="loading">
      <n-empty
        v-if="!loading && members.length === 0"
        :description="$t('share.noMembers')"
        style="margin: 48px 0"
      />
      <n-list v-else class="member-list">
        <n-list-item v-for="member in members" :key="member.id">
          <n-thing :title="member.user.name" :description="member.user.email" />
          <template #suffix>
            <n-space align="center" size="small">
              <n-select
                :value="member.role"
                size="small"
                :loading="changingId === member.id"
                :options="[
                  { label: t('documents.viewerTag'), value: 'viewer' },
                  { label: t('documents.editorTag'), value: 'editor' },
                ]"
                style="width: 100px"
                name="member-role"
                id="member-role"
                @update:value="(value: 'viewer' | 'editor') => handleRoleChange(member, value)"
              />
              <n-popconfirm @positive-click="handleRemove(member)">
                <template #trigger>
                  <n-button size="small" type="error" quaternary :loading="removingId === member.id">
                    {{ $t('share.removeBtn') }}
                  </n-button>
                </template>
                {{ $t('share.removeConfirm', { name: member.user.name }) }}
              </n-popconfirm>
            </n-space>
          </template>
        </n-list-item>
      </n-list>
    </n-spin>

    <template #footer>
      <n-text depth="3" style="font-size: 12px">
        {{ $t('share.permissionHint') }}
      </n-text>
    </template>
  </n-modal>

  <!-- 复制失败兜底：可手动选择链接（替代原生 prompt） -->
  <n-modal
    v-model:show="linkFallbackVisible"
    preset="dialog"
    :title="$t('share.manualCopyTitle')"
    :negative-text="$t('share.closeBtn')"
  >
    <n-input
      :value="linkFallback"
      readonly
      :aria-label="$t('share.inviteLinkAria')"
      @focus="($event.target as HTMLInputElement).select()"
     name="invite-link-fallback" id="invite-link-fallback" />
  </n-modal>
</template>

<style scoped>
.public-share-row {
  display: flex;
  gap: 8px;
  align-items: center;
}

.public-share-link {
  margin-top: 10px;
}

.invite-row {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.invite-input-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
}
.suggest-popup {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  right: 0;
  background: var(--bg-surface);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16);
  max-height: 220px;
  overflow-y: auto;
  z-index: 20;
}
.suggest-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 14px;
}
.suggest-item.active {
  background: var(--bg-muted);
}
.suggest-name {
  font-weight: 500;
  white-space: nowrap;
}
.suggest-email {
  font-size: 12px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.member-list {
  max-height: 320px;
  overflow-y: auto;
}
</style>
