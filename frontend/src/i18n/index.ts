import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN'
import en from './locales/en'

export const LOCALE_STORAGE_KEY = 'collab-doc-locale'

export type AppLocale = 'zh-CN' | 'en'

/** 读取持久化语言（首次访问默认中文——E2E 与既有用户均为 zh 文案） */
export function readStoredLocale(): AppLocale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (stored === 'en' || stored === 'zh-CN') return stored
  } catch {
    /* 隐私模式等异常回退默认 */
  }
  return 'zh-CN'
}

/**
 * 全局 i18n 实例。
 * - legacy:false： Composition API 模式；globalInjection 让模板直接用 $t（无需逐文件 useI18n）
 * - fallbackLocale 'zh-CN'：en 缺键时回落中文而不是显示键名
 * - zh 文案与抽离前的硬编码逐字一致（E2E 选择器依赖）
 */
export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: readStoredLocale(),
  fallbackLocale: 'zh-CN',
  messages: { 'zh-CN': zhCN, en },
})

export function setLocale(locale: AppLocale): void {
  i18n.global.locale.value = locale
  document.documentElement.lang = locale
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch {
    /* 持久化失败不影响当前会话 */
  }
}
