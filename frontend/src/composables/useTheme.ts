import { useDark, useToggle } from '@vueuse/core'

/**
 * 深浅色主题切换。
 * - data-theme 属性 + storageKey 必须与 index.html 的内联防黑帧脚本一致，
 *   否则首帧会按旧主题闪一下再跳变。
 * - 默认跟随系统（auto），用户手动切换后 localStorage 覆盖系统偏好。
 */
export function useTheme() {
  const isDark = useDark({
    attribute: 'data-theme',
    valueDark: 'dark',
    valueLight: 'light',
    storageKey: 'collab-doc-theme',
  })
  const toggle = useToggle(isDark)
  return { isDark, toggle }
}
