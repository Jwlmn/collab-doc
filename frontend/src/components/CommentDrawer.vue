<script setup lang="ts">
import { useIsMobile } from '../composables/useIsMobile'
import CommentPanelBody from './CommentPanelBody.vue'

/**
 * 评论抽屉（移动端形态）。
 *
 * 主体逻辑在 CommentPanelBody：挂载即拉取/标记已读/聚焦输入框。
 * 这里用 v-if 绑定 show，关闭即卸载，下次打开重新挂载 —— 与原
 * watch(show) 的取数时机一致。
 */
defineProps<{
  show: boolean
  documentId: number
  /** 当前用户是否为文档所有者（可删除任意评论） */
  canManage: boolean
}>()

const emit = defineEmits<{
  'update:show': [value: boolean]
  /** 抽屉打开并拉取评论后，通知父级未读已清零 */
  read: []
  /** 评论集合或解决状态变化，通知父级刷新角标 */
  changed: []
}>()

const isMobile = useIsMobile()
</script>

<template>
  <n-drawer
    :show="show"
    :width="isMobile ? '100%' : 420"
    placement="right"
    @update:show="emit('update:show', $event)"
  >
    <n-drawer-content :title="$t('comments.title')" closable>
      <CommentPanelBody
        v-if="show"
        :document-id="documentId"
        :can-manage="canManage"
        @read="emit('read')"
        @changed="emit('changed')"
      />
    </n-drawer-content>
  </n-drawer>
</template>
