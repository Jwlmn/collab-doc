#!/usr/bin/env bash
#
# PostgreSQL 恢复（会覆盖现有数据，先备份再恢复！）
#
# 用法：
#   ./scripts/restore-db.sh backups/collab_doc_20260922_120000.sql.gz
#   COMPOSE_FILE=docker-compose.prod.yml ./scripts/restore-db.sh <file>
#
set -euo pipefail

cd "$(dirname "$0")/.."

FILE="${1:?用法: $0 <backup.sql.gz>}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
DB_USER="${DB_USERNAME:-collab}"
DB_NAME="${DB_DATABASE:-collab_doc}"

if [[ ! -f "$FILE" ]]; then
  echo "[restore] 文件不存在: $FILE" >&2
  exit 1
fi

echo "[restore] 警告：将清空并重建 ${DB_NAME} 的 public schema！3 秒后开始（Ctrl-C 取消）"
sleep 3

# 先清空 schema，避免 CREATE TABLE/约束冲突导致部分恢复失败
echo "[restore] dropping existing schema ..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
    psql -U "$DB_USER" -d "$DB_NAME" -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO public;" --quiet

echo "[restore] restoring from ${FILE} ..."
gunzip -c "$FILE" | docker compose -f "$COMPOSE_FILE" exec -T postgres \
    psql -U "$DB_USER" -d "$DB_NAME" --quiet

echo "[restore] done"
