<script setup lang="ts">
import { useRouter } from 'vue-router'
import ThemeToggle from '../components/ThemeToggle.vue'

const router = useRouter()
</script>

<template>
  <div class="not-found">
    <div class="not-found-theme-toggle">
      <ThemeToggle />
    </div>
    <n-result
      status="404"
      :title="$t('notFound.title')"
      :description="$t('notFound.description')"
    >
      <template #footer>
        <n-space justify="center">
          <n-button type="primary" @click="router.push('/')">{{ $t('notFound.goHome') }}</n-button>
          <n-button quaternary @click="router.back()">{{ $t('notFound.goBack') }}</n-button>
        </n-space>
      </template>
    </n-result>
  </div>
</template>

<style scoped>
.not-found {
  position: relative;
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-page);
}
.not-found-theme-toggle {
  position: absolute;
  top: 16px;
  right: 24px;
}
</style>
