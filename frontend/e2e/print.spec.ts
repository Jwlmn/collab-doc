import { expect, test } from '@playwright/test'
import { registerRandomUser } from './helpers'

test('打印导出 PDF：菜单入口 + 打印媒体下收敛为纸面（与屏幕主题无关）', async ({ page }) => {
  await registerRandomUser(page)

  // 深色主题起步：打印配色必须与屏幕主题无关
  await page.evaluate(() => localStorage.setItem('collab-doc-theme', 'dark'))
  await page.reload()
  await expect(page.getByRole('heading', { name: '文档' })).toBeVisible()

  await page.getByRole('button', { name: /新建/ }).click()
  await page.getByText('MD 文档（富文本）').click()
  await expect(page).toHaveURL(/\/doc\/\d+/, { timeout: 15_000 })

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('打印导出验证内容')

  // 导出菜单含 PDF 入口
  await page.getByRole('button', { name: '导出' }).click()
  await expect(page.locator('.n-dropdown-option', { hasText: 'PDF' })).toBeVisible()
  await page.keyboard.press('Escape')

  // 打印媒体：界面收敛 —— 顶栏/工具栏隐藏、标题头出现、正文为纯黑
  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('.editor-topbar')).toBeHidden()
  await expect(page.locator('.fmt-toolbar')).toBeHidden()
  await expect(page.locator('.print-header')).toBeVisible()
  await expect(page.locator('.print-header h1')).toContainText('未命名文档')
  await expect(page.locator('.doc-editor-content')).toHaveCSS('color', 'rgb(0, 0, 0)')
  await expect(page.locator('.editor-surface')).toHaveCSS('box-shadow', 'none')
  await page.emulateMedia({ media: 'screen' })
})
