# v4 开发计划 ——「让文档好管理，让界面有夜间模式」

> 状态：**第一、二梯队全部完成**（2026-09-30，第 1–8 项）；第三梯队已点单：✅ i18n（三梯队 #1）、✅ 文件夹（#3），其余按需
> ✅ 1 深色模式 · 2 文档置顶 · 3 富文本增强 · 4 PDF 打印导出 · 5 设置页 · 6 评论进阶 · 7 文档模板 · 8 PWA 离线壳 · 9 i18n · 10 文件夹
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
- [x] **7. 文档模板** ✅（2026-09-30）
  - `io/templates.ts`：会议纪要 / 周报 / 待办清单三个模板（Tiptap JSON 种子，
    节点只用 StarterKit 现有类型，待办用 `[ ]` 文本前缀——md 导出导入天然往返，零新依赖）
  - 复用 importFlow 管线（创建空文档带标题 → 跳编辑器 → 协同首帧 setContent），
    新建 ▾ 菜单分隔线后三项入口
  - 单测：`getSchema(getBaseExtensions())` 对每个模板 `nodeFromJSON + check()` 结构校验
  - 验证：templates 4 例（161 Vitest 全绿）+ E2E template.spec（14 组全绿）
- [x] **8. PWA（离线壳）** ✅（2026-09-30）——**第二梯队收官**
  - 手写 SW（`public/sw.js`，零新依赖）：导航网络优先 + 断网回退壳、静态资源缓存优先、
    `/api/*` 永不缓存（防幽灵数据）；仅生产注册（开发缓存会干扰 HMR）
  - `manifest.webmanifest` + 图标三件套（192/512/maskable，由 favicon SVG 经 Playwright 渲染生成）
  - **离线续编 E2E**（offline.spec）：断网 → 继续编辑（本地可见、下次写入才察觉断网）→
    重连自动回放 → 刷新落库，CRDT 承诺端到端验证
  - SW 对生产构建（vite preview）实测：离线冷启动首页与深链接壳均完整渲染
  - 已知边界：Y.js 变更仅内存排队（未接 y-indexeddb）——断网期间**关页**会丢未同步内容；
    离线冷启动拉具体文档需 API 缓存层，按需再点
  - 验证：vue-tsc / 161 Vitest / build / **E2E 15 组全绿**

## 第三梯队：按需点单

- [x] **i18n（文案抽离）** ✅（2026-09-30）——roadmap 唯一剩余主线项收官
  - vue-i18n（legacy:false + globalInjection，模板 `$t` 零 import）+ `zh-CN`/`en` 双语，
    **en 以 `typeof zhCN` 定型**——漏键/多键直接编译报错，翻译完整性由 vue-tsc 把关
  - 设置页「语言」两态 radio 即时切换 + localStorage 持久化 + `html[lang]` + naive locale 联动 + 标签页标题联动
  - 全站 UI 清扫：布局/列表/两种编辑器/评论/版本/共享/通知/设置/认证/404/邀请/分享页 + 工具栏/斜杠/模板/工具函数
    （注释与 console 不译；语言名以本语言显示）
  - 三处踩坑记录：① 消息语法 `@` 是链接——邮件地址必须写 `{"@"}`（编译期炸，非运行期）
    ② 批量脚本误吞 common 命名空间导致字面键名渲染 ③ 菜单/选项数组要 `computed` 否则切语言不刷新
  - 验证：E2E 新增 language.spec（切换/持久化/标题与 lang 联动），**16 组全绿**；zh 默认值逐字保留，既有选择器零改动
- [x] **文件夹（per-user 文档整理）** ✅（2026-09-30，三梯队 #3）
  - 后端：`folders`（unique `[user_id,name]`）/ `folder_documents`（unique `[folder_id,document_id]`，双外键级联）迁移 +
    `FolderController`（CRUD + `POST /documents/{id}/folder`，`folder_id=null` 即移出）；无 policy——他人文件夹一律 404 不暴露存在性；
    per-user 语义全靠 `folderAssignments` **按调用者 `with`**，他人视角 `folder_id` 恒 null；共享文档可各自归入自己的文件夹
  - 前端：全部收在 `DocumentsView`（工具栏筛选 select + owner 行「移动到文件夹」菜单 + 管理弹窗 CRUD + 行内文件夹徽标 + 筛选空态），
    无侧栏改动；搜索态忽略并禁用筛选（搜索 = 全局平铺态，评论命中不带 folder 信息）；筛选会话内有效不持久化
  - 踩坑：① `DocumentResource` 的 `folder_id`/`pinned` 依赖 `relationLoaded`——凡会回写前端列表行的端点
    （search/pin/update/restore）必须走统一的 `withViewerRelations`，否则徽标/置顶被响应冲成 null/false
    （`update` 此前连 pins 都不带，改名一篇置顶文档会视觉上取消置顶——顺手修掉的既有隐性 bug）；
    ② attach 响应只有 `{folder_id}` 而非完整 DocumentResource，前端只能 spread 合并不能整行替换（rename/pin 同理，为保搜索 snippet）；
    ③ 筛选哨兵用 `0` 不用 `null`（naive-ui select 的 null 显示 placeholder 而非「全部」选项）
  - 意外收获：管理弹窗实测发现底部按钮没渲染——全站 6 处 `positive-button-text`/`negative-button-text`
    均非 naive-ui 2.45 有效 prop（声明的是 `positiveText`/`negativeText`），改名/共享/链接弹窗底部按钮一直缺失
    （改名靠回车在用，共享靠 X 关，无人察觉）——一并修为 `positive-text`/`negative-text`，E2E 实测按钮出现
  - 验证：`FolderTest` 12 组全绿（含 3 个响应视角回归）/ 全量 164 PHPUnit / vue-tsc / 161 Vitest / build / **E2E 18 组全绿**（新增 folders.spec 2 组）
- **Sentry / 错误上报**——上公网部署后再接
- **标签**——按需（文件夹已覆盖主要整理需求）
- **Octane/Swoole、真机回归**——按部署节奏走

## 不建议做

- 管理后台 / 组织空间 / SSO——玩票项目撑不起量级
- 移动端原生 App——响应式 + PWA 已够

## 推荐落地顺序

1 深色模式 → 2 收藏置顶 → 3 工具栏增强 → 5 设置页，约一周，UI 观感和日常体验提升最明显；之后从第二梯队按兴趣挑（首选 PWA 离线）。
