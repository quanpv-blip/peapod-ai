-- Mở rộng nhật ký kiểm toán cho việc đăng (P-02/P-03). Chỉ thêm giá trị, không sửa bản ghi cũ.
ALTER TABLE approval_event DROP CONSTRAINT IF EXISTS approval_event_action_check;
ALTER TABLE approval_event ADD CONSTRAINT approval_event_action_check
  CHECK (action IN ('APPROVE','REJECT','REQUEST_CHANGES','EDIT','CANCEL','PUBLISH','PUBLISH_FAILED','PUBLISHED'));
