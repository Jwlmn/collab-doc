import { expect, test } from '@playwright/test'
import { registerRandomUser } from './helpers'

test('手动保存命名版本 → 改写内容 → 恢复版本（可逆）', async ({ page }) => {
  await registerRandomUser(page)

  // 新建 MD 文档，写入初稿内容
  await page.getByRole('button', { name: /新建/ }).click()
  await page.getByText('MD 文档（富文本）').click()
  await expect(page).toHaveURL(/\/doc\/\d+/, { timeout: 15_000 })
  await page.locator('.ProseMirror').click()
  await page.keyboard.type('E2E 版本初稿内容')
  await expect(page.locator('.ProseMirror')).toContainText('E2E 版本初稿内容')
  await expect(page.getByText('✓ 已同步')).toBeVisible({ timeout: 15_000 })

  // 版本历史抽屉 → 显式手动快照（避开 60s 静默期自动快照的竞态）
  await page.getByRole('button', { name: '版本历史' }).click()
  await expect(page.getByPlaceholder('版本名称（可选，如：初稿）')).toBeVisible()
  await page.getByPlaceholder('版本名称（可选，如：初稿）').fill('E2E-初稿')
  await page.getByRole('button', { name: '保存当前版本' }).click()
  await expect(
    page.locator('.version-list .n-list-item').filter({ hasText: 'E2E-初稿' }),
  ).toHaveCount(1)

  // 关抽屉，把内容整个改写掉
  await page.locator('.n-drawer-header__close').click()
  await expect(page.getByPlaceholder('版本名称（可选，如：初稿）')).toBeHidden()
  await page.locator('.ProseMirror').click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('E2E 改写后的内容')
  await expect(page.locator('.ProseMirror')).toContainText('E2E 改写后的内容')
  await expect(page.locator('.ProseMirror')).not.toContainText('E2E 版本初稿内容')

  // 打开版本历史 → 恢复命名版本（需对话框确认）
  await page.getByRole('button', { name: '版本历史' }).click()
  const draftItem = page.locator('.version-list .n-list-item').filter({ hasText: 'E2E-初稿' })
  await draftItem.getByRole('button', { name: '恢复', exact: true }).click()
  await page.locator('.n-dialog').getByRole('button', { name: '恢复', exact: true }).click()

  // 初稿内容回来、改写内容消失（恢复是双向可逆的：恢复前自动留备份）
  await expect(page.locator('.ProseMirror')).toContainText('E2E 版本初稿内容', { timeout: 10_000 })
  await expect(page.locator('.ProseMirror')).not.toContainText('E2E 改写后的内容')
  // 恢复完成抽屉自动关闭
  await expect(page.getByPlaceholder('版本名称（可选，如：初稿）')).toBeHidden()
})
