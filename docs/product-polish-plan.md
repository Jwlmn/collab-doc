# 产品打磨计划（前端页面 · 操作逻辑）

> 状态：**🎉 全部完成（P0 + P1 + P2 共 18 项）**，桌面 / 390×844 移动 / 深色三重视口浏览器验收通过
> 创建：2026-09-22
> 前置：里程碑 M1–M9 已全部完成，后端 64 测试 / 前端 13 单测全绿
> 原则：全部基于现有 Naive UI + 组件结构**增量改造**，不换库、不改后端 API

---

## 一、现状诊断（按用户旅程）

| 旅程 | 现状问题 | 严重度 |
|------|----------|--------|
| 首次进入 | 空状态只有一行文字，没有行动按钮；favicon/页签标题还是 Vite 默认 | 中 |
| 新建文档 | 新建 → 生成「未命名文档」→ **停在列表** → 手动打开 → 再改名，三步才能开始写 | **高** |
| 编辑器写作 | **没有任何格式工具栏** — StarterKit 装了加粗/标题/列表但 UI 零入口；撤销重做无按钮 | **高** |
| 编辑器状态 | 连接状态/在线人数常驻占位；无「内容已同步」提示；标题可编辑无暗示 | 中 |
| 在线协作者 | 只有「N 人在线」文字，与光标颜色无关联，看不到是谁在线 | 中 |
| 搜索 | 无快捷键（`/` / `Cmd+K`），无结果计数 | 中 |
| 评论/版本 | 抽屉无快捷键；评论 `Ctrl+Enter 发送` 不可发现；两抽屉可同时打开 | 中 |
| 共享 | 只能按邮箱添加；编辑器内无共享入口（必须回列表） | 低 |
| 页面骨架 | 无路由过渡动画、无 404 页；小屏下 420px 固定抽屉/工具栏溢出 | 中 |
| 可访问性 | 表单字段缺 `id/name`（浏览器已有警告）；纯图标按钮缺 `aria-label` | 低 |

## 二、打磨原则

1. **少一步是一步** — 能直达的操作不让人二次跳转
2. **能力可见** — 装了的功能必须有入口（格式栏、撤销重做）
3. **状态安心** — 写作产品的信任来自「谁在写、是否已同步」
4. **键盘优先** — 高频操作全部可键盘完成
5. **增量改造** — 不推倒重来，不动后端 API 契约

---

## 三、P0 — 核心操作流（第一批）

### P0-1 编辑器格式工具栏 ⭐ 最高价值 ✅ 已完成
- [x] 工具栏置于纸面卡片顶部吸顶：加粗 / 斜体 / 删除线 / H1–H3 / 引用 / 有序·无序列表 / 代码块 / 分隔线
- [x] 按钮激活态绑定 `editor.isActive(...)`（`transaction` 事件驱动 tick 刷新）
- [x] BubbleMenu：选中文字浮出 加粗/斜体/删除线/链接（`@tiptap/extension-bubble-menu` 扩展形态，element 传入内联容器）
- [x] 撤销/重做按钮接入 Collaboration 的 `undo/redo` 命令（Y.UndoManager）
- 实现：`components/EditorToolbar.vue` + `DocEditorView.vue` 内联气泡菜单；踩坑：气泡插件用 `visibility` 控显隐，容器 CSS 不可设 `display:none`

### P0-2 新建即进入 ✅ 已完成
- [x] 点「新建」→ 创建成功后直接 `router.push('/doc/{id}?new=1')`
- [x] 进入编辑器后标题自动聚焦并全选；聚焦后 `router.replace` 清掉 query（刷新不重复触发）
- 实现：`DocumentsView.vue`、`DocEditorView.vue`

### P0-3 页面元信息 ✅ 已完成
- [x] `document.title` 随路由（afterEach）与文档标题（watch meta）变化，离开编辑器时还原
- [x] favicon 替换为品牌 SVG（蓝底文档 + 绿点）；`lang="zh-CN"`；默认标题「多人实时协作文档」
- 实现：`index.html`、`public/favicon.svg`、`router/index.ts`、`DocEditorView.vue`

### P0-4 404 与路由收尾 ✅ 已完成
- [x] catch-all 路由 → `n-result` 404 页（「回到文档列表」「返回上一页」）
- [x] 路由切换 fade 过渡（App.vue transition out-in）；`scrollBehavior` 回顶
- 实现：`router/index.ts`、`views/NotFoundView.vue`、`App.vue`、`styles/main.css`

### P0-5 同步安心感 ✅ 已完成
- [x] 已同步显示低调「✓ 已同步」；本地有未确认变更时「同步中…」（`synced` + `hasUnsyncedChanges` 事件驱动）
- [x] 仅断连/重连中显示彩色状态；在线人数文本改为 P1-1 头像堆
- 实现：`DocEditorView.vue`

---

## 四、P1 — 体验细节（第二批）

- [x] **P1-1 协作者头像堆**：工具栏右侧重叠头像（首字 + awareness 颜色，按名字去重，>4 显示 +N），点击弹出成员名单
- [x] **P1-2 快捷键体系**：`/` 或 `Cmd+K` 聚焦搜索（列表页，preventDefault 防串字符）；`Esc` 由 Naive 模态/抽屉默认分层处理；编辑器 `Cmd+Enter` 打开评论抽屉并自动聚焦输入框；`?` 非输入态弹快捷键说明（编辑态不拦截，工具栏 `?` 按钮兜底）
- [x] **P1-3 评论抽屉细节**：输入框下常驻「Ctrl / ⌘ + Enter 发送」提示；抽屉打开自动聚焦；发送后列表滚到新评论（`listWrapRef` scrollTop，列表区 `max-height:55vh; overflow-y:auto`）
- [x] **P1-4 响应式**：`useIsMobile` composable（<768px）—— 版本/评论抽屉全宽（`width: '100%'`）、列表操作收进「⋯」菜单（删除改 `n-dialog` 确认，App.vue 已加 DialogProvider）、列表头部/编辑器顶栏 flex-wrap、标题宽度 `min(320px, 42vw)`、预览弹窗 `min(720px, 92vw)`；390×844 视口截图验收
- [x] **P1-5 加载与空态**：列表初始加载 3 条骨架屏（`n-skeleton`）、编辑器纸面骨架（标题条 + 5 行文本）、空状态 CTA「创建第一篇文档」
- [x] **P1-6 可访问性**：新控件 `aria-label` 齐全；登录/注册表单补 `name="email|password|name|password_confirmation|remember"`、搜索框 `name="document-search"`（消除浏览器警告）
- [x] **P1-7 标题编辑暗示**：标题输入默认透明边框、hover 显浅边框、聚焦高亮；只读显示「🔒 只读」
- [x] **P1-8 共享入口收敛**：编辑器顶栏「共享」按钮（仅 owner 显示）复用 `ShareModal`；列表项成员头像叠堆（`DocumentResource` 新增 `members` 摘要字段 + `members.user` eager load，所有者+成员按 id 去重 >4 折叠 +N）

## 五、P2 — 进阶 ✅ 全部完成

- [x] ~~**深色模式**~~ **已按需求移除（暂不支持深色，固定浅色）**：曾实现 useOsTheme 跟随系统 + CSS 变量切换，后因刷新闪黑问题排查需要，应用户要求整体移除；防黑帧方案保留（`index.html` 内联浅色变量 + `html` 内联背景 + `color-scheme: light`）
- [x] **斜杠命令**：`@tiptap/suggestion` + 纯 DOM 弹层 `extensions/slash-command.ts`（8 项：H1-3/列表×2/引用/代码块/分割线），↑↓ 导航、Enter 执行、Esc 关闭；`allowedPrefixes: null` 允许中文任意位置触发；只读模式不注册；顺带修复 StarterKit v3 内置 Link 重复注册告警
- [x] **评论未读徽标**：`document_last_reads` 水位表（按文档+用户，只进不退）；`GET unread` / `POST read` 接口；工具栏评论按钮 `n-badge`，抽屉打开自动标记并清零；6 个测试
- [x] **复制邀请链接**：HMAC 无状态邀请令牌（`invite:` 前缀防跨用途重放）；ShareModal 一键复制（剪贴板失败降级 prompt）；`/invite/:token` 落地页接受后默认只读成员，重复接受幂等；6 个测试
- [x] **列表视图偏好**：排序（最近更新/按标题）+ 列表/网格视图切换，localStorage（`collab-doc.listPrefs`）持久化；网格卡片含徽章/头像/⋯ 菜单

---

## 六、执行顺序与验收

**批次**：
```
第一批 P0（约 1–2 个工作日当量）
  P0-1 格式工具栏 → P0-2 新建即进入 → P0-3 元信息 → P0-4 404/过渡 → P0-5 同步状态
第二批 P1（按性价比）
  P1-2 快捷键 → P1-1 头像堆 → P1-5 空态骨架 → P1-8 共享入口 → P1-4 响应式 → 其余
第三批 P2 按需
```

**验收标准**（沿用项目惯例）：
1. 每项完成后 Chrome DevTools 真实浏览器走查（含双标签协同场景）
2. P0-1 附加断言：加粗按钮与 `editor.isActive('bold')` 状态一致
3. 回归保持全绿：`npm test`（13 单测）、`vue-tsc`、`vite build`、后端 `php artisan test`（75 测试）
4. P1-4 增加移动端视口（390×844）截图走查

**执行记录**：
- 第一批（2026-09-22）：P0 全部 + P1-1 + P1-2 —— 桌面浏览器验收通过
- 第三批（2026-09-22）：P2 全部 5 项 —— 深色/斜杠/未读徽标/邀请链接/列表偏好逐项浏览器验收；回归基线升至后端 75 PHPUnit / 前端 13 Vitest / 三端 tsc+build 全绿
- 第二批（2026-09-22）：P1 其余全部（3/4/5/6/7/8 收尾）—— 桌面 + 390×844 移动视口双验收
- 质量基线：后端 64 PHPUnit / 前端 13 Vitest / 三端 tsc + 构建全绿
- 待点单：P2 五项
