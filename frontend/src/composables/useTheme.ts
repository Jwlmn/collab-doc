import { computed } from 'vue'
import { useColorMode } from '@vueuse/core'

/** 主题偏好：auto = 跟随系统；设置页三态绑定的就是它 */
export type ThemeMode = 'auto' | 'light' | 'dark'

/**
 * 深浅色主题（三态：跟随系统 / 浅色 / 深色）。
 * - data-theme 属性 + storageKey 必须与 index.html 的内联防黑帧脚本一致，
 *   否则首帧会按旧主题闪一下再跳变（脚本对 'auto' 走 prefers-color-scheme 分支）。
 * - 顶栏快速切换写入显式 light/dark；回到「跟随系统」是设置页的职责。
 * - useColorMode 默认 modes（auto→''/light→'light'/dark→'dark'）正好是
 *   data-theme 的合法取值，无需覆写。
 */
export function useTheme() {
  const colorMode = useColorMode({
    attribute: 'data-theme',
    storageKey: 'collab-doc-theme',
  })

  /** 偏好（未解析）：设置页 radio 直接双向绑定 */
  const mode = computed<ThemeMode>({
    get: () => colorMode.store.value as ThemeMode,
    set: (value) => {
      colorMode.store.value = value
    },
  })

  /** 当前生效主题（auto 已解析为 light/dark） */
  const isDark = computed(() => colorMode.value === 'dark')

  /** 顶栏快速切换：落到显式 light/dark */
  function toggle(): void {
    mode.value = isDark.value ? 'light' : 'dark'
  }

  return { isDark, mode, toggle }
}
