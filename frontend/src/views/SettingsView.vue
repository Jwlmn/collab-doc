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
  { label: t('settings.themeSystem'), value: 'auto', desc: t('settings.themeSystemDesc') },
  { label: t('settings.themeLight'), value: 'light', desc: t('settings.themeLightDesc') },
  { label: t('settings.themeDark'), value: 'dark', desc: t('settings.themeDarkDesc') },
])

const languageOptions = computed(() => [
  { label: '简体中文', value: 'zh-CN', hint: t('settings.langZhDesc') },
  { label: 'English', value: 'en', hint: t('settings.langEnDesc') },
])
</script>

<template>
  <div class="settings-page">
    <div class="settings-head">
      <h1 class="settings-title">{{ $t('settings.title') }}</h1>
      <p class="settings-sub">{{ $t('settings.subtitle') }}</p>
    </div>

    <!-- 个人资料 -->
    <n-card :title="$t('settings.profileCard')" class="settings-card">
      <div class="profile-row">
        <!-- n-avatar 的默认插槽优先级高于 src：只要插槽有内容就渲染文字、不发图片请求，
             所以首字母只在没有头像 URL 时才放进默认插槽；加载失败走 #fallback 回退 -->
        <n-avatar :size="72" round :src="auth.user?.avatar_url ?? undefined" class="profile-avatar">
          <template v-if="!auth.user?.avatar_url">{{ (auth.user?.name ?? '?').slice(0, 1) }}</template>
          <template #fallback>
            <span class="avatar-fallback">{{ (auth.user?.name ?? '?').slice(0, 1) }}</span>
          </template>
        </n-avatar>
        <div class="profile-meta">
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
          </n-space>
          <n-text depth="3" class="hint">{{ $t('settings.avatarHint') }}</n-text>
        </div>
        <input
          ref="avatarInputRef"
          type="file"
          accept="image/*"
          hidden
          :aria-label="$t('settings.changeAvatar')"
          @change="handleAvatarPick"
        />
      </div>

      <n-form label-placement="left" label-width="64" style="margin-top: 20px">
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
        <div class="option-grid">
          <n-radio v-for="option in languageOptions" :key="option.value" :value="option.value" class="option-tile">
            <span class="option-body">
              <span class="option-label">{{ option.label }}</span>
              <span class="option-desc">{{ option.hint }}</span>
            </span>
          </n-radio>
        </div>
      </n-radio-group>
      <n-text depth="3" class="hint block-hint">{{ $t('settings.languageHint') }}</n-text>
    </n-card>

    <!-- 外观 -->
    <n-card :title="$t('settings.appearanceCard')" class="settings-card">
      <n-radio-group v-model:value="themeMode" :aria-label="$t('settings.appearanceCard')">
        <div class="option-grid">
          <!-- 保留 .n-radio 结构：e2e 按文案点选主题，交互与视觉升级互不干扰 -->
          <n-radio v-for="option in themeOptions" :key="option.value" :value="option.value" class="option-tile">
            <span class="option-body">
              <span class="option-label">{{ option.label }}</span>
              <span class="option-desc">{{ option.desc }}</span>
            </span>
          </n-radio>
        </div>
      </n-radio-group>
      <n-text depth="3" class="hint block-hint">{{ $t('settings.appearanceHint') }}</n-text>
    </n-card>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 720px;
  margin: 0 auto;
}
.settings-head {
  margin: 4px 0 20px;
}
.settings-title {
  font-size: 22px;
  font-weight: 650;
  letter-spacing: -0.01em;
  margin: 0;
}
.settings-sub {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--text-3);
}
.settings-card {
  margin-bottom: 16px;
  border-radius: var(--radius-md, 10px);
}
.profile-row {
  display: flex;
  align-items: center;
  gap: 18px;
  flex-wrap: wrap;
}
.profile-avatar {
  box-shadow: var(--shadow-card);
}
.profile-meta {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
.hint {
  font-size: 12px;
}
.block-hint {
  display: block;
  margin-top: 10px;
}
/* n-avatar #fallback 裸渲染进 flex 容器，需自带占满与居中 */
.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

/* 选项瓷砖：radio 仍是原生交互元素（e2e 依赖），外面套一层可点卡片提升可读性 */
.option-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
}
.option-tile {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 12px 14px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md, 10px);
  background: var(--bg-surface);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease,
    box-shadow 0.15s ease;
}
.option-tile:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}
/* 选中态：描边点亮 + 极浅底，与 radio 圆点双重反馈 */
.option-tile.n-radio--checked {
  border-color: var(--type-md);
  background: var(--type-md-bg);
  box-shadow: 0 0 0 1px var(--type-md) inset;
}
.option-tile :deep(.n-radio__radio-wrapper) {
  margin-top: 2px;
}
.option-body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.option-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
}
.option-desc {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-3);
}
@media (max-width: 560px) {
  .option-grid {
    grid-template-columns: 1fr;
  }
}
</style>
