#!/usr/bin/env bash
#
# PostgreSQL 备份：gzip 压缩 + 保留最近 10 份
#
# 用法：
#   ./scripts/backup-db.sh                          # 默认连 dev compose（docker-compose.yml）
#   COMPOSE_FILE=docker-compose.prod.yml ./scripts/backup-db.sh   # 连生产编排
#
set -euo pipefail

cd "$(dirname "$0")/.."

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
DB_USER="${DB_USERNAME:-collab}"
DB_NAME="${DB_DATABASE:-collab_doc}"
KEEP="${KEEP:-10}"
OUT_DIR="backups"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
OUT_FILE="${OUT_DIR}/collab_doc_${TIMESTAMP}.sql.gz"

mkdir -p "$OUT_DIR"

echo "[backup] dumping ${DB_NAME} via ${COMPOSE_FILE} ..."
docker compose -f "$COMPOSE_FILE" exec -T postgres \
    pg_dump -U "$DB_USER" -d "$DB_NAME" --no-owner | gzip > "$OUT_FILE"

# 保留最近 KEEP 份
ls -1t "${OUT_DIR}"/collab_doc_*.sql.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f

SIZE="$(du -h "$OUT_FILE" | cut -f1)"
echo "[backup] ok -> ${OUT_FILE} (${SIZE})"
echo "[backup] 恢复：COMPOSE_FILE=${COMPOSE_FILE} ./scripts/restore-db.sh ${OUT_FILE}"
