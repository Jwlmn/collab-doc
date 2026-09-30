import { expect, test } from '@playwright/test'
import { registerRandomUser } from './helpers'

test('评论进阶：回复线程 / 解决折叠 / 编辑器 @提及上报通知', async ({ page, browser }) => {
  // 被提及者 B：独立上下文（同一上下文的 cookie 会互相顶掉登录态）
  const ctxB = await browser.newContext()
  const pageB = await ctxB.newPage()
  await registerRandomUser(pageB)
  // page.request 不自动带 Origin，Sanctum 不会启用 stateful 会话 → 显式补上
  const origin = 'http://localhost:5173'
  const bodyB = await (await pageB.request.get('/api/user', { headers: { Origin: origin } })).json()
  expect(bodyB.data, `B 拉取资料失败: ${JSON.stringify(bodyB)}`).toBeTruthy()
  const nameB = bodyB.data.name as string

  // A：文档所有者
  await registerRandomUser(page)
  await page.getByRole('button', { name: /新建/ }).click()
  await page.getByText('MD 文档（富文本）').click()
  await expect(page).toHaveURL(/\/doc\/\d+/, { timeout: 15_000 })
  const docId = Number(/\/doc\/(\d+)/.exec(page.url())![1])

  /* ---------------- 评论线程 ---------------- */

  await page.getByRole('button', { name: '评论', exact: true }).click()
  const commentInput = page.getByPlaceholder('输入评论，@ 可提及用户')

  // 根评论
  await commentInput.fill('这是根评论')
  await page.getByRole('button', { name: '发送评论' }).click()
  await expect(page.locator('.comment-item').filter({ hasText: '这是根评论' })).toBeVisible()

  // 回复 → 底部横幅 + 发送回复
  await page.locator('.thread-actions').getByRole('button', { name: '回复' }).click()
  await expect(page.locator('.reply-banner')).toContainText('正在回复')
  await commentInput.fill('这是一条回复')
  await page.getByRole('button', { name: '发送回复' }).click()
  await expect(page.locator('.comment-reply').filter({ hasText: '这是一条回复' })).toBeVisible()

  // 解决 → 线程折叠；显示已解决开关把它带回来
  await page
    .locator('.comment-item')
    .filter({ hasText: '这是根评论' })
    .getByRole('button', { name: '解决', exact: true })
    .click()
  await expect(page.locator('.comment-item')).toHaveCount(0)
  await expect(page.getByText('线程都已解决')).toBeVisible()

  await page.locator('.list-controls .n-switch').click()
  await expect(page.locator('.comment-item.resolved')).toBeVisible()
  await expect(page.locator('.comment-item').getByText('✓ 已解决')).toBeVisible()
  await expect(
    page.locator('.comment-item').getByRole('button', { name: '重新打开' }),
  ).toBeVisible()

  await page.locator('.n-drawer-header__close').click()

  /* ---------------- 编辑器 @提及 ---------------- */

  const search = await (
    await page.request.get('/api/users/search', { params: { q: nameB }, headers: { Origin: origin } })
  ).json()
  const userB = (search.data as Array<{ id: number; name: string }>).find((u) => u.name === nameB)
  expect(userB).toBeTruthy()

  const editor = page.locator('.ProseMirror')
  await editor.click()
  await page.keyboard.type('请看这里 @')
  await page.keyboard.type(nameB)

  // 建议弹层（debounce 150ms）→ Enter 选中
  const popup = page.locator('.slash-menu')
  await expect(popup).toBeVisible()
  await expect(popup).toContainText(nameB)

  const mentionWait = page.waitForResponse(
    (r) => r.request().method() === 'POST' && /\/api\/documents\/\d+\/mentions$/.test(r.url()),
  )
  await page.keyboard.press('Enter')
  const mentionRes = await mentionWait
  expect(mentionRes.ok()).toBe(true)
  expect((await mentionRes.json()).data.notified).toEqual([userB!.id])

  await expect(editor.locator('.doc-mention').filter({ hasText: nameB })).toHaveCount(1)

  /* ---------------- B 收到站内通知 ---------------- */

  const notifications = await (await pageB.request.get('/api/notifications', { headers: { Origin: origin } })).json()
  const hit = (notifications.data as Array<{ type: string; data: Record<string, unknown> }>).find(
    (n) => n.type.includes('DocumentMentionNotification') && n.data.document_id === docId,
  )
  expect(hit, 'B 应收到编辑器提及的站内通知').toBeTruthy()
  expect(hit!.data.actor_name).toBeTruthy()

  await ctxB.close()
})
