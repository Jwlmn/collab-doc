import { expect, type Page } from '@playwright/test'

/** 注册随机用户并落到文档列表（返回邮箱） */
export async function registerRandomUser(page: Page): Promise<string> {
  const email = `e2e+${Date.now()}${Math.floor(Math.random() * 1000)}@example.com`

  await page.goto('/register')
  await page.getByPlaceholder('你的昵称').fill(`E2E用户${String(Date.now()).slice(-5)}`)
  await page.getByPlaceholder('you@example.com').first().fill(email)
  const passwords = page.locator('input[type="password"]')
  await passwords.nth(0).fill('password123')
  await passwords.nth(1).fill('password123')
  // header 也有「注册」导航按钮，需限定在表单内（strict mode）
  await page.locator('form').getByRole('button', { name: '注册' }).click()

  await expect(page).toHaveURL(/\/$/, { timeout: 15_000 })
  await expect(page.getByRole('heading', { name: '文档' })).toBeVisible()
  return email
}
