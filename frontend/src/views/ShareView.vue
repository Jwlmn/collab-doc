<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { api } from '../utils/request'
import type { DocumentMeta } from '../types'

/**
 * 公开只读分享落地页。
 *
 * 未登录也能打开：meta 与协作令牌都取自 /api/share/*（访客专用、GET、
 * 404 而非 401），**绝不碰会被 401 的登录态接口**，否则会被
 * request.ts 的拦截器踢去登录页。
 */
const route = useRoute()

const token = computed(() => String(route.params.token ?? ''))
const status = ref<'loading' | 'ready' | 'invalid'>('loading')
const meta = ref<DocumentMeta | null>(null)
const expiresAt = ref<string | null>(null)

/** 按文档类型懒加载对应编辑器（访客可能不装某些扩展也能省首屏） */
const editorView = computed(() => {
  if (meta.value?.type === 'excel') {
    return defineAsyncComponent(() => import('./ExcelEditorView.vue'))
  }
  return defineAsyncComponent(() => import('./DocEditorView.vue'))
})

onMounted(async () => {
  try {
    const { data } = await api.get(`/share/${token.value}`)
    meta.value = data.data.document as DocumentMeta
    expiresAt.value = data.data.expires_at ?? null
    status.value = 'ready'
  } catch {
    // 令牌无效 / 过期 / 已撤销 / 文档在回收站 → 一律失效页，不跳登录
    status.value = 'invalid'
  }
})
</script>

<template>
  <div class="share-page">
    <n-spin :show="status === 'loading'" size="large">
      <!-- 失效：给出明确原因，不引导登录 -->
      <div v-if="status === 'invalid'" class="share-invalid">
        <n-result status="404" title="链接无效或已失效" description="该分享链接可能已被撤销、过期，或文档已被删除。">
          <template #footer>
            <n-button type="primary" @click="$router.push('/')">回到文档列表</n-button>
          </template>
        </n-result>
      </div>

      <template v-else-if="status === 'ready' && meta">
        <!-- 访客横幅：说明这是只读视图 -->
        <div class="share-banner" role="status">
          <n-icon size="14">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              stroke-width="2">
              <rect x="3" y="11" width="18" height="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </n-icon>
          <span>只读访客链接 · 无需登录即可查看</span>
          <span v-if="expiresAt" class="share-expiry">有效期至 {{ new Date(expiresAt).toLocaleString() }}</span>
        </div>

        <component :is="editorView" :share-token="token" :shared-meta="meta" />
      </template>
    </n-spin>
  </div>
</template>

<style scoped>
.share-page {
  min-height: 100vh;
  min-height: 100dvh;
}

.share-invalid {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 70vh;
  padding: 24px;
}

/* 横幅压在编辑器顶栏之上；z-index 盖过 sticky 顶栏 */
.share-banner {
  position: sticky;
  top: 0;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 16px;
  font-size: 13px;
  color: #8a6116;
  background: #fff7e6;
  border-bottom: 1px solid #ffe7ba;
}

.share-expiry {
  margin-left: auto;
  color: #b37feb;
}
</style>
