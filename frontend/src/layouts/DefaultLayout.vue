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
    <n-layout-header class="layout-header">
      <div class="header-inner">
        <router-link to="/" class="brand">
          <span class="brand-mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 3.5h7.2L18 7.3V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
              <path d="M14 3.5V7.5H18" />
              <path d="M9 12.5h6M9 16h4" />
            </svg>
          </span>
          <span class="brand-text">{{ $t('shell.appTitle') }}</span>
        </router-link>
        <n-space align="center" class="header-actions">
          <ThemeToggle />
          <template v-if="auth.user">
            <NotificationBell />
            <n-dropdown :options="userMenuOptions" placement="bottom-end" @select="handleUserMenu">
              <n-button text class="user-btn">
                <template #icon>
                  <!-- 同 SettingsView：默认插槽会压过 src，首字母只在无头像时放默认插槽 -->
                  <n-avatar :size="26" round :src="auth.user.avatar_url ?? undefined">
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
            <n-button quaternary @click="router.push('/login')">{{ $t('shell.login') }}</n-button>
            <n-button type="primary" @click="router.push('/register')">
              {{ $t('shell.register') }}
            </n-button>
          </template>
        </n-space>
      </div>
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
  /* 吸顶：长文档列表滚动时品牌与账户操作始终可达 */
  position: sticky;
  top: 0;
  z-index: 100;
  background: color-mix(in srgb, var(--bg-surface) 82%, transparent);
  /* 毛玻璃：不支持时回退为实色 surface（color-mix 已保证底色不透） */
  backdrop-filter: saturate(180%) blur(12px);
  -webkit-backdrop-filter: saturate(180%) blur(12px);
  /* 顶栏不贴边时用细线 + 极浅阴影拉开层次 */
  box-shadow: 0 1px 0 var(--border-subtle);
}
.header-inner {
  min-height: 60px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap; /* 窄屏允许换行，配合品牌/用户名省略 */
  gap: 8px 12px;
  max-width: 1280px;
  margin: 0 auto;
  padding: 8px 24px;
  padding-left: calc(24px + env(safe-area-inset-left));
  padding-right: calc(24px + env(safe-area-inset-right));
}
.brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  color: inherit;
  text-decoration: none;
}
/* 渐变标识块：品牌第一眼的视觉锚点 */
.brand-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  flex: none;
  border-radius: 9px;
  color: #fff;
  background: linear-gradient(135deg, #4098fc 0%, #2080f0 55%, #1668d6 100%);
  box-shadow: 0 3px 8px rgba(32, 128, 240, 0.32);
}
.brand-text {
  font-size: 16px;
  font-weight: 650;
  letter-spacing: 0.01em;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.header-actions {
  flex: none;
}
/* 长用户名不挤压头部；hover 时轻底提示可点开菜单 */
.user-btn {
  max-width: 160px;
  padding: 0 10px;
  border-radius: 8px;
  transition: background-color 0.15s ease;
}
.user-btn:hover {
  background: var(--bg-hover);
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
  max-width: 1280px;
  margin: 0 auto;
  padding: 28px 24px 48px;
  padding-left: calc(24px + env(safe-area-inset-left));
  padding-right: calc(24px + env(safe-area-inset-right));
}
@media (max-width: 640px) {
  .header-inner {
    padding-left: calc(16px + env(safe-area-inset-left));
    padding-right: calc(16px + env(safe-area-inset-right));
  }
  .brand-text {
    font-size: 15px;
  }
  .layout-content {
    padding: 20px 16px 40px;
    padding-left: calc(16px + env(safe-area-inset-left));
    padding-right: calc(16px + env(safe-area-inset-right));
  }
}
</style>
