#!/usr/bin/env bash
#
# E2E 统一入口：本机与 CI 都跑这个脚本，避免两套编排漂移。
#
# 起 Laravel + HocusPocus 两个进程，等就绪后交给 Playwright（它自己会
# 起 Vite —— playwright.config.ts 的 webServer）。退出时清理后台进程。
#
# 前置条件（脚本不负责）：
#   docker compose up -d --wait postgres redis   # init 脚本会建 pg_trgm
#   cd backend && php artisan migrate            # 必须在起 collab server 之前
#
# 用法：./scripts/e2e.sh [playwright 参数]
set -euo pipefail

cd "$(dirname "$0")/.."

# 只清理本脚本自己拉起的进程 —— 复用模式下别人的实例不能动
STARTED_PIDS=""

cleanup() {
  trap - EXIT
  for pid in $STARTED_PIDS; do
    kill "$pid" 2>/dev/null || true
  done
}
trap cleanup EXIT

# 已在跑就复用（与 Playwright 的 reuseExistingServer 同思路），
# 否则端口冲突会让本机日常使用失败
if curl -fsS http://127.0.0.1:8000/up >/dev/null 2>&1; then
  echo "==> Laravel 已在 :8000，复用"
else
  echo "==> 启动 Laravel (:8000)"
  (cd backend && php artisan serve --host=127.0.0.1 --port=8000) &
  STARTED_PIDS="$STARTED_PIDS $!"
fi

if (exec 3<>/dev/tcp/127.0.0.1/1234) 2>/dev/null; then
  exec 3<&- 3>&-
  echo "==> HocusPocus 已在 :1234，复用"
else
  echo "==> 启动 HocusPocus (:1234)"
  (cd server && npm run start) &
  STARTED_PIDS="$STARTED_PIDS $!"
fi

echo "==> 等待 Laravel 就绪"
laravel_ready=0
for _ in $(seq 1 60); do
  if curl -fsS http://127.0.0.1:8000/up >/dev/null 2>&1; then
    laravel_ready=1
    break
  fi
  sleep 1
done
if [ "$laravel_ready" -ne 1 ]; then
  echo "Laravel 未就绪（60s 超时）" >&2
  exit 1
fi

echo "==> 等待 HocusPocus 就绪"
collab_ready=0
for _ in $(seq 1 60); do
  if (exec 3<>/dev/tcp/127.0.0.1/1234) 2>/dev/null; then
    exec 3<&- 3>&-
    collab_ready=1
    break
  fi
  sleep 1
done
if [ "$collab_ready" -ne 1 ]; then
  echo "HocusPocus 未就绪（60s 超时）" >&2
  exit 1
fi

echo "==> 运行 Playwright"
(cd frontend && npx playwright test "$@")
