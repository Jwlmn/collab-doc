import { expect, test } from '@playwright/test'
import { registerRandomUser } from './helpers'

test('Excel 单元格合并 → 持久化 → 取消合并', async ({ page }) => {
  await registerRandomUser(page)

  // 新建 Excel 表格
  await page.getByRole('button', { name: /新建/ }).click()
  await page.getByText('Excel 表格（电子表格）').click()
  await expect(page).toHaveURL(/\/sheet\/\d+/, { timeout: 15_000 })

  const grid = page.locator('.grid-wrap')
  await expect(grid).toBeVisible()
  await page.bringToFront()

  const row0 = page.locator('.sheet-grid tbody tr').first()
  const cellA1 = row0.locator('td').nth(0)
  const cellB1 = row0.locator('td').nth(1)

  // 录入两个待合并的格（双击进入编辑 → 输入 → Enter 提交）。
  // 不用「点击后直接打字」：纯中文首键不产生 keydown 长度为 1 的事件，
  // 无法触发 startEdit（excel.spec 靠 ASCII 首字符才碰巧能走通）
  await cellA1.dblclick()
  await page.locator('input.cell-editor').fill('合并头')
  await page.keyboard.press('Enter')
  await expect(row0.locator('td').filter({ hasText: '合并头' })).toHaveCount(1)

  await cellB1.dblclick()
  await page.locator('input.cell-editor').fill('会被清空')
  await page.keyboard.press('Enter')
  await expect(row0.locator('td').filter({ hasText: '会被清空' })).toHaveCount(1)

  // 选中 A1:B1 → 点「合并」
  await cellA1.click()
  await cellB1.click({ modifiers: ['Shift'] })
  await page.getByRole('button', { name: /合并单元格/ }).click()

  // 合并生效：锚点挂 colspan=2，内容「仅保留左上角」
  const merged = page.locator('td[colspan="2"]')
  await expect(merged).toHaveCount(1)
  await expect(merged.filter({ hasText: '合并头' })).toHaveCount(1)
  await expect(row0.locator('td').filter({ hasText: '会被清空' })).toHaveCount(0)

  // 刷新持久（meta.merges 随 ydoc 进 document_states）
  await page.reload()
  await expect(page.locator('td[colspan="2"]')).toHaveCount(1, { timeout: 10_000 })
  await expect(page.getByText('✓ 已同步')).toBeVisible()

  // 点合并区 → 选区扩张到整块 → 按钮进入「取消合并」态
  await page.locator('td[colspan="2"]').click()
  const toggle = page.getByRole('button', { name: /合并单元格/ })
  await expect(toggle).toHaveClass(/n-button--primary-type/)

  // 再点 → 取消合并，网格恢复普通格
  await toggle.click()
  await expect(page.locator('td[colspan="2"]')).toHaveCount(0)
  await expect(row0.locator('td').nth(1)).toBeVisible()
})
