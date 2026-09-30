<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { api, getApiErrorMessage } from '../utils/request'
import { uploadImage } from '../utils/upload'
import { useAuthStore } from '../stores/auth'
import { useTheme } from '../composables/useTheme'

const auth = useAuthStore()
const message = useMessage()

/** 外观：三态 radio 即时生效（auto = 跟随系统），无需保存 */
const { mode: themeMode } = useTheme()

/* ---------------- 个人资料 ---------------- */

const profile = reactive({
  name: auth.user?.name ?? '',
  avatar_url: auth.user?.avatar_url ?? null,
})

const profileDirty = computed(
  () =>
    profile.name.trim() !== (auth.user?.name ?? '') ||
    profile.avatar_url !== (auth.user?.avatar_url ?? null),
)

const savingProfile = ref(false)

async function saveProfile() {
  const name = profile.name.trim()
  if (!name || savingProfile.value || !profileDirty.value) return
  savingProfile.value = true
  try {
    await auth.updateProfile({ name, avatar_url: profile.avatar_url })
    message.success('资料已保存')
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    savingProfile.value = false
  }
}

/* 头像：先走既有图片上传接口拿 URL，随「保存」一并落库 */
const avatarInputRef = ref<HTMLInputElement | null>(null)
const uploadingAvatar = ref(false)

function openAvatarPicker() {
  avatarInputRef.value?.click()
}

async function handleAvatarPick(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  uploadingAvatar.value = true
  try {
    const { url } = await uploadImage(file)
    profile.avatar_url = url
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    uploadingAvatar.value = false
  }
}

function removeAvatar() {
  profile.avatar_url = null
}

/* ---------------- 修改密码 ---------------- */

const password = reactive({
  current_password: '',
  password: '',
  password_confirmation: '',
})

const changingPassword = ref(false)

const passwordReady = computed(
  () =>
    password.current_password !== '' &&
    password.password !== '' &&
    password.password === password.password_confirmation,
)

async function changePassword() {
  if (!passwordReady.value || changingPassword.value) return
  changingPassword.value = true
  try {
    await api.put('/user/password', {
      current_password: password.current_password,
      password: password.password,
      password_confirmation: password.password_confirmation,
    })
    message.success('密码已更新')
    Object.assign(password, { current_password: '', password: '', password_confirmation: '' })
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    changingPassword.value = false
  }
}

const themeOptions = [
  { label: '跟随系统', value: 'auto' },
  { label: '浅色', value: 'light' },
  { label: '深色', value: 'dark' },
]
</script>

<template>
  <div class="settings-page">
    <h1 class="settings-title">设置</h1>

    <!-- 个人资料 -->
    <n-card title="个人资料" class="settings-card">
      <div class="profile-row">
        <n-avatar :size="64" round :src="auth.user?.avatar_url ?? undefined">
          {{ (auth.user?.name ?? '?').slice(0, 1) }}
        </n-avatar>
        <n-space align="center">
          <n-button size="small" :loading="uploadingAvatar" @click="openAvatarPicker">
            更换头像
          </n-button>
          <n-button
            v-if="profile.avatar_url"
            size="small"
            quaternary
            type="error"
            @click="removeAvatar"
          >
            移除头像
          </n-button>
          <n-text depth="3" style="font-size: 12px">JPG / PNG / GIF / WebP，不超过 5MB</n-text>
        </n-space>
        <input
          ref="avatarInputRef"
          type="file"
          accept="image/*"
          hidden
          aria-label="选择头像图片"
          @change="handleAvatarPick"
        />
      </div>

      <n-form label-placement="left" label-width="64" style="margin-top: 16px">
        <n-form-item label="昵称">
          <n-input
            v-model:value="profile.name"
            maxlength="255"
            placeholder="你的昵称"
            aria-label="昵称"
          />
        </n-form-item>
      </n-form>
      <n-space justify="end">
        <n-button
          type="primary"
          :loading="savingProfile"
          :disabled="!profileDirty || profile.name.trim() === ''"
          @click="saveProfile"
        >
          保存
        </n-button>
      </n-space>
    </n-card>

    <!-- 修改密码 -->
    <n-card title="修改密码" class="settings-card">
      <n-form label-placement="left" label-width="88">
        <n-form-item label="当前密码">
          <n-input
            v-model:value="password.current_password"
            type="password"
            show-password-on="click"
            placeholder="请输入当前密码"
            aria-label="当前密码"
          />
        </n-form-item>
        <n-form-item label="新密码">
          <n-input
            v-model:value="password.password"
            type="password"
            show-password-on="click"
            placeholder="至少 8 位"
            aria-label="新密码"
          />
        </n-form-item>
        <n-form-item label="确认新密码">
          <n-input
            v-model:value="password.password_confirmation"
            type="password"
            show-password-on="click"
            placeholder="再次输入新密码"
            aria-label="确认新密码"
          />
        </n-form-item>
      </n-form>
      <n-space justify="end">
        <n-button
          type="primary"
          :loading="changingPassword"
          :disabled="!passwordReady"
          @click="changePassword"
        >
          更新密码
        </n-button>
      </n-space>
    </n-card>

    <!-- 外观 -->
    <n-card title="外观" class="settings-card">
      <n-radio-group v-model:value="themeMode" aria-label="主题模式">
        <n-space>
          <n-radio v-for="option in themeOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </n-radio>
        </n-space>
      </n-radio-group>
      <n-text depth="3" style="font-size: 12px; display: block; margin-top: 8px">
        选择「跟随系统」后，深浅色随设备的深色模式自动切换；顶栏的月亮/太阳按钮会切换为手动指定。
      </n-text>
    </n-card>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 720px;
  margin: 0 auto;
}
.settings-title {
  font-size: 22px;
  margin: 8px 0 16px;
}
.settings-card {
  margin-bottom: 16px;
}
.profile-row {
  display: flex;
  align-items: center;
  gap: 16px;
  flex-wrap: wrap;
}
</style>
