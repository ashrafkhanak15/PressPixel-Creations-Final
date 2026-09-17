import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import mysql from 'mysql2/promise';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

const connection = await mysql.createConnection({
  host: required('DB_HOST'), port: Number(process.env.DB_PORT || 3306), user: required('DB_USER'),
  password: required('DB_PASSWORD'), database: required('DB_NAME'), timezone: 'Z', charset: 'utf8mb4', multipleStatements: true,
});

try {
  await connection.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version VARCHAR(100) PRIMARY KEY,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  const [tables] = await connection.query("SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'enquiries'");
  if (Number(tables[0]?.count || 0) === 0) {
    await connection.query(await readFile(resolve('db/schema.sql'), 'utf8'));
    for (const version of ['001_enquiry_abuse_protection.sql', '002_notification_retry_queue.sql', '003_enquiry_consent_version.sql', '004_blog_admin_foundation.sql']) {
      await connection.execute('INSERT IGNORE INTO schema_migrations (version) VALUES (?)', [version]);
    }
    console.log('Installed the current database schema.');
  } else {
    const files = (await readdir(resolve('db/migrations'))).filter((name) => /^\d+_.*\.sql$/.test(name)).sort();
    const probes = {
      '001_enquiry_abuse_protection.sql': "SELECT ((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='enquiries' AND column_name='ip_hash') = 1 AND (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='enquiry_rate_limits') = 1) AS count",
      '002_notification_retry_queue.sql': "SELECT ((SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='enquiries' AND column_name IN ('notification_attempts','notification_last_attempt_at','notification_next_attempt_at')) = 3 AND (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='enquiries' AND index_name='idx_enquiries_notification_queue') > 0) AS count",
      '003_enquiry_consent_version.sql': "SELECT COUNT(*) AS count FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='enquiries' AND column_name='consent_version'",
      '004_blog_admin_foundation.sql': "SELECT ((SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('admin_users','admin_sessions','admin_login_rate_limits','blog_categories','blog_tags','blog_media','blog_posts','blog_post_tags','blog_post_redirects')) = 9) AS count",
    };
    for (const version of files) {
      const [applied] = await connection.execute('SELECT version FROM schema_migrations WHERE version = ? LIMIT 1', [version]);
      if (applied.length) continue;
      if (probes[version]) {
        const [probe] = await connection.query(probes[version]);
        if (Number(probe[0]?.count || 0) > 0) {
          await connection.execute('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
          console.log(`Recorded existing migration ${version}.`);
          continue;
        }
      }
      await connection.query(await readFile(resolve('db/migrations', version), 'utf8'));
      await connection.execute('INSERT INTO schema_migrations (version) VALUES (?)', [version]);
      console.log(`Applied ${version}.`);
    }
  }
} finally {
  await connection.end();
}
