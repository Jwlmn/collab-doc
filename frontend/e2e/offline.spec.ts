import { expect, test } from '@playwright/test'
import { registerRandomUser } from './helpers'

test('离线续编：断网继续编辑，重连后本地变更回放并落库', async ({ page, context }) => {
  await registerRandomUser(page)

  await page.getByRole('button', { name: /新建/ }).click()
  await page.getByText('MD 文档（富文本）').click()
  await expect(page).toHaveURL(/\/doc\/\d+/, { timeout: 15_000 })

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('在线内容')
  await expect(editor).toContainText('在线内容')

  // 断网后编辑器继续可用（Y.js 本地排队）。注意：空闲的 WebSocket 不会因
  // 断网立刻收到断开事件，写入失败时 provider 才察觉并转「同步中…」
  await context.setOffline(true)
  await editor.click()
  await page.keyboard.type(' 离线追加内容')
  await expect(editor).toContainText('离线追加内容')
  await expect(page.getByText('同步中…')).toBeVisible({ timeout: 15_000 })

  // 恢复网络：y-websocket 自动重连，把离线期间的变更整体回放
  await context.setOffline(false)
  await expect(page.getByText('✓ 已同步')).toBeVisible({ timeout: 30_000 })

  // 刷新走服务端状态：回放过的离线内容必须还在
  await page.reload()
  await expect(page).toHaveURL(/\/doc\/\d+/, { timeout: 15_000 })
  await expect(editor).toContainText('在线内容', { timeout: 15_000 })
  await expect(editor).toContainText('离线追加内容')
})
