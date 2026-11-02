#!/usr/bin/env bash
# Sao lưu PostgreSQL hằng đêm (cron). Chạy trên VPS, trong thư mục chứa docker-compose.yml.
# Ví dụ cron:  15 2 * * *  cd /opt/peapod-ai && ./deploy/backup.sh >> /var/log/peapod-backup.log 2>&1
# LƯU Ý: bản sao nằm cùng máy. NFR-SEC-06 yêu cầu mã hóa và lưu NGOÀI VPS: hãy đẩy thư mục $BACKUP_DIR
# lên nơi lưu ngoài (restic/rclone/S3) theo quyết định hạ tầng (D-17). Script này KHÔNG tự đẩy.
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/peapod}"
KEEP_DAYS="${KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/peapod-$STAMP.sql.gz"

umask 077
mkdir -p "$BACKUP_DIR"
docker compose exec -T postgres pg_dump -U app -d peapod --no-owner | gzip -9 > "$OUT.tmp"
# Kiểm tra bản sao đọc được trước khi coi là thành công.
gzip -t "$OUT.tmp"
mv "$OUT.tmp" "$OUT"
find "$BACKUP_DIR" -name 'peapod-*.sql.gz' -mtime "+$KEEP_DAYS" -delete
echo "$(date -u +%FT%TZ) backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
