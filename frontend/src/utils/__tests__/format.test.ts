import { describe, expect, it, vi, afterEach } from 'vitest'
import { formatRelativeTime, formatTime } from '../format'

afterEach(() => {
  vi.useRealTimers()
})

describe('formatTime', () => {
  it('空值与非法输入返回空串', () => {
    expect(formatTime(undefined)).toBe('')
    expect(formatTime(null)).toBe('')
    expect(formatTime('')).toBe('')
  })

  it('合法日期返回本地化字符串', () => {
    const out = formatTime('2026-09-23T10:30:00Z')
    expect(out).not.toBe('')
    expect(out).not.toContain('PM')
  })
})

describe('formatRelativeTime', () => {
  it('空值/非法日期返回空串', () => {
    expect(formatRelativeTime(undefined)).toBe('')
    expect(formatRelativeTime('not-a-date')).toBe('')
  })

  it('今天内返回 HH:MM', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T15:40:00'))
    expect(formatRelativeTime('2026-09-23T09:05:00')).toBe('09:05')
  })

  it('7 天内返回 N 天前', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T15:40:00'))
    expect(formatRelativeTime('2026-09-21T10:00:00')).toBe('2 天前')
  })

  it('更早回落绝对时间', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T15:40:00'))
    const out = formatRelativeTime('2026-01-01T10:00:00')
    expect(out).toContain('2026')
  })

  it('未来时间回落绝对时间', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-23T15:40:00'))
    const out = formatRelativeTime('2026-09-24T10:00:00')
    expect(out).not.toContain('天前')
    expect(out).not.toBe('')
  })
})
