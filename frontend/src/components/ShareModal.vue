<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { api, getApiErrorMessage } from '../utils/request'
import type { DocumentMember } from '../types'

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

watch(
  () => props.show,
  async (visible) => {
    if (visible) await fetchMembers()
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
    message.success(`已添加 ${data.data.user.name}`)
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
    message.success(`已将 ${member.user.name} 设为${role === 'editor' ? '可编辑' : '只读'}`)
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
    message.success(`已移除 ${member.user.name}`)
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    removingId.value = null
  }
}

const copyingInvite = ref(false)

/** P2-4：生成邀请链接并复制到剪贴板 */
async function copyInviteLink(): Promise<void> {
  copyingInvite.value = true
  try {
    const { data } = await api.post(`/documents/${props.documentId}/invite-link`)
    const url = window.location.origin + data.data.path
    try {
      await navigator.clipboard.writeText(url)
      message.success('邀请链接已复制（受邀者默认只读）')
    } catch {
      window.prompt('自动复制失败，请手动复制邀请链接', url)
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
    title="共享设置"
    @update:show="emit('update:show', $event)"
  >
    <div class="invite-row">
      <n-input
        v-model:value="inviteForm.email"
        placeholder="输入邮箱添加成员"
        @keyup.enter="handleAdd"
      />
      <n-select
        v-model:value="inviteForm.role"
        :options="[
          { label: '只读', value: 'viewer' },
          { label: '可编辑', value: 'editor' },
        ]"
        style="width: 110px"
      />
      <n-button type="primary" :loading="adding" @click="handleAdd">添加</n-button>
    </div>

    <n-button
      quaternary
      size="small"
      block
      :loading="copyingInvite"
      style="margin-bottom: 14px"
      @click="copyInviteLink"
    >
      🔗 复制邀请链接（受邀者默认只读）
    </n-button>

    <n-spin :show="loading">
      <n-empty
        v-if="!loading && members.length === 0"
        description="还没有共享成员"
        style="margin: 32px 0"
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
                  { label: '只读', value: 'viewer' },
                  { label: '可编辑', value: 'editor' },
                ]"
                style="width: 100px"
                @update:value="(value: 'viewer' | 'editor') => handleRoleChange(member, value)"
              />
              <n-popconfirm @positive-click="handleRemove(member)">
                <template #trigger>
                  <n-button size="small" type="error" quaternary :loading="removingId === member.id">
                    移除
                  </n-button>
                </template>
                确定将「{{ member.user.name }}」移出文档吗？
              </n-popconfirm>
            </n-space>
          </template>
        </n-list-item>
      </n-list>
    </n-spin>

    <template #footer>
      <n-text depth="3" style="font-size: 12px">
        只读成员可阅读、评论；可编辑成员还可修改内容与保存版本；仅所有者可重命名、删除与管理共享。
      </n-text>
    </template>
  </n-modal>
</template>

<style scoped>
.invite-row {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.member-list {
  max-height: 320px;
  overflow-y: auto;
}
</style>
