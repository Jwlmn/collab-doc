# 后续推进路线图（Roadmap）

> 状态：**B1 工程化 + B2 生产就绪均已完成**（2026-09-22）；剩 B3 防丢失与通知 → 主线四按需
> 前情：M1–M9、打磨 18 项、导入导出、双文档类型、Excel v2 均已完成
> 质量基线：77 PHPUnit / 70 Vitest / **Playwright E2E 3 组（本机 3 轮稳定）/ CI 绿（run 1cf89f1）**

---

## 现状快照：离「可交付」还差什么

| 维度 | 现状 | 缺口 |
|------|------|------|
| 功能 | 文档/协作/权限/搜索/导入导出/双类型/表格引擎 全链路可用 | 深水功能待按需（见主线四） |
| 版本控制 | ✅ git 已建立（Jwlmn/collab-doc，tag v0.9-feature-complete） | — |
| 自动化 | ✅ CI 绿灯（双 job）+ 本机 E2E 三组稳定 | CI 内集成 E2E、a11y 清理待办 |
| 部署 | ✅ 生产栈可交付：docker compose.prod 一键起（nginx+fpm+hocuspocus+pg/redis），本机演练全流程通过；HTTPS 待公网加 TLS 层 | — |
| 防丢失 | 文档删除 = **硬删**，无回收站 | 协作产品高频事故点 |
| 通知 | 评论 @提及的 `mentions` 只存不用，无人被通知 | 闭环缺失 |
| 其他 | 图片无法插入（无 image 扩展）；存量 a11y 遗留；中文硬编码 | 按需 |

---

## 主线一：工程化基座（P0，一切的前提）

- [x] **Git 仓库初始化 + 首次提交** ✅（2026-09-22）：远程 `git@github.com:Jwlmn/collab-doc.git`，main 分支 329 文件/43KB 行已推送，标签 `v0.9-feature-complete` 已发布；提交前完成安全审查（无 .env/vendor/node_modules/sqlite/密钥入库，328KB pack）
- [x] **CI（GitHub Actions）** ✅（2026-09-22）：双 job 已转绿（run 1cf89f1）—— 后端 pint+phpunit（sqlite 内存 + 自动生成 APP_KEY）、前端 vue-tsc(-b 严格模式)+vitest+build；PR/push 触发
- [x] **Playwright E2E 冒烟** ✅（2026-09-22，本机）：三组 spec（注册→MD编辑→内容搜索 / Excel编辑→刷新持久 / 双页面实时协同），系统 Chrome 免下载，本机连跑 3 轮 3/3 稳定；`npm run test:e2e`（需 NO_PROXY=localhost 绕系统代理）；**CI 内集成 E2E 仍待办**（需 compose pg/redis + 三服务编排）
- [ ] 存量 a11y 遗留清理（polish 文档中标注未完成的 `name/id` 批量补齐等）——仍在待办

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

- [ ] **回收站（软删除）**：`documents.deleted_at` SoftDeletes；删除进回收站 → 列表「回收站」入口 → 恢复/彻底删除；**协作侧配套**：已删除文档的 collab 连接拒绝写入、`document_states`/versions/comments 级联保留至彻底删除
- [ ] **站内通知中心**：
  - 触发：评论被 @提及、文档被共享给自己
  - `notifications` 表（或复用 mentions 反查）+ 顶栏铃铛 + 未读角标 + 通知列表页（跳转对应文档/评论）
  - Excel 单元格提及暂不做（无此交互）
- [ ] **Excel 内容进全文搜索**：协作服务器 rows 模型抽取纯文本写入 `search_text`（复用 M8 的 `onStoreDocument` 管线，替换当前对 XmlFragment 的抽取按类型分流）——当前 Excel 只能按标题搜

**量级**：回收站约 1 天；通知约 1–1.5 天；搜索分流半天

## 主线四：功能深水区（P2，按真实需求点单）

- [ ] **Excel 进阶**：单元格合并、行高列宽、条件格式、公式扩展（IF/ROUND/VLOOKUP…，扩 tokenizer + 函数表即可，地基已备）
- [ ] **图片支持**：MD 编辑器接入 image 扩展 + 上传接口（存储方案：本地 disk → 对象存储）+ 粘贴/拖拽上传
- [ ] **版本进阶**：自动快照（间隔/次数阈值）、MD 与 Excel 统一版本时间线、版本 diff 对比
- [ ] **共享进阶**：邀请链接有效期与撤销、公开只读分享（无需登录，需权限模型扩展）
- [ ] **移动端精修**：表格编辑在触屏的可用性（大屏手势/虚拟键盘适配）、响应式遗留项
- [ ] i18n：文案抽离（当前中文硬编码）

**量级**：各 0.5–3 天不等，单独立项

---

## 推荐下一版（v3）打包

**主题：可交付 v3 ——「先有版本控制，再能上线，再防丢，再通知」**

```
B1 工程化基座 ✅ 已完成（git + CI 绿 + E2E 三组）
B2 生产就绪 ✅ 已完成（编排 + env + 备份演练 + deployment.md）
B3 防丢失与通知（回收站 + 站内通知 + Excel 搜索分流）  ← 下一步
```

- **验收标准**：
  1. 任意提交可回滚（git）；CI 绿灯成为合并门槛
  2. 从干净机器按部署文档一次跑通全功能（含 WSS 协同）
  3. 误删文档可恢复；@提及后对方能在站内收到通知并跳转
  4. 搜索框能命中 Excel 单元格内容
  5. 回归全绿：77+ PHPUnit、70+ Vitest、E2E 冒烟通过
- **主线四不进 v3**，完成 B1–B3 后按实际使用反馈点单

## 风险与依赖提示

1. GitHub 403（本机代理环境拉 Release 受限）——RoadRunner 仍未装（Playwright 已用系统 Chrome 绕过）；本机跑 E2E 需 NO_PROXY=localhost
2. 多端同时首次打开「v1 遗留 Excel 文档」的迁移并发窗口（极小，打开一次即收敛）
3. 列级并发插删最后写赢（已知边界，文档已标注）
