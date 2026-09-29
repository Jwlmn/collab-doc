import { expect, type Page, test } from '@playwright/test'

/** 注册随机用户并落到文档列表（返回邮箱） */
export async function registerRandomUser(page: Page): Promise<string> {
  const email = `e2e+${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`

  await page.goto('/register')
  await page.getByPlaceholder('你的昵称').fill(`E2E用户${String(Date.now()).slice(-5)}`)
  await page.getByPlaceholder('you@example.com').first().fill(email)
  const passwords = page.locator('input[type="password"]')
  await passwords.nth(0).fill('password123')
  await passwords.nth(1).fill('password123')

  const submit = page.locator('form').getByRole('button', { name: '注册' })

  /**
   * POST /api/register 是 throttle:10,1（每 IP 每分钟 10 次）。
   * 一轮套件 8 个 spec 各注册一次，单轮安全；但一分钟内背靠背跑两轮
   * 会撞 429（此前表现为注册处莫名其妙的 URL 超时）。撞了就等一个
   * 限流窗口再重试一次，并把本测试超时拉到 150s 覆盖等待。
   */
  const waitForRegister = () =>
    page.waitForResponse(
      (r) => r.url().includes('/api/register') && r.request().method() === 'POST',
    )

  let waiting = waitForRegister()
  await submit.click()
  let response = await waiting

  if (response.status() === 429) {
    test.info().setTimeout(150_000)
    await page.waitForTimeout(61_000) // 等限流窗口彻底翻页
    waiting = waitForRegister()
    await submit.click()
    response = await waiting
  }
  expect(response.status(), `注册接口返回 ${response.status()}`).toBeLessThan(400)

  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: '文档' })).toBeVisible()
  return email
}
