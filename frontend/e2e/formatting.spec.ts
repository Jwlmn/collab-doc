import { expect, test } from '@playwright/test'
import { registerRandomUser } from './helpers'

test('富文本增强：高亮 / 撤销重做 / 对齐 / 文字色', async ({ page }) => {
  await registerRandomUser(page)

  await page.getByRole('button', { name: /新建/ }).click()
  await page.getByText('MD 文档（富文本）').click()
  await expect(page).toHaveURL(/\/doc\/\d+/, { timeout: 15_000 })

  const editor = page.locator('.ProseMirror')
  const undoButton = page.getByRole('button', { name: '↶（撤销）' })
  const redoButton = page.getByRole('button', { name: '↷（重做）' })

  // 空文档无可撤销操作 → 两个按钮置灰
  await expect(undoButton).toBeDisabled()
  await expect(redoButton).toBeDisabled()

  await editor.click()
  await page.keyboard.type('富文本验证内容')
  await expect(undoButton).toBeEnabled()

  // 全选后加高亮 → 渲染出 <mark>
  await page.keyboard.press('ControlOrMeta+a')
  await page.getByRole('button', { name: '高亮' }).click()
  await expect(editor.locator('mark')).toHaveCount(1)
  await expect(editor.locator('mark')).toContainText('富文本验证内容')

  // 撤销 → 高亮消失；重做 → 回来
  await undoButton.click()
  await expect(editor.locator('mark')).toHaveCount(0)
  await expect(redoButton).toBeEnabled()
  await redoButton.click()
  await expect(editor.locator('mark')).toHaveCount(1)

  // 居中对齐 → 段落文本居中（光标落回段落即可，不需要选区）
  await editor.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.getByRole('button', { name: '居中对齐' }).click()
  await expect(editor.locator('p').first()).toHaveCSS('text-align', 'center')

  // 文字色：下拉选第二个色（#d03050）→ 行内 span 上色
  await page.keyboard.press('ControlOrMeta+a')
  await page.getByRole('button', { name: '文字色（文字颜色）' }).click()
  await page.locator('.n-dropdown-option').filter({ hasText: 'A' }).nth(1).click()
  await expect(editor.locator('span[style*="color"]')).toHaveCSS('color', 'rgb(208, 48, 80)')
})
