/*
 * 应用壳 Service Worker（仅生产构建注册，见 src/main.ts）。
 *
 * 策略：
 * - 导航（页面）：网络优先，断网回退缓存的 index.html —— SPA 路由离线可启动
 * - 静态资源（/assets/* 等带 hash 的不可变文件）：缓存优先，首次在线访问即填充
 * - /api/*：一律不缓存（登录态、实时数据走网络；离线时让请求自然失败）
 * - WebSocket（/collab）不经 fetch 事件，由 y-websocket 自己重连回放
 */

const CACHE = 'collab-doc-shell-v1'
const SHELL = ['/', '/index.html']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // 只接管同源；跨域（若有）走浏览器默认
  if (url.origin !== self.location.origin) return
  // API 永不缓存：缓存登录态/文档列表会制造「幽灵数据」
  if (url.pathname.startsWith('/api')) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put('/index.html', copy))
          return response
        })
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  event.respondWith(
    caches.match(request).then(
      (hit) =>
        hit ||
        fetch(request).then((response) => {
          if (response.ok) {
            const copy = response.clone()
            caches.open(CACHE).then((cache) => cache.put(request, copy))
          }
          return response
        }),
    ),
  )
})
