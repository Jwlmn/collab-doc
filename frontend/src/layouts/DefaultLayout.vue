<script setup lang="ts">
import { computed, h } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import NotificationBell from '../components/NotificationBell.vue'
import ThemeToggle from '../components/ThemeToggle.vue'

const auth = useAuthStore()
const router = useRouter()
const message = useMessage()
const { t } = useI18n()

function renderLogoutLabel() {
  return h(NButton, { text: true, type: 'error' }, { default: () => t('shell.logout') })
}

async function handleLogout() {
  try {
    await auth.logout()
    message.success(t('shell.loggedOut'))
    await router.replace('/login')
  } catch {
    message.error(t('shell.logoutFailed'))
  }
}

const userMenuOptions = computed(() => [
  { key: 'settings', label: t('shell.settingsMenu') },
  { key: 'logout', label: renderLogoutLabel },
])

function handleUserMenu(key: string) {
  if (key === 'logout') {
    void handleLogout()
  } else if (key === 'settings') {
    void router.push('/settings')
  }
}
</script>

<template>
  <n-layout class="app-layout">
    <a href="#main" class="skip-link">{{ $t('shell.skipToMain') }}</a>
    <n-layout-header bordered class="layout-header">
      <router-link to="/" class="brand">{{ $t('shell.appTitle') }}</router-link>
      <n-space align="center">
        <ThemeToggle />
        <template v-if="auth.user">
          <NotificationBell />
          <n-dropdown :options="userMenuOptions" @select="handleUserMenu">
            <n-button text class="user-btn">
              <template #icon>
                <!-- 同 SettingsView：默认插槽会压过 src，首字母只在无头像时放默认插槽 -->
                <n-avatar :size="22" round :src="auth.user.avatar_url ?? undefined">
                  <template v-if="!auth.user.avatar_url">{{ auth.user.name.slice(0, 1) }}</template>
                  <template #fallback>
                    <span class="avatar-fallback">{{ auth.user.name.slice(0, 1) }}</span>
                  </template>
                </n-avatar>
              </template>
              {{ auth.user.name }}
            </n-button>
          </n-dropdown>
        </template>
        <template v-else>
          <n-button text @click="router.push('/login')">{{ $t('shell.login') }}</n-button>
          <n-button type="primary" @click="router.push('/register')">
            {{ $t('shell.register') }}
          </n-button>
        </template>
      </n-space>
    </n-layout-header>
    <!-- role=main：n-layout-content 渲染成 div，不自动成为 main landmark -->
    <n-layout-content id="main" class="layout-content" tabindex="-1" role="main">
      <router-view />
    </n-layout-content>
  </n-layout>
</template>

<style scoped>
.app-layout {
  min-height: 100vh;
  min-height: 100dvh; /* 移动端地址栏伸缩时视口高度跟随 */
}
.layout-header {
  min-height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap; /* 窄屏允许换行，配合品牌/用户名省略 */
  gap: 4px 12px;
  padding: 8px 24px;
  padding-left: calc(24px + env(safe-area-inset-left));
  padding-right: calc(24px + env(safe-area-inset-right));
}
.brand {
  font-size: 18px;
  font-weight: 600;
  color: inherit;
  text-decoration: none;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/* 长用户名不挤压头部 */
.user-btn {
  max-width: 140px;
}
/* n-avatar #fallback 裸渲染进 flex 容器，需自带占满与居中 */
.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}
.user-btn :deep(.n-button__content) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.layout-content {
  padding: 24px;
  padding-left: calc(24px + env(safe-area-inset-left));
  padding-right: calc(24px + env(safe-area-inset-right));
}
</style>
