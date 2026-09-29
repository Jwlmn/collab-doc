import { expect, test } from '@playwright/test'
import { registerRandomUser } from './helpers'

// 「行内 ⋯ → 删除 → 对话框确认」是移动端收纳布局（桌面是平铺按钮 + 气泡确认），
// 整条用例跑在移动视口下走这条交互路径
test.use({ viewport: { width: 390, height: 844 } })

test('删除进回收站 → 恢复 → 回列表可见', async ({ page }) => {
  const title = `E2E回收站${String(Date.now()).slice(-6)}`

  await registerRandomUser(page)

  // 新建 MD 文档并命名（新建后标题自动聚焦；改名走 PUT，等落库再离开）
  await page.getByRole('button', { name: /新建/ }).click()
  await page.getByText('MD 文档（富文本）').click()
  await expect(page).toHaveURL(/\/doc\/\d+/, { timeout: 15_000 })
  const renamed = page.waitForResponse(
    (r) => r.request().method() === 'PUT' && /\/api\/documents\/\d+$/.test(r.url()),
  )
  await page.getByPlaceholder('未命名文档').click()
  await page.keyboard.type(title)
  await page.keyboard.press('Enter')
  expect((await renamed).ok()).toBe(true)

  // 回列表 → 行内「⋯」菜单 → 删除
  await page.getByRole('button', { name: '返回文档列表' }).click()
  await expect(page).toHaveURL(/\/$/)
  const row = page.locator('.doc-list .n-list-item').filter({ hasText: title })
  await expect(row).toHaveCount(1)
  await row.getByRole('button', { name: '⋯（更多操作）' }).click()
  await page.locator('.n-dropdown-option', { hasText: '删除' }).click()

  // n-dialog 确认删除
  await expect(page.locator('.n-dialog')).toBeVisible()
  await page.locator('.n-dialog').getByRole('button', { name: '删除', exact: true }).click()
  await expect(row).toHaveCount(0)

  // 回收站里能找到被删的文档
  await page.goto('/trash')
  await expect(page.getByRole('heading', { name: '回收站' })).toBeVisible()
  const trashItem = page.locator('.trash-list .n-list-item').filter({ hasText: title })
  await expect(trashItem).toHaveCount(1)

  // 恢复 → 回收站清空
  await trashItem.getByRole('button', { name: '恢复', exact: true }).click()
  await expect(page.getByText('回收站是空的')).toBeVisible()

  // 回列表：文档回来了
  await page.getByRole('button', { name: '返回文档' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.locator('.doc-list .n-list-item').filter({ hasText: title })).toHaveCount(1)
})
