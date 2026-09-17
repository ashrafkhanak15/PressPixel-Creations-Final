-- Run this once after 001_enquiry_abuse_protection.sql and before deploying
-- the notification retry worker.

ALTER TABLE enquiries
  ADD COLUMN notification_attempts INT UNSIGNED NOT NULL DEFAULT 0 AFTER created_at,
  ADD COLUMN notification_last_attempt_at DATETIME NULL DEFAULT NULL AFTER notification_attempts,
  ADD COLUMN notification_next_attempt_at DATETIME NULL DEFAULT NULL AFTER notification_last_attempt_at,
  ADD INDEX idx_enquiries_notification_queue (notification_sent_at, notification_next_attempt_at);

-- Existing unsent enquiries become eligible for retry immediately.
UPDATE enquiries
   SET notification_next_attempt_at = UTC_TIMESTAMP()
 WHERE notification_sent_at IS NULL;
