-- Kho tin RSS/Atom đã lấy (nguồn dữ liệu cho đề xuất chủ đề và tạo bài theo chủ đề). Chỉ thêm/cập nhật theo URL.
CREATE TABLE source_item (
  id           BIGSERIAL CONSTRAINT source_item_pk PRIMARY KEY,
  market       TEXT NOT NULL CHECK (market IN ('VN','JP')),
  feed         TEXT NOT NULL,
  url          TEXT NOT NULL CONSTRAINT source_item_url_uq UNIQUE,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  published_at TIMESTAMPTZ,
  fetched_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX source_item_market_idx ON source_item(market, published_at DESC);
