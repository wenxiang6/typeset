#!/usr/bin/env bash
# PostgreSQL 每日备份（在服务器上跑，cron 调度）
#
# 安装（服务器上执行一次）：
#   chmod +x ops/backup.sh ops/healthcheck.sh
#   crontab -e  加两行：
#     15 3 * * * /path/to/paiban/ops/backup.sh >> /path/to/paiban/ops/backup.log 2>&1
#     */5 * * * * /path/to/paiban/ops/healthcheck.sh >> /path/to/paiban/ops/health.log 2>&1
#
# 备份保留 30 天，pg_dump 自定义格式（.dump，恢复用 pg_restore）。

set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
BACKUP_DIR="$DIR/backups"
KEEP_DAYS=30
CONTAINER="${PAIBAN_PG_CONTAINER:-paiban-postgres-1}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%F)"
OUT="$BACKUP_DIR/paiban-$STAMP.dump"

docker exec "$CONTAINER" pg_dump -U paiban -Fc paiban > "$OUT"
echo "[$(date '+%F %T)] 备份完成: $OUT ($(du -h "$OUT" | cut -f1))"

# 清理 30 天前的旧备份
find "$BACKUP_DIR" -name 'paiban-*.dump' -mtime +$KEEP_DAYS -delete
echo "[$(date '+%F %T)] 已清理 ${KEEP_DAYS} 天前旧备份"
