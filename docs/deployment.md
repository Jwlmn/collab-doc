# 部署与运维手册

> 状态：随 v3-B2 提供（2026-09-22）
> 适用：本机生产形态演练 / 任意单机服务器部署

## 架构

```
                    ┌─────────────────────────────────────────┐
   :8080 ──────────▶│ web (nginx)                            │
                    │  · /              → 前端静态 + SPA 回退 │
                    │  · /api /sanctum /up → php-fpm(app:9000)│
                    │  · /collab         → WebSocket → collab │
                    └───────┬─────────────────────┬───────────┘
                            │ fastcgi             │ ws 代理
                    ┌───────▼───────┐     ┌───────▼──────────┐
                    │ app (php-fpm) │     │ collab (HocusPocus)│
                    │ Laravel 迁移启动│     │ tsx 直跑 TS        │
                    └───────┬───────┘     └───────┬──────────┘
                            └──────┬──────────────┘
                    ┌──────────────▼──────────────┐
                    │ postgres:17  ·  redis:7     │
                    └─────────────────────────────┘
```

- 三个应用镜像：`backend/Dockerfile`（php:8.5-fpm + pgsql/mbstring/zip 扩展）、`server/Dockerfile`（node:22 + tsx）、`web/Dockerfile`（node 构建前端 → nginx 托管静态 + 反代）
- **对外只暴露 `web:8080`**；db/redis/app/collab 仅 compose 内网
- 协作连接走**同源** `ws(s)://<host>/collab`（前端 `getCollabUrl()` 自动识别，开发环境仍直连 1234）

## 部署步骤（从零）

### 1. 准备环境变量（项目根 `.env`，不入库）

```bash
# Laravel 应用密钥
echo "APP_KEY=$(cd backend && php artisan key:generate --show)" >> .env
# 协作令牌 HMAC 密钥（两端共用）
echo "COLLAB_SECRET=$(openssl rand -hex 32)" >> .env
# 数据库密码（已有 DB_PASSWORD=secret，生产请改掉并同步两处环境）
```

可调项：`WEB_PORT`（默认 8080）、`APP_URL`（默认 http://localhost:8080）、
`SANCTUM_STATEFUL_DOMAINS`（上线换正式域名）、`APP_DEBUG=false`。

### 2. 构建并启动

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

- `app` 启动时自动 `php artisan migrate --force`
- 首次构建较慢（PHP 扩展编译 + composer + 前端 build）

### 3. 验证

```bash
curl -i http://localhost:8080/up            # Laravel 健康检查 200
curl -i http://localhost:8080/api/user      # 401 JSON（未登录，预期）
curl -s http://localhost:8080/ | head -5    # 前端 index.html
docker compose -f docker-compose.prod.yml ps  # web healthcheck=healthy
```

浏览器全流程：注册/登录 → 建 MD + Excel → 双开标签协同 → 导入导出 → 搜索。

### 4. HTTPS / WSS（上线必做）

本机演练为 HTTP。公网部署时**强烈建议在 web 前再加一层 Caddy**（自动签发 Let's Encrypt 证书）：

```
your.domain.com {
    reverse_proxy web:80
}
```

启用后：
1. `.env` 中 `SESSION_SECURE_COOKIE=true`、`APP_URL=https://your.domain.com`
2. `SANCTUM_STATEFUL_DOMAINS=your.domain.com`
3. 前端协作连接自动升级为 `wss://`（getCollabUrl 按 location.protocol 判断，无需改码）

## 备份与恢复

```bash
# 备份（gzip，自动保留最近 10 份，产物在 backups/ 已被 git 忽略）
COMPOSE_FILE=docker-compose.prod.yml ./scripts/backup-db.sh

# 恢复（会覆盖数据！3 秒缓冲可 Ctrl-C）
COMPOSE_FILE=docker-compose.prod.yml ./scripts/restore-db.sh backups/collab_doc_<时间戳>.sql.gz
```

crontab 示例（每日 03:00 备份）：

```cron
0 3 * * * cd /path/to/collab-doc && COMPOSE_FILE=docker-compose.prod.yml ./scripts/backup-db.sh >> backups/backup.log 2>&1
```

`document_states`（Y.js 二进制）与 `documents` 同库，一次 pg_dump 全覆盖。

## 日志与排障

```bash
docker compose -f docker-compose.prod.yml logs -f web app collab   # 聚合日志
docker compose -f docker-compose.prod.yml exec app php artisan about
docker compose -f docker-compose.prod.yml exec app php artisan tinker  # 慎用
```

| 症状 | 排查 |
|------|------|
| 页面 502/504 | `logs app`：fpm 是否存活、migrate 是否失败 |
| API 419 | CSRF/Sanctum 域名：检查 `SANCTUM_STATEFUL_DOMAINS` 与访问 Host 一致 |
| 协同连不上 | `logs collab` + 浏览器控制台；确认 `/collab` 反代与 `COLLAB_SECRET` 两端一致 |
| 样式全无 | `logs web`；前端 build 是否成功（web 镜像构建阶段） |
| 数据库迁移卡住 | `logs postgres`；`exec app php artisan migrate:status` |

## 与开发栈的关系

- 开发栈（`docker-compose.yml` + `php artisan serve` + `npm run dev` + `tsx`）与生产栈（`docker-compose.prod.yml`）**端口不冲突**（生产仅占 WEB_PORT=8080）
- 两套栈**卷相互独立**（`prod_postgres_data` vs `postgres_data`），数据不互通
- CI 跑测试用 sqlite 内存库，与两者皆无关

## 已知边界

- RoadRunner/Octane 未启用（GitHub 403 未装 rr 二进制）：当前生产形态为 **php-fpm**，性能足够中小规模；后续可在镜像内换 Octane/Swoole（扩展本机已验证可编译）
- 协作服务健康检查依赖 `logs collab`（无 HTTP 端点）；web 的 healthcheck 走 `/up` 间接覆盖主链路
- 多副本 app 会并发 migrate（单副本无碍；扩副本前改为 init 容器或迁移 job）
