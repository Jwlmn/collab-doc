import { expect, test } from '@playwright/test'
import { registerRandomUser } from './helpers'

test('语言切换：设置页切到 English，界面与标签页标题联动，切回中文复原', async ({ page }) => {
  await registerRandomUser(page)

  // 进设置页
  await page.locator('.user-btn').click()
  await page.locator('.n-dropdown-option', { hasText: '设置' }).click()
  await expect(page).toHaveURL(/\/settings/)
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()

  // 切 English：卡片标题与按钮立即变英文，标签页标题与 lang 属性联动
  await page.locator('.n-radio', { hasText: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.getByText('Profile', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save' })).toBeVisible()
  await expect(page).toHaveTitle('Settings · Collab Docs')
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  // 外壳联动：顶栏品牌与语言选项提示
  await expect(page.locator('.brand')).toHaveText('Collab Docs')

  // 刷新后语言持久化（localStorage）
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
  await expect(page.locator('html')).toHaveAttribute('lang', 'en')

  // 切回中文：为后续用例与默认语言复原
  await page.locator('.n-radio', { hasText: '简体中文' }).click()
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()
  await expect(page).toHaveTitle('设置 · 多人实时协作文档')
  await expect(page.locator('html')).toHaveAttribute('lang', 'zh-CN')
})
