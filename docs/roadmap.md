# 后续推进路线图（Roadmap）

> 状态：**B1 + B2 + B3 + 主线四基本全部完成**（2026-09-29）；仅剩 i18n 按需点单
> 前情：M1–M9、打磨 18 项、导入导出、双文档类型、Excel v2 均已完成；主线四已落地：图片支持、版本进阶（快照/diff/可逆恢复）、共享进阶（公开只读分享 + 有效期 + 撤销）、Excel 进阶（公式/条件格式/行高列宽）、搜索增强、协作 UX（跟随协作者）、a11y 收尾、CI 内 E2E
> 质量基线：**126 PHPUnit / 157 Vitest / Playwright E2E 8 组通过（CI 内亦跑）/ pint 绿 / vue-tsc 严格模式绿**

---

## 现状快照：离「可交付」还差什么

| 维度 | 现状 | 缺口 |
|------|------|------|
| 功能 | 文档/协作/权限/搜索/导入导出/双类型/表格引擎 全链路可用 | 深水功能待按需（见主线四） |
| 版本控制 | ✅ git 已建立（Jwlmn/collab-doc，tag v0.9-feature-complete） | — |
| 自动化 | ✅ CI 绿灯（三 job，含 compose 编排的 E2E）+ 本机 E2E 三组稳定 | a11y 存量扫尾（本轮复核中） |
| 部署 | ✅ 生产栈可交付：docker compose.prod 一键起（nginx+fpm+hocuspocus+pg/redis），本机演练全流程通过；HTTPS 待公网加 TLS 层 | — |
| 防丢失 | ✅ 回收站（软删除 + 恢复/彻底删除 + 协作侧拒绝写入 + document_states 清理） | — |
| 通知 | ✅ 站内通知闭环（@提及/共享触发 + 顶栏铃铛 + 未读角标 + 跳转） | — |
| 搜索 | ✅ Excel 单元格内容进全文搜索（rows 模型按类型分流抽取） | — |
| 其他 | 中文硬编码（无 i18n）；触屏已精修（真机回归待验收） | 按需 |

---

## 主线一：工程化基座（P0，一切的前提）

- [x] **Git 仓库初始化 + 首次提交** ✅（2026-09-22）：远程 `git@github.com:Jwlmn/collab-doc.git`，main 分支 329 文件/43KB 行已推送，标签 `v0.9-feature-complete` 已发布；提交前完成安全审查（无 .env/vendor/node_modules/sqlite/密钥入库，328KB pack）
- [x] **CI（GitHub Actions）** ✅（2026-09-22）：双 job 已转绿（run 1cf89f1）—— 后端 pint+phpunit（sqlite 内存 + 自动生成 APP_KEY）、前端 vue-tsc(-b 严格模式)+vitest+build；PR/push 触发
- [x] **Playwright E2E 冒烟** ✅（2026-09-22，本机）：三组 spec（注册→MD编辑→内容搜索 / Excel编辑→刷新持久 / 双页面实时协同），系统 Chrome 免下载，本机连跑 3 轮 3/3 稳定；`npm run test:e2e`（需 NO_PROXY=localhost 绕系统代理）
- [x] **CI 内集成 E2E** ✅（2026-09-28）：compose 编排 pg/redis（pg_trgm 走 init 卷）+ `scripts/e2e.sh` 本机/CI 同一入口 + ci.yml 第三个 job，失败上传 trace
- [x] 存量 a11y 遗留清理 ✅（2026-09-28，A4 收尾）：17 处表单控件补 `name/id`、Excel 网格 aria 结构修正、对比度与 label-content-name 修复；Lighthouse 三页 + 移动端无障碍均 100

**量级**：git+CI 约半天；E2E 骨架约 1 天

## 主线二：生产就绪（P0）

- [x] **全栈编排** ✅：`docker-compose.prod.yml` + 三镜像（backend php-fpm / server hocuspocus / web nginx 静态+fastcgi+WS 反代），仅暴露 8080；.dockerignore 防宿主依赖污染；Octane/Swoole 暂缓（php-fpm 够用，记录为后续性能选项）
- [x] **生产 env 规范** ✅：APP_KEY/COLLAB_SECRET 注入与模板、Sanctum 域名带端口修正（踩坑：host:port 匹配）、APP_URL 等；config 缓存策略见 deployment.md
- [x] **WSS** ✅：同源 `/collab` 反代 + getCollabUrl 自动识别，本机演练 ws→collab→pg 全通；**HTTPS/TLS** 留待公网部署（Caddy 方案已写入 deployment.md，本机无证书环境）
- [x] **备份与恢复脚本** ✅：backup/restore 各演练通过（restore 修正为先重建 schema 再导入）
- [x] **日志与监控（基础版）** ✅：`/up` 健康检查 + compose healthcheck + `logs` 排障手册；Sentry 等外部错误上报仍为后续项
- [x] **一次真实部署演练** ✅：本机 compose build→up→浏览器全流程（注册登录、Excel 编辑持久化到 prod 库、搜索、静态/API），输出 **docs/deployment.md**

**量级**：约 2–3 个工作日（实际已完成）

## 主线三：防丢失与通知闭环（P1，产品安心感）

- [x] **回收站（软删除）** ✅（2026-09-23）：`documents.deleted_at` SoftDeletes；列表「回收站」入口（`/trash`）→ 恢复/彻底删除；**协作侧配套**：Laravel 隐式绑定对 trashed 文档 404（collab-token 不可取）+ 协作服务器 `onAuthenticate` 拒绝已删除文档新连接 + `onStoreDocument` 跳过 `deleted_at` 非空行 + 彻底删除时清理 `document_states`；versions/comments/members 由外键级联保留至彻底删除；PHPUnit TrashTest 7 例
- [x] **站内通知中心** ✅（2026-09-23）：
  - 触发：评论被 @提及（`MentionNotification`，不含自己）、文档被共享给自己（`DocumentSharedNotification`）
  - `notifications` 表 + 顶栏铃铛（`NotificationBell.vue`：未读角标、60s 轮询、面板列表、全部已读、点击标已读并跳转对应文档）
  - Excel 单元格提及暂不做（无此交互）；PHPUnit NotificationTest 6 例
- [x] **Excel 内容进全文搜索** ✅：协作服务器按文档结构分流（`isExcelDoc` 判 rows/v1 cells → `extractRowsText` 抽单元格文本，MD 走 XmlFragment），复用 `onStoreDocument` 管线写入 `search_text`

**量级**：回收站约 1 天；通知约 1–1.5 天；搜索分流半天（实际已全部完成）

## 主线四：功能深水区（P2，按真实需求点单）

- [x] **Excel 进阶** ⭐ 大部分完成（2026-09-28）：公式引擎重写（比较运算/IF 惰性分支/VLOOKUP/ROUND/ABS/LEN/CONCAT/AND/OR，46 例测试）、条件格式（8 比较 + 6 色 + 加粗）、行高列宽（拖拽 + 双击恢复）
- [x] **图片支持** ✅（2026-09-28）：`@tiptap/extension-image` + `POST /api/images`（mimes + 5MB + UUID 公开读）+ 工具栏/斜杠/粘贴/拖拽四入口 + Markdown 往返 + docx 导出（导入天然跳过，已知边界）
- [x] **版本进阶** ✅（2026-09-28）：自动快照（间隔/次数阈值 + content_hash 去重 + 上限裁剪）、MD 与 Excel 双时间线抽屉、diff 对比（行级/网格级）、恢复前自动备份（可逆回滚）
- [x] **共享进阶** ✅（2026-09-28）：公开只读分享（HMAC 令牌 + 有效期 + share_version 撤销 + 访客端点全只读）、邀请链接改用 HmacToken
- [x] **移动端精修** ✅（2026-09-29）：行列拖拽调尺寸改 Pointer Events + touch-action:none（触屏可拖）、选区填充柄（touch-action:none，触屏扩选唯一入口，滚动与扩选手势分离）、触屏点按直接编辑保留、触屏拖动 = 原生滚动不误扩选、虚拟键盘避让（scrollIntoView nearest + visualViewport resize 居中）；390×844 走查通过，真机回归待验收

- [ ] i18n：文案抽离（当前中文硬编码）—— 唯一剩余点单项
- [x] **Excel 单元格合并** ✅（2026-09-29）：`meta.merges` 锚点存储 + 快照/持久化自动携带 + 行列插删平移收缩 + 选区扩张/键盘跨块/焦点吸附 + 工具栏「合并」按钮；10 例模型 Vitest + E2E merge.spec（合并→持久→取消）；详见 docs/excel-sheets.md

**量级**：各 0.5–3 天不等，单独立项

---

## 推荐下一版（v3）打包

**主题：可交付 v3 ——「先有版本控制，再能上线，再防丢，再通知」**

```
B1 工程化基座 ✅ 已完成（git + CI 绿 + E2E 三组）
B2 生产就绪 ✅ 已完成（编排 + env + 备份演练 + deployment.md）
B3 防丢失与通知 ✅ 已完成（回收站 + 站内通知 + Excel 搜索分流，2026-09-23）
```

- **验收标准**：
  1. 任意提交可回滚（git）；CI 绿灯成为合并门槛
  2. 从干净机器按部署文档一次跑通全功能（含 WSS 协同）
  3. 误删文档可恢复；@提及后对方能在站内收到通知并跳转
  4. 搜索框能命中 Excel 单元格内容
  5. 回归全绿：91 PHPUnit、70 Vitest、E2E 冒烟通过 —— ✅ 已达标（2026-09-23）
- **主线四**：B1–B3 后按反馈点单，已于 2026-09-28/29 落地大部分（图片、版本、共享、Excel 进阶、搜索增强、CI E2E、a11y 收尾）；仅剩 i18n（单元格合并与移动端触屏精修已于 2026-09-29 完成）

## 风险与依赖提示

1. GitHub 403（本机代理环境拉 Release 受限）——RoadRunner 仍未装（Playwright 已用系统 Chrome 绕过）；本机跑 E2E 需 NO_PROXY=localhost
2. 多端同时首次打开「v1 遗留 Excel 文档」的迁移并发窗口（极小，打开一次即收敛）
3. 列级并发插删最后写赢（已知边界，文档已标注）
