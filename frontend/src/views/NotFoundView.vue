<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()
</script>

<template>
  <div class="not-found">
    <n-result status="404" title="页面不存在" description="你访问的页面不存在或已被删除">
      <template #footer>
        <n-space justify="center">
          <n-button type="primary" @click="router.push('/')">回到文档列表</n-button>
          <n-button quaternary @click="router.back()">返回上一页</n-button>
        </n-space>
      </template>
    </n-result>
  </div>
</template>

<style scoped>
.not-found {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-page);
}
</style>
