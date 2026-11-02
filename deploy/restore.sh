#!/usr/bin/env bash
# Khôi phục từ bản sao: ./deploy/restore.sh /var/backups/peapod/peapod-XXXX.sql.gz
# CẢNH BÁO: xóa và tạo lại CSDL `peapod`. Dừng api/worker trước. Diễn tập định kỳ (NFR-REL-04).
set -euo pipefail
FILE="${1:?cần đường dẫn file .sql.gz}"
[ -f "$FILE" ] || { echo "Không thấy $FILE" >&2; exit 1; }
gzip -t "$FILE"
read -r -p "Sẽ XÓA và khôi phục CSDL peapod từ $FILE. Gõ YES để tiếp tục: " ok
[ "$ok" = "YES" ] || { echo "Hủy."; exit 1; }
docker compose stop api worker
docker compose exec -T postgres psql -U app -d postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS peapod WITH (FORCE)" -c "CREATE DATABASE peapod OWNER app"
gunzip -c "$FILE" | docker compose exec -T postgres psql -U app -d peapod -v ON_ERROR_STOP=1 -q
docker compose up -d api worker
echo "Khôi phục xong."
