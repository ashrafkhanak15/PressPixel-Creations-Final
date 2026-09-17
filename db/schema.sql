SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(100) PRIMARY KEY,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS enquiries (
  id VARCHAR(128) PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(254) NOT NULL,
  ip_hash CHAR(64) NOT NULL,
  company VARCHAR(200) NOT NULL DEFAULT '',
  website VARCHAR(500) NOT NULL DEFAULT '',
  services JSON NOT NULL,
  message TEXT NOT NULL,
  consent VARCHAR(255) NOT NULL,
  consent_version VARCHAR(20) NOT NULL DEFAULT 'unknown',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notification_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  notification_last_attempt_at DATETIME NULL DEFAULT NULL,
  notification_next_attempt_at DATETIME NULL DEFAULT NULL,
  notification_sent_at TIMESTAMP NULL DEFAULT NULL,
  notification_error VARCHAR(500) NULL DEFAULT NULL,
  INDEX idx_enquiries_email_created_at (email, created_at),
  INDEX idx_enquiries_ip_created_at (ip_hash, created_at),
  INDEX idx_enquiries_notification_queue (notification_sent_at, notification_next_attempt_at)
);

CREATE TABLE IF NOT EXISTS enquiry_rate_limits (
  rate_key CHAR(64) PRIMARY KEY,
  window_started_at DATETIME(3) NOT NULL,
  request_count INT UNSIGNED NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_enquiry_rate_limits_window (window_started_at)
);

CREATE TABLE IF NOT EXISTS admin_users (
  id CHAR(36) PRIMARY KEY,
  singleton_key TINYINT UNSIGNED NOT NULL DEFAULT 1,
  email VARCHAR(254) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL DEFAULT NULL,
  UNIQUE KEY uq_admin_users_singleton (singleton_key),
  UNIQUE KEY uq_admin_users_email (email)
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id CHAR(36) PRIMARY KEY,
  user_id CHAR(36) NOT NULL,
  session_hash CHAR(64) NOT NULL,
  csrf_hash CHAR(64) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_admin_sessions_hash (session_hash),
  INDEX idx_admin_sessions_user_expires (user_id, expires_at),
  CONSTRAINT fk_admin_sessions_user FOREIGN KEY (user_id) REFERENCES admin_users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS admin_login_rate_limits (
  rate_key CHAR(64) PRIMARY KEY,
  window_started_at DATETIME(3) NOT NULL,
  request_count INT UNSIGNED NOT NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  INDEX idx_admin_login_rate_limits_window (window_started_at)
);

CREATE TABLE IF NOT EXISTS blog_categories (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description VARCHAR(300) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_blog_categories_name (name),
  UNIQUE KEY uq_blog_categories_slug (slug)
);

CREATE TABLE IF NOT EXISTS blog_tags (
  id CHAR(36) PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_blog_tags_name (name),
  UNIQUE KEY uq_blog_tags_slug (slug)
);

CREATE TABLE IF NOT EXISTS blog_media (
  id CHAR(36) PRIMARY KEY,
  uploader_id CHAR(36) NOT NULL,
  cloudinary_public_id VARCHAR(255) NOT NULL,
  url VARCHAR(1000) NOT NULL,
  width INT UNSIGNED NOT NULL,
  height INT UNSIGNED NOT NULL,
  alt_text VARCHAR(300) NOT NULL DEFAULT '',
  caption VARCHAR(500) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_blog_media_cloudinary_id (cloudinary_public_id),
  INDEX idx_blog_media_uploader_created (uploader_id, created_at),
  CONSTRAINT fk_blog_media_uploader FOREIGN KEY (uploader_id) REFERENCES admin_users(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS blog_posts (
  id CHAR(36) PRIMARY KEY,
  author_id CHAR(36) NOT NULL,
  primary_category_id CHAR(36) NULL DEFAULT NULL,
  featured_media_id CHAR(36) NULL DEFAULT NULL,
  title VARCHAR(200) NOT NULL DEFAULT '',
  slug VARCHAR(200) NULL DEFAULT NULL,
  excerpt VARCHAR(500) NOT NULL DEFAULT '',
  content_json JSON NULL,
  content_html MEDIUMTEXT NULL,
  aeo_summary TEXT NULL,
  faq_json JSON NULL,
  references_json JSON NULL,
  seo_title VARCHAR(70) NOT NULL DEFAULT '',
  meta_description VARCHAR(170) NOT NULL DEFAULT '',
  canonical_url VARCHAR(500) NULL DEFAULT NULL,
  social_title VARCHAR(70) NOT NULL DEFAULT '',
  social_description VARCHAR(200) NOT NULL DEFAULT '',
  social_media_id CHAR(36) NULL DEFAULT NULL,
  noindex TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('draft', 'scheduled', 'published', 'trashed') NOT NULL DEFAULT 'draft',
  scheduled_for DATETIME NULL DEFAULT NULL,
  published_at DATETIME NULL DEFAULT NULL,
  trashed_at DATETIME NULL DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_blog_posts_slug (slug),
  INDEX idx_blog_posts_status_schedule (status, scheduled_for),
  INDEX idx_blog_posts_status_published (status, published_at),
  INDEX idx_blog_posts_category_published (primary_category_id, status, published_at),
  CONSTRAINT fk_blog_posts_author FOREIGN KEY (author_id) REFERENCES admin_users(id) ON DELETE RESTRICT,
  CONSTRAINT fk_blog_posts_category FOREIGN KEY (primary_category_id) REFERENCES blog_categories(id) ON DELETE SET NULL,
  CONSTRAINT fk_blog_posts_featured_media FOREIGN KEY (featured_media_id) REFERENCES blog_media(id) ON DELETE SET NULL,
  CONSTRAINT fk_blog_posts_social_media FOREIGN KEY (social_media_id) REFERENCES blog_media(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS blog_post_tags (
  post_id CHAR(36) NOT NULL,
  tag_id CHAR(36) NOT NULL,
  PRIMARY KEY (post_id, tag_id),
  CONSTRAINT fk_blog_post_tags_post FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE,
  CONSTRAINT fk_blog_post_tags_tag FOREIGN KEY (tag_id) REFERENCES blog_tags(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blog_post_redirects (
  old_slug VARCHAR(200) PRIMARY KEY,
  post_id CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_blog_post_redirects_post FOREIGN KEY (post_id) REFERENCES blog_posts(id) ON DELETE CASCADE
);
