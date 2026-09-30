import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { router } from './router'
import { i18n } from './i18n'
import App from './App.vue'
import './styles/main.css'

const app = createApp(App)

app.use(createPinia())
app.use(i18n)
app.use(router)
app.mount('#app')

// 语言与主题一样在首帧前定好（i18n locale 来自 localStorage），同步 lang 属性
document.documentElement.lang = i18n.global.locale.value

// PWA 应用壳：仅生产注册（开发下缓存会干扰 HMR 与 Vite 依赖预构建）。
// 离线续编的「变更回放」不在此处——y-websocket 断线期间本地排队、重连自动同步。
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('[pwa] Service Worker 注册失败', error)
    })
  })
}
