import { expect, test } from '@playwright/test'
import { registerRandomUser } from './helpers'

test('注册 → 新建 MD 文档 → 富文本编辑 → 内容搜索命中', async ({ page }) => {
  await registerRandomUser(page)

  // 新建 ▾ → MD 文档 → 直达编辑器
  await page.getByRole('button', { name: /新建/ }).click()
  await page.getByText('MD 文档（富文本）').click()
  await expect(page).toHaveURL(/\/doc\/\d+/, { timeout: 15_000 })

  // 编辑器就绪：标题自动聚焦 + 格式工具栏存在
  const title = page.getByPlaceholder('未命名文档')
  await expect(title).toBeVisible()
  await expect(page.getByRole('button', { name: '加粗' })).toBeVisible()

  // 输入内容并确认渲染
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('E2E 协同冒烟内容')
  await expect(page.locator('.ProseMirror')).toContainText('E2E 协同冒烟内容')

  // 回列表，内容全文搜索（等待协作服务器抽取索引，带重试）
  await page.getByRole('button', { name: '返回文档列表' }).click()
  await expect(page).toHaveURL(/\/$/)
  await page.getByPlaceholder(/搜索标题/).fill('E2E 协同冒烟')
  await expect(page.getByRole('heading', { name: '搜索结果' })).toBeVisible()
  await expect(page.locator('.doc-list .n-list-item')).toHaveCount(1, { timeout: 10_000 })
})
