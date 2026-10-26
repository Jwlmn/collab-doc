<script setup lang="ts">
import { useIsMobile } from '../composables/useIsMobile'

/**
 * 编辑器三栏工作区：左文件树 / 中编辑区 / 右评论面板，两侧可折叠。
 *
 * 折叠状态由调用方持有（useLocalStorage 持久化）；移动端两个面板一律
 * 不渲染（左树不可达、评论走 CommentDrawer 抽屉形态）。
 */
withDefaults(
  defineProps<{
    leftOpen: boolean
    rightOpen: boolean
    /** 访客分享态整体关闭两侧面板（含边缘开关） */
    panelsEnabled?: boolean
  }>(),
  { panelsEnabled: true },
)

const emit = defineEmits<{
  'update:leftOpen': [value: boolean]
  'update:rightOpen': [value: boolean]
}>()

const isMobile = useIsMobile()
</script>

<template>
  <div class="workspace">
    <aside v-if="panelsEnabled && !isMobile && leftOpen" class="ws-left">
      <button
        type="button"
        class="panel-toggle"
        :aria-label="$t('editor.collapseTreeAria')"
        :title="$t('editor.collapseTreeAria')"
        @click="emit('update:leftOpen', false)"
      >
        «
      </button>
      <slot name="left" />
    </aside>

    <div class="ws-center">
      <slot />
    </div>

    <aside v-if="panelsEnabled && !isMobile && rightOpen" class="ws-right">
      <button
        type="button"
        class="panel-toggle"
        :aria-label="$t('editor.collapseCommentsAria')"
        :title="$t('editor.collapseCommentsAria')"
        @click="emit('update:rightOpen', false)"
      >
        »
      </button>
      <slot name="right" />
    </aside>

    <!-- 折叠后的边缘开关：常驻细条，点击展开对应面板 -->
    <button
      v-if="panelsEnabled && !isMobile && !leftOpen"
      type="button"
      class="ws-rail left"
      :aria-label="$t('editor.toggleTreeAria')"
      :title="$t('editor.toggleTreeAria')"
      @click="emit('update:leftOpen', true)"
    >
      ➤
    </button>
    <button
      v-if="panelsEnabled && !isMobile && !rightOpen"
      type="button"
      class="ws-rail right"
      :aria-label="$t('editor.toggleCommentsAria')"
      :title="$t('editor.toggleCommentsAria')"
      @click="emit('update:rightOpen', true)"
    >
      ◀
    </button>
  </div>
</template>

<style scoped>
.workspace {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: stretch;
}
.ws-left {
  position: relative;
  flex: none;
  width: 240px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
}
.ws-center {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow-y: auto;
}
.ws-right {
  position: relative;
  flex: none;
  width: 340px;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0 14px 14px;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-subtle);
}
/* 面板顶部折叠按钮：浮在面板右上/左上角，不占布局位 */
.panel-toggle {
  position: absolute;
  top: 8px;
  z-index: 5;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  border-radius: var(--radius-sm, 6px);
  background: transparent;
  color: var(--text-3);
  font-size: 12px;
  cursor: pointer;
}
.panel-toggle:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
.ws-left .panel-toggle {
  right: 4px;
}
.ws-right .panel-toggle {
  left: 4px;
}
/* 边缘常驻开关条 */
.ws-rail {
  flex: none;
  width: 18px;
  border: none;
  border-left: 1px solid var(--border-subtle);
  background: var(--bg-muted);
  color: var(--text-3);
  font-size: 10px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  writing-mode: vertical-lr;
}
.ws-rail.left {
  order: -1;
  border-left: none;
  border-right: 1px solid var(--border-subtle);
}
.ws-rail:hover {
  background: var(--bg-hover);
  color: var(--text-1);
}
</style>
