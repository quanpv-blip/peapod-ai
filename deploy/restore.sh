#!/usr/bin/env bash
# Khôi phục từ bản sao mã hóa: BACKUP_PASSPHRASE_FILE=/root/peapod-backup.key ./deploy/restore.sh /var/backups/peapod/peapod-XXXX.sql.gz.enc
# CẢNH BÁO: xóa và tạo lại CSDL `peapod`. Dừng api/worker trước. Diễn tập định kỳ (NFR-REL-04).
set -euo pipefail
FILE="${1:?cần đường dẫn file .sql.gz.enc}"
PASS_FILE="${BACKUP_PASSPHRASE_FILE:?đặt BACKUP_PASSPHRASE_FILE trỏ tới file khóa}"
[ -f "$FILE" ] || { echo "Không thấy $FILE" >&2; exit 1; }
[ -s "$PASS_FILE" ] || { echo "Thiếu hoặc rỗng: $PASS_FILE" >&2; exit 1; }

# Giải mã và kiểm tra nén trước khi đụng tới CSDL thật.
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$PASS_FILE" -in "$FILE" | gzip -t
echo "Bản sao giải mã được và nén hợp lệ."

read -r -p "Sẽ XÓA và khôi phục CSDL peapod từ $FILE. Gõ YES để tiếp tục: " ok
[ "$ok" = "YES" ] || { echo "Hủy."; exit 1; }
docker compose stop api worker
docker compose exec -T postgres psql -U app -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS peapod WITH (FORCE)" -c "CREATE DATABASE peapod OWNER app"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass "file:$PASS_FILE" -in "$FILE" \
  | gunzip \
  | docker compose exec -T postgres psql -U app -d peapod -v ON_ERROR_STOP=1 -q
docker compose up -d api worker
echo "Khôi phục xong. Kiểm tra /healthz và số bài trong hàng chờ trước khi mở lại cho người dùng."
