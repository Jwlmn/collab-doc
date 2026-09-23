<script setup lang="ts">
import { h } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import NotificationBell from '../components/NotificationBell.vue'

const auth = useAuthStore()
const router = useRouter()
const message = useMessage()

function renderLogoutLabel() {
  return h(NButton, { text: true, type: 'error' }, { default: () => '退出登录' })
}

async function handleLogout() {
  try {
    await auth.logout()
    message.success('已退出登录')
    await router.replace('/login')
  } catch {
    message.error('退出失败，请重试')
  }
}

function handleUserMenu(key: string) {
  if (key === 'logout') {
    void handleLogout()
  }
}
</script>

<template>
  <n-layout class="app-layout">
    <n-layout-header bordered class="layout-header">
      <router-link to="/" class="brand">多人实时协作文档</router-link>
      <n-space align="center">
        <template v-if="auth.user">
          <NotificationBell />
          <n-dropdown :options="[{ key: 'logout', label: renderLogoutLabel }]" @select="handleUserMenu">
            <n-button text class="user-btn">
              {{ auth.user.name }}
            </n-button>
          </n-dropdown>
        </template>
        <template v-else>
          <n-button text @click="router.push('/login')">登录</n-button>
          <n-button type="primary" @click="router.push('/register')">注册</n-button>
        </template>
      </n-space>
    </n-layout-header>
    <n-layout-content class="layout-content">
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
