/**
 * 协作服务器地址：
 * - 开发：VITE_COLLAB_URL 显式配置，未配置则直连本机 1234
 * - 生产：同源 `/collab` 路径（由 nginx 做 WebSocket 反代到 HocusPocus）
 */
export function getCollabUrl(): string {
  const configured = import.meta.env.VITE_COLLAB_URL
  if (configured) return configured
  if (import.meta.env.DEV) return 'ws://127.0.0.1:1234'

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/collab`
}
