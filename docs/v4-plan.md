# v4 开发计划 ——「让文档好管理，让界面有夜间模式」

> 状态：**进行中**（2026-09-30 立项）；✅ 第 1–6 项 已完成（深色模式 / 文档置顶 / 富文本增强 / PDF 打印导出 / 设置页 / 评论进阶，2026-09-30）
> 前情：v3（B1–B3 + 主线四）已基本收尾，仅剩 i18n 点单项；本计划聚焦「日常用得舒服」
> 质量基线：沿用现状（126 PHPUnit / 157 Vitest / Playwright E2E 8 组 / pint / vue-tsc 严格），测试按需本地手跑，**无 CI**

## 背景：扫描出的真实缺口

| 类别 | 缺口 | 现状证据 |
|------|------|----------|
| 信息架构 | 文档平铺，无收藏/置顶/文件夹/标签/排序 | `DocumentsView` 仅列表+搜索 |
| 评论 | 只有平铺的创建/删除，无回复、无「已解决」 | `CommentDrawer` |
| 主题 | 纯浅色，无 dark mode | `styles/theme.ts` 无主题切换 |
| 账户 | 无设置页（改密、资料、偏好全无） | 路由里无 settings |
| 富文本深度 | 无高亮/颜色/对齐/缩进，撤销重做无按钮 | `EditorToolbar` |
| 导出 | 无 PDF/打印样式 | 仅 md/docx/xlsx |
| 离线 | 断连即不可用，无 PWA/Service Worker | 依赖 HocusPocus 在线 |
| 其他 | i18n、Sentry、模板库、编辑器内 @提及 | roadmap 已标注 |

---

## 第一梯队：快赢（每个 0.5–1 天，按序执行）

- [x] **1. 深色模式** ✅（2026-09-30）⭐ UI 首选
  - `index.html` 双套 CSS 变量 + 首帧前内联脚本（localStorage `collab-doc-theme` → 跟随系统），零闪跳
  - `composables/useTheme.ts`（VueUse `useDark`，同一 storageKey）+ `ThemeToggle.vue` 复用组件
  - `theme.ts` 拆 light/dark 两套 Naive token（含 Layout 色对齐）；App.vue 按主题切 `darkTheme`
  - 全站硬编码色清扫：语义变量（`--text-*` / `--bg-*` / `--status-*` 等）；Tiptap 编辑区、Excel 网格（表头/选区/单元格默认字色）适配
  - Excel 单元格底色是用户数据，新增 `contrastInk()` 按背景亮度配墨水，深色下浅粉彩底自动配深字
  - 验证：vue-tsc / 157 Vitest / build / E2E 8 组全绿；深浅双主题截图像素取证通过（列表、MD、Excel 三页）
- [x] **2. 文档置顶 + 列表分区** ✅（2026-09-30）
  - 排序（最近更新/按标题）与视图偏好早已存在（P2-5），本项实为置顶
  - `document_pins` 独立表（user_id + document_id 唯一，按用户独立：A 置顶共享文档不影响 B）；外键级联清理，软删恢复后置顶保留
  - `POST /documents/{id}/pin {pinned}`（view 权限即可，任何成员置顶自己的视图）+ `DocumentResource.pinned`
  - 前端：列表/网格分区「置顶 / 全部文档」（组内沿用当前排序），行内与卡片脚注置顶按钮（📌，置顶后高亮）
  - 验证：PinTest 8 例（134 PHPUnit 全绿）+ pint 绿 + E2E 新增 pin.spec（9 组全绿）
- [x] **3. 富文本基础增强 + 撤销重做修复** ✅（2026-09-30）
  - 撤销/重做按钮 v0.9 就有，真正的问题是**结构性 Bug**：空文档首次输入把「段落+文字」
    整体入撤销栈 → 撤销连段落删 → y-sync 补默认空段落 → 重做恢复原文 → 重复段落。
    修复：编辑器创建前等首次同步落地，并在 UndoManager 之前种入骨架段落（不进撤销栈）
  - 新增扩展（`getBaseExtensions`，schema 唯一来源）：Highlight(multicolor)、
    TextStyle+Color、TextAlign(左/中/右)；**缩进暂缓**——tiptap v3 无一方包
  - 工具栏：高亮按钮(⌘⇧H)、文字色下拉、对齐 左/中/右；撤销/重做空栈置灰
  - 导出适配：.docx 支持高亮底色/文字色/段落对齐；.md 无对应语法按边界降级
  - 顺手修：标题输入抢打字被 meta 回填清空（焦点守卫）；帮助面板补 ⌘⇧H
  - 验证：vue-tsc / 157 Vitest / build / **E2E 10 组全绿**（新增 formatting.spec）
- [x] **4. PDF 导出 / 打印样式** ✅（2026-09-30）
  - `styles/main.css` 的 `@media print`：**翻转全站 CSS 变量成纸面配色**（一套变量同时治深浅
    两套主题），收掉顶栏/工具栏/抽屉/弹层，纸面拍平 + `@page` 页边距 + 分页礼仪（标题不断页等）
  - 编辑器加打印专用标题头（屏上隐藏）；导出菜单加「PDF（打印导出）」→ `window.print()`
  - Excel 同套打印样式（格式条隐藏、网格全量、用户单元格底色上纸），入口走浏览器 ⌘P
  - 不做后端 dompdf（中文排版坑多）；E2E print.spec 验证打印媒体下界面收敛（深色主题起步）
  - 验证：vue-tsc / 157 Vitest / build / **E2E 11 组全绿**

## 第二梯队：中型（各 1–3 天）

- [x] **5. 设置页** ✅（2026-09-30）
  - `/settings`（requiresAuth）三张卡片：个人资料（昵称 + 头像上传/移除，复用
    `POST /api/images`）、修改密码（`current_password` 校验）、外观三态（跟随系统/浅色/深色）
  - 后端：`PUT /api/user`（avatar_url 白名单校验仅允许本服务图片路径，拒绝外链）、
    `PUT /api/user/password`；`users.avatar_url` 迁移；UserResource 带 avatar_url
  - useTheme 重构成 `useColorMode` 三态（store 即偏好，`auto` 与防黑帧脚本天然兼容，
    同页多实例经 StorageEvent 同步）；顶栏用户菜单加「设置」+ 头像显示
  - 验证：ProfileTest 6 例（140 PHPUnit 全绿）+ pint 绿 + E2E 新增 settings.spec（12 组全绿）
- [x] **6. 评论进阶** ✅（2026-09-30）
  - 一层回复：`comments.parent_id`（根删级联删回复，对回复再回复压平挂回根）
  - 解决标记：`resolved_at`（仅根可操作）；抽屉默认折叠已解决线程 + 开关回看 +
    「N 条未解决」控制行；顶栏角标 = 未读数 + 未解决线程数
  - 编辑器内 @提及：自定义 **mention mark**（文字即 `@姓名`，md/docx 导出天然降级纯文本、
    搜索可命中）+ `@` 建议弹层（复用斜杠基建，**独立 pluginKey**——同名 key 会炸编辑器创建）
    + 选中即上报 `POST /documents/{id}/mentions`（`document_mentions` pivot 幂等去重，
    `DocumentMentionNotification` 站内通知，前端发起、不动协作服务器）
  - 弹层渲染抽成共享 `suggestion-popup.ts`（斜杠/提及同源）
  - 验证：CommentTest+12 / DocumentMentionTest 5 例（152 PHPUnit 全绿）+ pint 绿
    + E2E 新增 comments.spec（13 组全绿）
- [ ] **7. 文档模板**：新建时选「空白 / 会议纪要 / 周报 / 待办清单」，预置 Y.js 初始内容，复用现有管线
- [ ] **8. PWA（离线壳）**：manifest + Service Worker 缓存静态资源，Y.js 本地变更队列等重连回放——与 CRDT 架构天然一对

## 第三梯队：按需点单

- **i18n**（roadmap 唯一剩余主线项）——目标用户是中文圈可继续躺
- **Sentry / 错误上报**——上公网部署后再接
- **文件夹/标签**——等文档数量真实涨起来再做
- **Octane/Swoole、真机回归**——按部署节奏走

## 不建议做

- 管理后台 / 组织空间 / SSO——玩票项目撑不起量级
- 移动端原生 App——响应式 + PWA 已够

## 推荐落地顺序

1 深色模式 → 2 收藏置顶 → 3 工具栏增强 → 5 设置页，约一周，UI 观感和日常体验提升最明显；之后从第二梯队按兴趣挑（首选 PWA 离线）。
