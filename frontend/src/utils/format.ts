/** 绝对时间（本地化，24 小时制）；空值返回空串 */
export function formatTime(value?: string | null): string {
  if (!value) return ''
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

/**
 * 相对时间：今天内「HH:MM」、7 天内「N 天前」、更早回落绝对时间。
 * 非法日期返回空串。
 */
export function formatRelativeTime(value?: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  if (diffMs < 0) return formatTime(value)

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (date.getTime() >= startOfToday) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  }

  const days = Math.floor((startOfToday - date.getTime()) / 86_400_000) + 1
  if (days <= 7) return `${days} 天前`

  return formatTime(value)
}
