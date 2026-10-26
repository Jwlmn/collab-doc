<script setup lang="ts">
import { useI18n } from 'vue-i18n'

/**
 * 认证页外壳：左侧品牌叙述 + 右侧表单卡片。
 * 登录/注册共用同一布局，只通过插槽喂表单内容，避免两页各写一套。
 * 左侧品牌区 aria-hidden：它对表单无功能增益，读屏用户不该多读一段宣传语。
 */
defineProps<{ title: string }>()

const { t } = useI18n()

/** 三条卖点：图标 + 文案，随语言切换 */
const features = [
  { key: 'collab', icon: 'users' },
  { key: 'crdt', icon: 'shield' },
  { key: 'sheets', icon: 'grid' },
] as const
</script>

<template>
  <div class="auth-shell">
    <div class="auth-panel" aria-hidden="true">
      <div class="panel-inner">
        <div class="panel-brand">
          <span class="panel-mark">
            <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor"
              stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M7 3.5h7.2L18 7.3V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
              <path d="M14 3.5V7.5H18" />
              <path d="M9 12.5h6M9 16h4" />
            </svg>
          </span>
          <span class="panel-title">{{ t('shell.appTitle') }}</span>
        </div>

        <p class="panel-lead">{{ t('auth.lead') }}</p>

        <ul class="panel-features">
          <li v-for="feature in features" :key="feature.key" class="panel-feature">
            <span class="feature-icon">
              <!-- 协作 -->
              <svg v-if="feature.icon === 'users'" viewBox="0 0 24 24" width="18" height="18" fill="none"
                stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19" />
                <circle cx="10" cy="8" r="3" />
                <path d="M20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.5 5.2a3 3 0 0 1 0 5.6" />
              </svg>
              <!-- CRDT 一致 -->
              <svg v-else-if="feature.icon === 'shield'" viewBox="0 0 24 24" width="18" height="18" fill="none"
                stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 3l7 3v5c0 4.2-2.9 7.9-7 9-4.1-1.1-7-4.8-7-9V6z" />
                <path d="M9.5 12l1.8 1.8 3.4-3.6" />
              </svg>
              <!-- 表格 -->
              <svg v-else viewBox="0 0 24 24" width="18" height="18" fill="none"
                stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="2" />
                <path d="M3 9.5h18M3 14.5h18M9 4v16M15 4v16" />
              </svg>
            </span>
            <span class="feature-text">
              <span class="feature-title">{{ t(`auth.features.${feature.key}.title`) }}</span>
              <span class="feature-desc">{{ t(`auth.features.${feature.key}.desc`) }}</span>
            </span>
          </li>
        </ul>
      </div>
      <!-- 装饰性光晕：纯视觉，pointer-events 关掉以免挡住表单 -->
      <span class="panel-glow panel-glow--1"></span>
      <span class="panel-glow panel-glow--2"></span>
    </div>

    <div class="auth-form-side">
      <n-card class="auth-card" :bordered="false">
        <template #header>
          <div class="card-heading">
            <span class="card-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path d="M7 3.5h7.2L18 7.3V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" />
                <path d="M14 3.5V7.5H18" />
                <path d="M9 12.5h6M9 16h4" />
              </svg>
            </span>
            <div class="card-heading-text">
              <h1 class="card-title">{{ title }}</h1>
              <p class="card-subtitle"><slot name="subtitle" /></p>
            </div>
          </div>
        </template>
        <slot />
      </n-card>
    </div>
  </div>
</template>

<style scoped>
.auth-shell {
  display: grid;
  grid-template-columns: 1.05fr 1fr;
  /* DefaultLayout 的 layout-content--bare 已去掉内边距，这里直接填满 header 以下的可用高度 */
  min-height: calc(100vh - 60px);
  min-height: calc(100dvh - 60px);
  background: var(--bg-surface);
}

/* ---------------- 左侧品牌区 ---------------- */
.auth-panel {
  position: relative;
  overflow: hidden;
  display: flex;
  align-items: center;
  padding: 48px 56px;
  background:
    radial-gradient(120% 90% at 15% 8%, rgba(64, 152, 252, 0.16) 0%, transparent 55%),
    linear-gradient(160deg, #f5f9ff 0%, #eef4fd 45%, #f7f8fa 100%);
  border-right: 1px solid var(--border-subtle);
}
:root[data-theme='dark'] .auth-panel {
  background:
    radial-gradient(120% 90% at 15% 8%, rgba(64, 152, 252, 0.14) 0%, transparent 55%),
    linear-gradient(160deg, #1a1d24 0%, #171a20 45%, #141519 100%);
}
.panel-inner {
  position: relative;
  z-index: 1;
  max-width: 420px;
}
.panel-brand {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 28px;
}
.panel-mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  color: #fff;
  background: linear-gradient(135deg, #4098fc 0%, #2080f0 55%, #1668d6 100%);
  box-shadow: 0 6px 16px rgba(32, 128, 240, 0.34);
}
.panel-title {
  font-size: 20px;
  font-weight: 650;
  letter-spacing: 0.01em;
}
.panel-lead {
  margin: 0 0 32px;
  font-size: 26px;
  font-weight: 650;
  line-height: 1.4;
  letter-spacing: -0.01em;
  color: var(--text-1);
}
.panel-features {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.panel-feature {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}
.feature-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  flex: none;
  border-radius: 9px;
  color: var(--type-md);
  background: var(--bg-surface);
  box-shadow: var(--shadow-card);
}
.feature-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.feature-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-1);
}
.feature-desc {
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-2);
}
/* 装饰光晕：柔和圆斑，弱化渐变边界 */
.panel-glow {
  position: absolute;
  border-radius: 50%;
  filter: blur(46px);
  pointer-events: none;
  opacity: 0.5;
}
.panel-glow--1 {
  width: 220px;
  height: 220px;
  top: -60px;
  right: -40px;
  background: rgba(64, 152, 252, 0.32);
}
.panel-glow--2 {
  width: 180px;
  height: 180px;
  bottom: -50px;
  left: -30px;
  background: rgba(24, 160, 88, 0.2);
}

/* ---------------- 右侧表单区 ---------------- */
.auth-form-side {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 48px 32px;
  background: var(--bg-page);
}
.auth-card {
  width: min(400px, 100%);
  border-radius: var(--radius-lg, 14px);
  box-shadow: var(--shadow-float);
}
.card-heading {
  display: flex;
  align-items: center;
  gap: 12px;
}
.card-mark {
  display: none; /* 窄屏隐藏左栏时，标识由 card-heading 内的窄屏样式接管 */
}
.card-heading-text {
  min-width: 0;
}
.card-title {
  margin: 0;
  font-size: 20px;
  font-weight: 650;
  letter-spacing: -0.01em;
}
.card-subtitle {
  margin: 3px 0 0;
  font-size: 13px;
  color: var(--text-3);
}

/* 窄屏：品牌区收起，只留表单，标识回到卡片标题前 */
@media (max-width: 900px) {
  .auth-shell {
    grid-template-columns: 1fr;
  }
  .auth-panel {
    display: none;
  }
  .auth-form-side {
    padding: 40px 16px;
  }
  .card-mark {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 38px;
    height: 38px;
    flex: none;
    border-radius: 10px;
    color: #fff;
    background: linear-gradient(135deg, #4098fc 0%, #2080f0 55%, #1668d6 100%);
    box-shadow: 0 4px 12px rgba(32, 128, 240, 0.32);
  }
}
</style>
