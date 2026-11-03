-- Nhật ký chi phí AI (trang Chi phí, trần ngày/tháng). Mỗi lần gọi mô hình là một dòng; chỉ thêm, không sửa.
CREATE TABLE ai_usage (
  id           BIGSERIAL CONSTRAINT ai_usage_pk PRIMARY KEY,
  market       TEXT NOT NULL CHECK (market IN ('VN','JP')),
  purpose      TEXT NOT NULL CHECK (purpose IN ('NEWS','CAMPAIGN')),
  model        TEXT NOT NULL,
  tokens_in    INT NOT NULL DEFAULT 0,
  tokens_out   INT NOT NULL DEFAULT 0,
  tokens_think INT NOT NULL DEFAULT 0,
  cost_usd     NUMERIC(12,6) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ai_usage_created_idx ON ai_usage(created_at);
