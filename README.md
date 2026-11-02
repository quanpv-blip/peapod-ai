# peapod-ai

Mã nguồn hệ thống tự động hóa nội dung Facebook B2B (VN/JP). **Tài liệu yêu cầu/thiết kế nằm ở repo `ba-team`** (BRD, SRS, kiến trúc, hợp đồng API). Đọc `ba-team/docs/03-architecture.md` và `04-integration-contracts.md` trước khi sửa mã.

## Trạng thái

Epic E0 (hạ tầng và nền) xong. E1 (PoC): **đường miễn phí bằng Gemini đã chạy được đầu-cuối** (RSS → sinh bài theo schema → validator → TTS → phụ đề) cho JP và VN. Chưa chạy: xAI (chưa có credit) và Meta (chưa có token Page thử). Chưa có tính năng nghiệp vụ (nghiên cứu, sinh, duyệt, đăng): xem backlog ở `ba-team/docs/11-delivery-plan.md`.

| Đã có | Kiểm chứng |
|---|---|
| Docker Compose: PostgreSQL 16, migrate, api (`/healthz`), worker (pg-boss), Caddy (profile `prod`) | Chạy thật, healthy; migrate lặp lại an toàn |
| `db/migrations/001_init.sql` (từ `ba-team/specs/db.sql`) | Áp dụng trên PostgreSQL 16; ràng buộc trạng thái chặn giá trị sai |
| `deploy/backup.sh`, `deploy/restore.sh` | Sao lưu rồi khôi phục: dữ liệu giữ nguyên |
| Miền: máy trạng thái, validator schema, băm nội dung, sanitizer, phụ đề (có ngắt từ tiếng Nhật), giờ đăng, BUC, retry, chi phí | 64 test đơn vị (gồm cả test hồi quy) |
| Bộ chuyển đổi xAI/Meta (chưa nối vào quy trình) | Chỉ kiểm kiểu; **chưa gọi API thật** |
| `poc/gemini-probe.ts`, `poc/e2e-free.ts` (Gemini, đường miễn phí) | **Đã chạy thật** 2026-11-02: JP và VN đạt schema, 0 URL bịa, đúng ngôn ngữ; TTS ra WAV có tiếng. Chất lượng nội dung chưa đánh giá (G-3) |
| Script PoC `poc/g1-meta-check.ts`, `g2-research.ts`, `g4-tts.ts` (Meta, xAI) | Chỉ kiểm kiểu; **chưa chạy** |
| Bộ chuyển đổi Gemini, đọc RSS, đọc WAV, ước lượng timestamp phụ đề | 64 test đơn vị; chạy thật qua `e2e-free.ts` |
| CI GitLab: typecheck, test, build, quét bí mật | Chưa chạy trên GitLab |

## Chạy local

Yêu cầu: Docker, Node >= 22.

```bash
cp .env.example .env            # đặt POSTGRES_PASSWORD (chuỗi ngẫu nhiên dài); KHÔNG commit .env
docker compose up -d --build    # postgres -> migrate -> api + worker
curl http://127.0.0.1:3000/healthz
```

Phát triển không dùng Docker cho ứng dụng:

```bash
npm ci
docker compose up -d postgres
# DATABASE_URL=postgres://app:<mật khẩu>@127.0.0.1:5433/peapod
npm run migrate && npm run dev:api     # terminal 2: npm run dev:worker
npm run typecheck && npm test
```

Cổng mặc định: Postgres 5433 và API 3000, chỉ bind loopback (đổi bằng `POSTGRES_HOST_PORT`, `API_HOST_PORT`).

## Chạy thử miễn phí bằng Gemini (không cần xAI/Meta)

Đặt `GEMINI_API_KEY` (tạo miễn phí tại aistudio.google.com/apikey, project chưa bật billing). **Chỉ dữ liệu công khai**: gói Free của Google dùng nội dung để cải thiện sản phẩm.

```bash
npx tsx poc/gemini-probe.ts                     # thăm dò hình dạng phản hồi
npx tsx poc/e2e-free.ts --market JP --tts       # RSS -> sinh bài -> kiểm tra -> TTS -> phụ đề (JP hoặc VN)
```

## Chạy PoC Meta/xAI (cần khóa thật, dùng Page thử)

Điền `.env` rồi, ví dụ:

```bash
npx tsx poc/g1-meta-check.ts --market VN        # chỉ đọc: debug_token, bài viết, metric Insights còn hợp lệ
npx tsx poc/g2-research.ts --market JP          # web_search + x_search, kiểm URL
npx tsx poc/g4-tts.ts --lang ja --text "…"      # TTS có timestamp + phụ đề SRT
```

Bằng chứng ghi vào `poc/out/` (gitignore). Chép kết luận vào `ba-team/docs/99-evidence-log.md` và cập nhật các mục ⚠️.

## Production (VPS)

`docker compose --profile prod up -d --build` sau khi đặt `APP_DOMAIN` (DNS trỏ về VPS). Hướng dẫn đầy đủ và xử lý sự cố: `ba-team/docs/06-ops-runbook.md`. Sao lưu: cron chạy `deploy/backup.sh`; việc đẩy bản sao ra ngoài VPS chưa tự động (quyết định D-17).

## Cấu trúc

```
src/config.ts, db.ts, migrate.ts, server.ts, worker.ts
src/domain/      logic thuần, có test (không I/O)
src/providers/   xAI, Meta (I/O ra ngoài)
db/migrations/   SQL theo số thứ tự
schemas/         content_package.schema.json (bản sao của ba-team/specs; giữ đồng bộ)
poc/             script kiểm chứng giai đoạn 0
deploy/          Caddyfile, sao lưu/khôi phục
test/            vitest
```

## Quy ước

- Không đưa bí mật vào mã/log. Token đi qua header, không đặt vào URL.
- Thao tác **tạo** tài nguyên (đăng bài, tạo video AI) không tự thử lại (`idempotent:false`); xem `src/domain/retry.ts`.
- Chuyển trạng thái chỉ qua `src/domain/states.ts`; test kiểm tra khớp với CHECK trong SQL.
- Sửa `ba-team/specs/*` thì cập nhật bản sao ở đây trong cùng đợt thay đổi.
