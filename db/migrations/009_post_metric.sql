-- Số liệu tương tác của bài đã đăng (đọc từ Meta). Mỗi bài một dòng, ghi đè theo lần đọc mới nhất.
-- impressions có thể NULL: cần quyền read_insights; thiếu quyền thì chỉ có số phản ứng/bình luận/chia sẻ.
CREATE TABLE IF NOT EXISTS post_metric (
  content_id   BIGINT CONSTRAINT post_metric_pk PRIMARY KEY REFERENCES content_item(id),
  reactions    INT NOT NULL DEFAULT 0,
  comments     INT NOT NULL DEFAULT 0,
  shares       INT NOT NULL DEFAULT 0,
  impressions  INT,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS post_metric_fetched_idx ON post_metric(fetched_at);
