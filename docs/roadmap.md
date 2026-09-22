# 后续推进路线图（Roadmap）

> 状态：**待执行**（2026-09-22 制定）
> 前情：M1–M9 里程碑、打磨计划 18 项、导入导出、双文档类型、Excel v2「表格引擎」均已完成
> 质量基线：后端 77 PHPUnit / 前端 70 Vitest / 三端 tsc + build + pint 全绿

---

## 现状快照：离「可交付」还差什么

| 维度 | 现状 | 缺口 |
|------|------|------|
| 功能 | 文档/协作/权限/搜索/导入导出/双类型/表格引擎 全链路可用 | 深水功能待按需（见主线四） |
| 版本控制 | **不是 git 仓库，全部代码零版本保护** | ⚠️ 最紧急 |
| 自动化 | 无 CI、无 E2E（每轮验收靠手工浏览器走查） | 质量兜底缺失 |
| 部署 | 三进程裸跑宿主机（vite dev + artisan serve + tsx）；RoadRunner 二进制未装（GitHub 403）；docker 仅 pg/redis | 无法交付上线 |
| 防丢失 | 文档删除 = **硬删**，无回收站 | 协作产品高频事故点 |
| 通知 | 评论 @提及的 `mentions` 只存不用，无人被通知 | 闭环缺失 |
| 其他 | 图片无法插入（无 image 扩展）；存量 a11y 遗留；中文硬编码 | 按需 |

---

## 主线一：工程化基座（P0，一切的前提）

- [ ] **Git 仓库初始化 + 首次提交**：`git init`、核对 `.gitignore`（已含 vendor/node_modules/.env 等）、初始 commit 打标签 `v0.9-feature-complete` —— 此前所有工作没有任何版本保护，这是**第一优先级**
- [ ] **CI（GitHub Actions）**：push/PR 触发 —— 后端 `pint --test` + `php artisan test`；前端 `vue-tsc` + `vitest` + `vite build`
- [ ] **Playwright E2E 冒烟**：把反复手工验收的流程固化 —— 登录 → 新建 MD/Excel → 编辑保存 → **双上下文协同断言** → 导入导出往返 → 搜索；CI 中跑（需 compose 起 pg/redis）
- [ ] 存量 a11y 遗留清理（polish 文档中标注未完成的 `name/id` 批量补齐等）

**量级**：git+CI 约半天；E2E 骨架约 1 天

## 主线二：生产就绪（P0）

- [ ] **全栈编排**：docker-compose 扩展为完整栈（或提供 `Procfile`/启动脚本）：Nginx（托管前端 build + 反代 API/WSS）+ Laravel Octane（**优先重试 Swoole**——扩展已装好；RoadRunner 二进制 GitHub 403 可换镜像内下载或代理）+ HocusPocus + pg/redis
- [ ] **生产 env 规范**：`APP_KEY`、`COLLAB_SECRET` 强随机、`SANCTUM_STATEFUL_DOMAINS` 换正式域名、`APP_URL`；`php artisan config:cache route:cache`；前端 `VITE_API_BASE_URL`/`VITE_COLLAB_URL` 构建期注入
- [ ] **WSS/HTTPS**：协作连接 `wss://` 与 cookie 安全属性（Secure/SameSite）联调
- [ ] **备份与恢复脚本**：pg 定时备份（cron/pg_dump）+ 恢复演练一次
- [ ] **日志与监控**：日志轮转（laravel + collab server）、错误上报入口（Sentry 或等价）、健康检查端点已有 `/up` 纳入探活
- [ ] **一次真实部署演练**：从零 clone → compose up → 跑通全功能，输出部署文档

**量级**：约 2–3 个工作日

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
B1 工程化基座（git init + CI + Playwright 冒烟）     ← 第一动作
B2 生产就绪（全栈编排 + env 生产化 + 部署演练）
B3 防丢失与通知（回收站 + 站内通知 + Excel 搜索分流）
```

- **验收标准**：
  1. 任意提交可回滚（git）；CI 绿灯成为合并门槛
  2. 从干净机器按部署文档一次跑通全功能（含 WSS 协同）
  3. 误删文档可恢复；@提及后对方能在站内收到通知并跳转
  4. 搜索框能命中 Excel 单元格内容
  5. 回归全绿：77+ PHPUnit、70+ Vitest、E2E 冒烟通过
- **主线四不进 v3**，完成 B1–B3 后按实际使用反馈点单

## 风险与依赖提示

1. GitHub 403（本机代理环境拉 Release 受限）——RoadRunner/Playwright 浏览器下载可能同样受阻，预留镜像源/缓存方案
2. 多端同时首次打开「v1 遗留 Excel 文档」的迁移并发窗口（极小，打开一次即收敛）
3. 列级并发插删最后写赢（已知边界，文档已标注）
