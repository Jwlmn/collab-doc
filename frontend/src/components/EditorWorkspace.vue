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
/* 面板顶部折叠按钮：浮在面板右上/左上角，不占布局位。
   32×32 命中区（图标仍小巧），带可见描边圆底，避免「找不到、点不中」 */
.panel-toggle {
  position: absolute;
  top: 8px;
  z-index: 5;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md, 8px);
  background: var(--bg-surface);
  color: var(--text-2);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    border-color 0.15s ease;
}
.panel-toggle:hover {
  background: var(--bg-hover);
  color: var(--text-1);
  border-color: var(--border-strong);
}
.panel-toggle:focus-visible {
  outline: 2px solid var(--accent, #2080f0);
  outline-offset: 1px;
}
.ws-left .panel-toggle {
  right: 6px;
}
.ws-right .panel-toggle {
  left: 6px;
}

/* 折叠后的边缘开关条：加宽到 32px，并让整条边（含上下留白）都可点。
   原来 18px 窄条鼠标难命中，文件树藏起来后尤其难再打开。 */
.ws-rail {
  position: relative;
  flex: none;
  width: 32px;
  border: none;
  border-left: 1px solid var(--border-subtle);
  background: var(--bg-muted);
  color: var(--text-2);
  font-size: 13px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  writing-mode: vertical-lr;
  transition:
    background 0.15s ease,
    color 0.15s ease,
    width 0.15s ease;
}
/* 把手本体只有 32px 宽，但用伪元素向面板内侧扩出 20px 的透明命中区，
   命中区总宽 52px 且不占布局、不遮挡内容交互 */
.ws-rail::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  width: 20px;
}
.ws-rail.left {
  order: -1;
  border-left: none;
  border-right: 1px solid var(--border-subtle);
}
.ws-rail.left::before {
  right: 0;
}
.ws-rail.right::before {
  left: 0;
}
.ws-rail:hover {
  background: var(--bg-active);
  color: var(--text-1);
  width: 40px; /* 悬停时略加宽，给「这里能点」的即时反馈 */
}
.ws-rail:focus-visible {
  outline: 2px solid var(--accent, #2080f0);
  outline-offset: -2px;
}
/* 触屏：把手放大到 44px，对齐移动端最小可点尺寸 */
@media (pointer: coarse) {
  .ws-rail {
    width: 44px;
    font-size: 15px;
  }
  .ws-rail:hover {
    width: 44px;
  }
  .panel-toggle {
    width: 40px;
    height: 40px;
  }
}
</style>
