import { expect, test } from '@playwright/test'
import { registerRandomUser } from './helpers'

test('设置页：改昵称同步顶栏头像栏 / 三态主题 / 改密码校验', async ({ page }) => {
  await registerRandomUser(page)

  // 顶栏用户菜单 → 设置
  await page.locator('.user-btn').click()
  await page.locator('.n-dropdown-option', { hasText: '设置' }).click()
  await expect(page).toHaveURL(/\/settings/)
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()

  // 昵称：保存后顶栏立即同步
  await page.getByPlaceholder('你的昵称').fill('设置页新昵称')
  await page.getByRole('button', { name: '保存' }).click()
  await expect(page.locator('.user-btn')).toContainText('设置页新昵称')

  // 三态主题：深色 → data-theme=dark（跨实例同步：顶栏与 naive 主题同源）
  await page.locator('.n-radio', { hasText: '深色' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')

  // 跟随系统（headless 默认浅色方案）→ 解析为 light，且持久化为 auto
  await page.locator('.n-radio', { hasText: '跟随系统' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')

  // 手动深色后刷新：防黑帧脚本按存储恢复 dark（不闪浅色）
  await page.locator('.n-radio', { hasText: '深色' }).click()
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark', { timeout: 10_000 })
  await expect(page.getByRole('heading', { name: '设置' })).toBeVisible()

  // 密码：当前密码错误 → 报错；正确 → 成功且表单清空
  await page.getByPlaceholder('请输入当前密码').fill('wrong-current-pass')
  await page.getByPlaceholder('至少 8 位').fill('brand-new-pass-123')
  await page.getByPlaceholder('再次输入新密码').fill('brand-new-pass-123')
  await page.getByRole('button', { name: '更新密码' }).click()
  await expect(page.locator('.n-message').first()).toBeVisible()

  await page.getByPlaceholder('请输入当前密码').fill('password123')
  await page.getByRole('button', { name: '更新密码' }).click()
  await expect(page.locator('.n-message').first()).toContainText('密码已更新')
  await expect(page.getByPlaceholder('请输入当前密码')).toHaveValue('')
})
