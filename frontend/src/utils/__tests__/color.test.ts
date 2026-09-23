import { describe, expect, it } from 'vitest'
import { hashToIndex, userColor } from '../color'

describe('userColor', () => {
  it('同名恒定同色', () => {
    expect(userColor('张三')).toBe(userColor('张三'))
  })

  it('匿名/空值回落首个颜色且不抛错', () => {
    expect(userColor(null)).toBe(userColor('匿名'))
    expect(userColor(undefined)).toBe(userColor('匿名'))
  })

  it('下标始终在调色板范围内', () => {
    expect(hashToIndex('')).toBeGreaterThanOrEqual(0)
    expect(hashToIndex('a very long user name 12345')).toBeLessThan(7)
  })
})
