-- Lược đồ PostgreSQL 16 cho hệ thống PeaPod AI (nguồn sự thật duy nhất, thay Google Sheets).
-- Máy trạng thái: xem docs/05-data-model-and-states.md. Giữ CHECK ở đây đồng bộ với tài liệu đó.

CREATE TABLE research_run (
  id            BIGSERIAL PRIMARY KEY,
  market        TEXT NOT NULL CHECK (market IN ('VN','JP')),
  trigger_mode  TEXT NOT NULL CHECK (trigger_mode IN ('SCHEDULED','MANUAL')),
  directive     TEXT,                              -- chủ đề chiến dịch (MANUAL)
  brief         JSONB,                             -- kết quả nghiên cứu đã sanitize, kèm citations
  tool_calls    INT NOT NULL DEFAULT 0,
  tokens_in     INT NOT NULL DEFAULT 0,
  tokens_out    INT NOT NULL DEFAULT 0,
  status        TEXT NOT NULL CHECK (status IN ('RUNNING','DONE','FAILED')),
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE content_item (
  id                BIGSERIAL PRIMARY KEY,
  research_run_id   BIGINT REFERENCES research_run(id),
  market            TEXT NOT NULL CHECK (market IN ('VN','JP')),
  page_key          TEXT NOT NULL,                 -- khóa cấu hình Fanpage (VN/JP), không lưu token ở DB
  format            TEXT NOT NULL CHECK (format IN ('TEXT','IMAGE','REEL')),
  media_engine      TEXT NOT NULL CHECK (media_engine IN ('NONE','REMOTION_CARD','REMOTION_VIDEO','GROK_IMAGINE_REEL')),
  state             TEXT NOT NULL CHECK (state IN (
                      'GENERATING','MEDIA_PENDING','IN_REVIEW','CHANGES_REQUESTED','APPROVED',
                      'SCHEDULED','PUBLISHING','PUBLISHED','REJECTED','CANCELLED',
                      'FAILED_GENERATE','FAILED_MEDIA','FAILED_PUBLISH')),
  current_revision  INT NOT NULL DEFAULT 1,
  scheduled_at      TIMESTAMPTZ,                   -- giờ đăng dự kiến (UTC)
  fb_post_id        TEXT,                          -- id trả về từ Meta, dùng để đối soát chống đăng trùng
  fb_video_id       TEXT,
  retry_count       INT NOT NULL DEFAULT 0,
  last_error        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, current_revision)
);
CREATE INDEX content_item_state_idx ON content_item(state, scheduled_at);

-- Mỗi lần AI sinh hoặc người sửa là một revision bất biến; duyệt gắn với đúng revision.
CREATE TABLE content_revision (
  content_id    BIGINT NOT NULL REFERENCES content_item(id),
  revision      INT NOT NULL,
  package       JSONB NOT NULL,                    -- tuân theo specs/content_package.schema.json
  package_hash  TEXT NOT NULL,                     -- sha256(package), để chặn sửa sau duyệt
  edited_by     TEXT,                              -- NULL nếu do AI sinh
  model         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (content_id, revision)
);

CREATE TABLE media_asset (
  id            BIGSERIAL PRIMARY KEY,
  content_id    BIGINT NOT NULL REFERENCES content_item(id),
  revision      INT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('IMAGE','VIDEO_RAW','AUDIO_TTS','SUBTITLE','VIDEO_FINAL')),
  path          TEXT NOT NULL,
  sha256        TEXT,
  duration_s    NUMERIC(6,2),
  width         INT,
  height        INT,
  is_ai_generated BOOLEAN NOT NULL DEFAULT FALSE,  -- quyết định cờ is_ai_generated khi đăng
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  delete_after  TIMESTAMPTZ                         -- GC: published_at + 7 ngày
);

-- Nhật ký kiểm toán: chỉ thêm, không sửa/xóa.
CREATE TABLE approval_event (
  id            BIGSERIAL PRIMARY KEY,
  content_id    BIGINT NOT NULL REFERENCES content_item(id),
  revision      INT NOT NULL,
  package_hash  TEXT NOT NULL,
  actor         TEXT NOT NULL,                      -- danh tính người duyệt (SSO/email)
  action        TEXT NOT NULL CHECK (action IN ('APPROVE','REJECT','REQUEST_CHANGES','EDIT','CANCEL')),
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE publish_attempt (
  id            BIGSERIAL PRIMARY KEY,
  content_id    BIGINT NOT NULL REFERENCES content_item(id),
  step          TEXT NOT NULL,                      -- vd: REEL_START, REEL_UPLOAD, REEL_POLL, REEL_FINISH, FEED_POST
  http_status   INT,
  fb_trace_id   TEXT,                               -- header x-fb-trace-id
  buc_usage     JSONB,                              -- header x-business-use-case-usage
  ok            BOOLEAN NOT NULL,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE metric_snapshot (
  id            BIGSERIAL PRIMARY KEY,
  fb_post_id    TEXT NOT NULL,
  captured_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  reactions     INT, comments INT, shares INT,      -- luôn có (nhóm chỉ số ổn định)
  media_views   INT, unique_media_views INT,        -- tùy chọn, phụ thuộc metric còn được Meta hỗ trợ
  raw           JSONB
);

CREATE TABLE app_setting (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL                              -- vd: giờ đăng, ngưỡng BUC, cờ bật/tắt format
);
