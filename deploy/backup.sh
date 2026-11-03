#!/usr/bin/env bash
# Sao lưu PostgreSQL hằng đêm (cron). Chạy trên VPS, trong thư mục chứa docker-compose.yml.
# Ví dụ cron:  15 2 * * *  cd /opt/peapod-ai && ./deploy/backup.sh >> /var/log/peapod-backup.log 2>&1
#
# Bản sao được MÃ HÓA (AES-256, khóa lấy từ BACKUP_PASSPHRASE_FILE). Mất khóa là mất bản sao: hãy lưu khóa ở nơi khác VPS.
# Nếu đặt RCLONE_REMOTE (ví dụ "b2:peapod-backup" hoặc "gdrive:peapod"), bản mã hóa được đẩy ra ngoài VPS.
# Không đặt RCLONE_REMOTE thì script báo cảnh báo rõ ràng: bản sao chỉ nằm trên VPS (chưa đạt NFR-SEC-06).
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/peapod}"
KEEP_DAYS="${KEEP_DAYS:-14}"
PASS_FILE="${BACKUP_PASSPHRASE_FILE:?đặt BACKUP_PASSPHRASE_FILE trỏ tới file chứa khóa mã hóa}"
[ -s "$PASS_FILE" ] || { echo "Thiếu hoặc rỗng: $PASS_FILE" >&2; exit 1; }

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/peapod-$STAMP.sql.gz.enc"

umask 077
mkdir -p "$BACKUP_DIR"

# Dump -> nén -> mã hóa, không bao giờ ghi bản rõ ra đĩa.
docker compose exec -T postgres pg_dump -U app -d peapod --no-owner \
  | gzip -9 \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass "file:$PASS_FILE" -out "$OUT.tmp"

# Kiểm tra bản mã hóa giải được và nén hợp lệ trước khi coi là thành công.
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$PASS_FILE" -in "$OUT.tmp" | gzip -t
mv "$OUT.tmp" "$OUT"

find "$BACKUP_DIR" -name 'peapod-*.sql.gz.enc' -mtime "+$KEEP_DAYS" -delete

if [ -n "${RCLONE_REMOTE:-}" ]; then
  # Đẩy ra ngoài. Lỗi thì thoát khác 0 để cron/giám sát thấy được, không im lặng.
  rclone copy "$OUT" "$RCLONE_REMOTE" --immutable
  echo "$(date -u +%FT%TZ) offsite ok: $RCLONE_REMOTE"
else
  echo "$(date -u +%FT%TZ) CẢNH BÁO: chưa đặt RCLONE_REMOTE, bản sao chỉ nằm trên VPS" >&2
fi

echo "$(date -u +%FT%TZ) backup ok: $OUT ($(du -h "$OUT" | cut -f1))"
