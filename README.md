# collab-doc — 多人实时协作文档系统

基于 CRDT（Y.js）的多人实时协作文档，支持 Markdown 文档与 Excel 表格双类型、实时协作、版本历史、评论 @提及、权限共享、全文搜索。

**技术栈**：Vue 3 + Tiptap + Y.js（前端） · Laravel + Sanctum（后端） · HocusPocus（协作服务器） · PostgreSQL + Redis · Docker

架构与详细设计见 [CLAUDE.md](./CLAUDE.md)，部署运维见 [docs/deployment.md](./docs/deployment.md)。

## 目录结构

```
backend/    Laravel 后端（REST API、认证、权限、版本、评论、搜索）
frontend/   Vue 3 前端（编辑器、列表、E2E 测试）
server/     HocusPocus 协作服务器（WebSocket、Y.js 持久化、搜索文本抽取）
web/        生产 Nginx 镜像（静态托管 + API/WS 反代）
scripts/    backup-db.sh / restore-db.sh / e2e.sh
docs/       部署手册、路线图、产品打磨记录
```

## 本地开发

前置：Docker、PHP 8.3+、Node 22+、Composer。

```bash
# 1. 基础设施（PostgreSQL + Redis）
docker compose up -d --wait

# 2. 环境变量
cp .env.example .env                      # 后端配置（含 COLLAB_SECRET）
php artisan key:generate --show           # 填入 APP_KEY（backend/ 目录下执行）

# 3. 后端（:8000）
cd backend && composer install && php artisan migrate && php artisan serve

# 4. 协作服务器（:1234）
cd server && npm install && npm run start

# 5. 前端（:5173）
cd frontend && npm install && npm run dev
```

浏览器打开 `http://localhost:5173`。协作令牌依赖共享密钥 `COLLAB_SECRET`，后端与协作服务器需一致。

局域网访问：前端与协作地址按页面 hostname 自动解析，可直接用本机 IP 打开。

## 测试

```bash
cd backend && php artisan test     # PHPUnit（sqlite 内存）
cd frontend && npm test            # Vitest 单元测试
cd frontend && npm run build       # vue-tsc 严格模式 + 构建
cd server && npm run typecheck     # 协作服务器类型检查
./scripts/e2e.sh                   # Playwright E2E（见脚本头注释的前置条件）
```

E2E 使用系统 Chrome（免下载浏览器），本机如走系统代理需 `NO_PROXY=localhost`。

## 生产部署

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

单栈编排（nginx + php-fpm + HocusPocus + PostgreSQL + Redis），仅暴露 `:8080`。
完整步骤、环境变量规范、备份恢复与排障见 [docs/deployment.md](./docs/deployment.md)。

```bash
./scripts/backup-db.sh    # 备份
./scripts/restore-db.sh   # 恢复
```

## 文档索引

| 文档 | 内容 |
|------|------|
| [CLAUDE.md](./CLAUDE.md) | 架构、技术选型、项目上下文 |
| [docs/roadmap.md](./docs/roadmap.md) | 里程碑与后续路线图 |
| [docs/deployment.md](./docs/deployment.md) | 部署与运维手册 |
| [docs/product-polish-plan.md](./docs/product-polish-plan.md) | 产品打磨记录 |
| [docs/import-export.md](./docs/import-export.md) · [docs/excel-sheets.md](./docs/excel-sheets.md) | 导入导出 / Excel 表格设计 |
