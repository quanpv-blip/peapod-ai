# peapod-ai

Ứng dụng tự động hóa nội dung Facebook B2B (VN/JP): Fastify (HTML render phía máy chủ), PostgreSQL 16, pg-boss, Gemini, Meta Graph, Telegram. Tài liệu yêu cầu/thiết kế nằm ở repo `../ba-team` (đọc `docs/03-architecture.md`, `04-integration-contracts.md`, `05-data-model-and-states.md` trước khi sửa luồng).

## Lệnh thường dùng
- Kiểm kiểu: `npm run typecheck`
- Test đơn vị: `npx vitest run`
- Test đầy đủ (gồm test tích hợp, cần PostgreSQL): đặt `TEST_DATABASE_URL=postgres://app:<mật khẩu>@127.0.0.1:5433/postgres` rồi `npx vitest run`. Mỗi file test tự tạo cơ sở dữ liệu tạm và xóa khi xong (`test/helpers/freshDb.ts`), không đụng dữ liệu thật. Thiếu biến này thì ~100 test tích hợp bị **bỏ qua im lặng**, nên "xanh" chưa chắc là đủ.
- Áp dụng thay đổi vào ứng dụng đang chạy: `docker compose up -d --build` (api + worker). Dữ liệu giữ nguyên trong volume `pgdata`.
- Kiểm tra: `docker compose ps` (api phải `healthy`).

## Cấu trúc
- `src/domain/`: logic thuần, không I/O, có test (máy trạng thái, chấm chất lượng, kịch bản video `reelScript.ts`, chiến lược nội dung `strategy.ts`, phụ đề).
- `src/providers/`: I/O ra ngoài (Gemini, Meta, Telegram, Slack, xAI).
- `src/services/`: nghiệp vụ (transaction, phân quyền, kiểm toán). `src/web/`: route và view HTML.
- `db/migrations/`: SQL đánh số. `schemas/`: bản sao schema nội dung (đồng bộ với `ba-team/specs`).

## Quy tắc bắt buộc
- Không đưa bí mật vào mã hoặc log. **Không đọc giá trị trong `.env`**: chứa khóa Meta, Telegram, Gemini, xAI thật. Chỉ đọc tên biến khi cần.
- Chuyển trạng thái bài chỉ qua `src/domain/states.ts`; test kiểm tra khớp với CHECK trong SQL.
- Thao tác **tạo** tài nguyên ngoài (đăng bài, tạo video AI) không tự thử lại (`idempotent:false`).
- Sửa `ba-team/specs/*` thì cập nhật bản sao trong repo này trong cùng đợt.
- Page Facebook là Page **thật**. Không đăng thử, không gọi API ghi của Meta khi chưa được người dùng đồng ý rõ ràng.
- Gọi Gemini tốn hạn mức: không gọi TTS hay sinh bài chỉ để thử; dùng WAV mẫu ở `poc/out/` khi cần kiểm tra đường video.

## Phân quyền
Vai trò: `admin`, `approver_vn`, `approver_jp`, `viewer`. Dựng video và duyệt chỉ cho người có quyền **đúng thị trường**; admin không thay thế (quyết định D-15). Khi người dùng báo "không dựng được video JP", kiểm tra vai trò tài khoản trước.

## Video Reels
Dịch vụ render nằm ở `../peapod-video` (cổng 4100). PeaPod gọi qua `src/media/remote-card.ts`; lời đọc (Gemini TTS) và phụ đề dựng trong `src/services/reels.ts` + `src/domain/reelScript.ts`. Mốc phụ đề hiện là **ước lượng theo ký tự**, chưa phải timestamp thật. `REEL_VOICE=off` tắt lời đọc.

## Môi trường Windows
- Không có Python. `sed` với chuỗi chứa `#`, `|`, dấu ngoặc dễ vỡ: dùng công cụ Edit/Write thay cho `sed`/`node -e` nhúng mã.
- Script thử đặt trong thư mục dự án (đường dẫn tương đối, đuôi `.mts` nếu dùng top-level await), xóa sau khi dùng.
- Trên PowerShell 5.1, `curl` là `Invoke-WebRequest`: dùng `curl.exe`.

## Trạng thái và việc còn mở
Xem `../ba-team/docs/12-remaining-work-plan.md` và `99-evidence-log.md`. Chưa làm: đăng Reels lên Meta, đưa video vào máy trạng thái/hash duyệt, chấm AI, tự duyệt tăng dần.
