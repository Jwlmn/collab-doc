<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { api, getApiErrorMessage } from '../utils/request'
import { uploadImage } from '../utils/upload'
import { useAuthStore } from '../stores/auth'
import { useTheme } from '../composables/useTheme'
import { setLocale, type AppLocale } from '../i18n'

const auth = useAuthStore()
const message = useMessage()
const { t, locale } = useI18n()

/** 外观：三态 radio 即时生效（auto = 跟随系统），无需保存 */
const { mode: themeMode } = useTheme()

/** 语言：切换即持久化（与外观同为即时生效） */
const languageMode = computed<AppLocale>({
  // vue-i18n 的 locale ref 声明为 string，本应用只允许两语，收窄回字面量联合
  get: () => locale.value as AppLocale,
  set: (value: AppLocale) => setLocale(value),
})

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
    message.success(t('settings.profileSaved'))
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
    message.success(t('settings.passwordUpdated'))
    Object.assign(password, { current_password: '', password: '', password_confirmation: '' })
  } catch (error) {
    message.error(getApiErrorMessage(error))
  } finally {
    changingPassword.value = false
  }
}

const themeOptions = computed(() => [
  { label: t('settings.themeSystem'), value: 'auto' },
  { label: t('settings.themeLight'), value: 'light' },
  { label: t('settings.themeDark'), value: 'dark' },
])

const languageOptions = [
  { label: '简体中文', value: 'zh-CN' },
  { label: 'English', value: 'en' },
]
</script>

<template>
  <div class="settings-page">
    <h1 class="settings-title">{{ $t('settings.title') }}</h1>

    <!-- 个人资料 -->
    <n-card :title="$t('settings.profileCard')" class="settings-card">
      <div class="profile-row">
        <!-- n-avatar 的默认插槽优先级高于 src：只要插槽有内容就渲染文字、不发图片请求，
             所以首字母只在没有头像 URL 时才放进默认插槽；加载失败走 #fallback 回退 -->
        <n-avatar :size="64" round :src="auth.user?.avatar_url ?? undefined">
          <template v-if="!auth.user?.avatar_url">{{ (auth.user?.name ?? '?').slice(0, 1) }}</template>
          <template #fallback>
            <span class="avatar-fallback">{{ (auth.user?.name ?? '?').slice(0, 1) }}</span>
          </template>
        </n-avatar>
        <n-space align="center">
          <n-button size="small" :loading="uploadingAvatar" @click="openAvatarPicker">
            {{ $t('settings.changeAvatar') }}
          </n-button>
          <n-button
            v-if="profile.avatar_url"
            size="small"
            quaternary
            type="error"
            @click="removeAvatar"
          >
            {{ $t('settings.removeAvatar') }}
          </n-button>
          <n-text depth="3" style="font-size: 12px">{{ $t('settings.avatarHint') }}</n-text>
        </n-space>
        <input
          ref="avatarInputRef"
          type="file"
          accept="image/*"
          hidden
          :aria-label="$t('settings.changeAvatar')"
          @change="handleAvatarPick"
        />
      </div>

      <n-form label-placement="left" label-width="64" style="margin-top: 16px">
        <n-form-item :label="$t('settings.nameLabel')">
          <n-input
            v-model:value="profile.name"
            maxlength="255"
            :placeholder="$t('settings.namePlaceholder')"
            :aria-label="$t('settings.nameLabel')"
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
          {{ $t('common.save') }}
        </n-button>
      </n-space>
    </n-card>

    <!-- 修改密码 -->
    <n-card :title="$t('settings.passwordCard')" class="settings-card">
      <n-form label-placement="left" label-width="88">
        <n-form-item :label="$t('settings.currentPasswordLabel')">
          <n-input
            v-model:value="password.current_password"
            type="password"
            show-password-on="click"
            :placeholder="$t('settings.currentPasswordPlaceholder')"
            :aria-label="$t('settings.currentPasswordLabel')"
          />
        </n-form-item>
        <n-form-item :label="$t('settings.newPasswordLabel')">
          <n-input
            v-model:value="password.password"
            type="password"
            show-password-on="click"
            :placeholder="$t('settings.newPasswordPlaceholder')"
            :aria-label="$t('settings.newPasswordLabel')"
          />
        </n-form-item>
        <n-form-item :label="$t('settings.confirmPasswordLabel')">
          <n-input
            v-model:value="password.password_confirmation"
            type="password"
            show-password-on="click"
            :placeholder="$t('settings.confirmPasswordPlaceholder')"
            :aria-label="$t('settings.confirmPasswordLabel')"
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
          {{ $t('settings.updatePassword') }}
        </n-button>
      </n-space>
    </n-card>

    <!-- 语言 -->
    <n-card :title="$t('settings.languageCard')" class="settings-card">
      <n-radio-group v-model:value="languageMode" :aria-label="$t('settings.languageCard')">
        <n-space>
          <n-radio v-for="option in languageOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </n-radio>
        </n-space>
      </n-radio-group>
      <n-text depth="3" style="font-size: 12px; display: block; margin-top: 8px">
        {{ $t('settings.languageHint') }}
      </n-text>
    </n-card>

    <!-- 外观 -->
    <n-card :title="$t('settings.appearanceCard')" class="settings-card">
      <n-radio-group v-model:value="themeMode" :aria-label="$t('settings.appearanceCard')">
        <n-space>
          <n-radio v-for="option in themeOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </n-radio>
        </n-space>
      </n-radio-group>
      <n-text depth="3" style="font-size: 12px; display: block; margin-top: 8px">
        {{ $t('settings.appearanceHint') }}
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
/* n-avatar #fallback 裸渲染进 flex 容器，需自带占满与居中 */
.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
</style>
