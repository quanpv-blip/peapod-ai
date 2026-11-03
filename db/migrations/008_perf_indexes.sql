-- Index cho các truy vấn nóng, đã đo trên 50.000 bài / 150.000 sự kiện duyệt (xem docs/99 E-46):
--   chi tiết bài và lịch sử duyệt, giới hạn 30 bài/24 giờ của Meta, tra cứu ảnh thẻ: từ 1–6 ms xuống dưới 0,05 ms;
--   danh sách "Sắp đăng": từ 12 ms xuống dưới 0,2 ms (index từng phần chỉ cho trạng thái chờ đăng);
--   đếm và lọc hàng chờ theo thị trường/trạng thái: giảm khoảng 2 ms.
-- Dùng IF NOT EXISTS để chạy lại an toàn.

CREATE INDEX IF NOT EXISTS approval_event_content_idx ON approval_event(content_id, id);
CREATE INDEX IF NOT EXISTS approval_event_action_created_idx ON approval_event(action, created_at);
CREATE INDEX IF NOT EXISTS media_asset_content_idx ON media_asset(content_id, revision, kind);
CREATE INDEX IF NOT EXISTS content_item_market_state_idx ON content_item(market, state, updated_at DESC);
CREATE INDEX IF NOT EXISTS content_item_upcoming_idx ON content_item(scheduled_at NULLS LAST, id) WHERE state IN ('APPROVED', 'SCHEDULED');
