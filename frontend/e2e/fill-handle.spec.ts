import { expect, test } from '@playwright/test'
import { registerRandomUser } from './helpers'

test('填充柄拖拽扩展选区（触屏扩选同一代码路径）', async ({ page }) => {
  await registerRandomUser(page)

  await page.getByRole('button', { name: /新建/ }).click()
  await page.getByText('Excel 表格（电子表格）').click()
  await expect(page).toHaveURL(/\/sheet\/\d+/, { timeout: 15_000 })

  // 选中 A1 → 填充柄出现在选区右下角
  const cellA1 = page.locator('td[data-r="0"][data-c="0"]')
  await cellA1.click()
  const handle = page.getByRole('button', { name: '拖动扩展选区' })
  await expect(handle).toBeVisible()

  // 从填充柄拖到 C3 → 选区 A1:C3 = 9 格
  const box = await handle.boundingBox()
  expect(box).not.toBeNull()
  const target = page.locator('td[data-r="2"][data-c="2"]')
  const tbox = await target.boundingBox()
  expect(tbox).not.toBeNull()

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2)
  await page.mouse.down()
  await page.mouse.move(tbox!.x + tbox!.width / 2, tbox!.y + tbox!.height / 2, { steps: 8 })
  await page.mouse.up()

  await expect(page.getByText('（9 格）')).toBeVisible()

  // 单击收回单格选区，填充柄仍在（Excel 行为）
  await cellA1.click()
  await expect(page.getByText('（9 格）')).toHaveCount(0)
  await expect(handle).toBeVisible()
})
