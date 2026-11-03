-- Cấu hình vận hành dùng chung (N-02 kill switch, cờ tạm dừng). Mỗi khóa một dòng; ghi ai đổi và khi nào.
CREATE TABLE app_config (
  key         TEXT CONSTRAINT app_config_pk PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_by  TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
