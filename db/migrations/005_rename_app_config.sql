-- Đổi tên app_setting -> app_config (bản đầu tạo app_setting). Chỉ đổi khi còn bảng cũ và chưa có bảng mới.
-- Trên cơ sở dữ liệu mới (đã có app_config từ 004) câu lệnh không làm gì.
DO $$
BEGIN
  IF to_regclass('app_setting') IS NOT NULL AND to_regclass('app_config') IS NULL THEN
    ALTER TABLE app_setting RENAME TO app_config;
  END IF;
END $$;
