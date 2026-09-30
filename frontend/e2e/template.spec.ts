import { expect, test } from '@playwright/test'
import { registerRandomUser } from './helpers'

test('文档模板：会议纪要预置结构与标题，刷新后种子仍在', async ({ page }) => {
  await registerRandomUser(page)

  // 新建 ▾ → 会议纪要（模板）
  await page.getByRole('button', { name: /新建/ }).click()
  await page.locator('.n-dropdown-option', { hasText: '会议纪要（模板）' }).click()
  await expect(page).toHaveURL(/\/doc\/\d+/, { timeout: 15_000 })

  // 标题即模板名
  await expect(page.getByPlaceholder('未命名文档')).toHaveValue('会议纪要')

  // 种子内容（协同首帧后经 importFlow 写入）
  const editor = page.locator('.ProseMirror')
  await expect(editor).toContainText('参会人员')
  await expect(editor).toContainText('决议事项')
  await expect(editor).toContainText('[ ] 待办一')

  // 刷新后内容仍在（种子经 Y.js 同步落库）
  await page.reload()
  await expect(editor).toContainText('会议内容', { timeout: 15_000 })
})
