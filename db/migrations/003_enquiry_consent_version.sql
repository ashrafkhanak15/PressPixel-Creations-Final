-- Run this once after 002_notification_retry_queue.sql and before deploying
-- the consent-version release.
--
-- Existing rows predate version tracking and keep the 'unknown' default; their
-- stored consent sentence already identifies which wording was agreed to.

ALTER TABLE enquiries
  ADD COLUMN consent_version VARCHAR(20) NOT NULL DEFAULT 'unknown' AFTER consent;