<script setup lang="ts">
import { h } from 'vue'
import { NButton, useMessage } from 'naive-ui'
import { useRouter } from 'vue-router'
import { useAuthStore } from '../stores/auth'

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
  <n-layout style="min-height: 100vh">
    <n-layout-header bordered class="layout-header">
      <router-link to="/" class="brand">多人实时协作文档</router-link>
      <n-space align="center">
        <template v-if="auth.user">
          <n-dropdown :options="[{ key: 'logout', label: renderLogoutLabel }]" @select="handleUserMenu">
            <n-button text>
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
    <n-layout-content content-style="padding: 24px">
      <router-view />
    </n-layout-content>
  </n-layout>
</template>

<style scoped>
.layout-header {
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}
.brand {
  font-size: 18px;
  font-weight: 600;
  color: inherit;
  text-decoration: none;
}
</style>
