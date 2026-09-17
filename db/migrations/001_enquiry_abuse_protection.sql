-- Run this once on an existing PressPixel database before deploying the
-- application version that includes database-backed IP rate limiting.

ALTER TABLE enquiries
  ADD COLUMN ip_hash CHAR(64) NULL AFTER email,
  ADD INDEX idx_enquiries_ip_created_at (ip_hash, created_at);

CREATE TABLE enquiry_rate_limits (
  rate_key CHAR(64) PRIMARY KEY,
  window_started_at DATETIME(3) NOT NULL,
  request_count INT UNSIGNED NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_enquiry_rate_limits_window (window_started_at)
);
