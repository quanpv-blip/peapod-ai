-- Người dùng giao diện duyệt (docs/10 mục 1). Mật khẩu băm scrypt; đăng nhập SSO sẽ thay thế khi có (NFR-SEC-02).
CREATE TABLE app_user (
  email          TEXT PRIMARY KEY,
  display_name   TEXT NOT NULL,
  roles          TEXT[] NOT NULL CHECK (roles <@ ARRAY['approver_vn','approver_jp','admin','viewer']::TEXT[] AND cardinality(roles) > 0),
  password_hash  TEXT NOT NULL,
  disabled       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
