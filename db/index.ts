import mysql, { type Pool } from 'mysql2/promise';

let pool: Pool | undefined;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function getDb(): Pool {
  if (pool) return pool;

  const portValue = process.env.DB_PORT?.trim() || '3306';
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be a valid TCP port.');
  }

  pool = mysql.createPool({
    host: requiredEnv('DB_HOST'),
    port,
    user: requiredEnv('DB_USER'),
    password: requiredEnv('DB_PASSWORD'),
    database: requiredEnv('DB_NAME'),
    waitForConnections: true,
    connectionLimit: 5,
    maxIdle: 5,
    idleTimeout: 60_000,
    queueLimit: 0,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
  });

  return pool;
}

export async function verifyDatabaseSchema() {
  const db = getDb();
  await Promise.all([
    db.execute('SELECT id, ip_hash, consent_version, notification_attempts, notification_next_attempt_at FROM enquiries LIMIT 0'),
    db.execute('SELECT rate_key FROM enquiry_rate_limits LIMIT 0'),
    db.execute('SELECT id, singleton_key, password_hash FROM admin_users LIMIT 0'),
    db.execute('SELECT id, session_hash, csrf_hash FROM admin_sessions LIMIT 0'),
    db.execute('SELECT rate_key FROM admin_login_rate_limits LIMIT 0'),
    db.execute('SELECT id, cloudinary_public_id FROM blog_media LIMIT 0'),
    db.execute('SELECT id, slug, status, published_at, trashed_at FROM blog_posts LIMIT 0'),
    db.execute('SELECT old_slug, post_id FROM blog_post_redirects LIMIT 0'),
  ]);
}

export async function closeDb() {
  const activePool = pool;
  pool = undefined;
  if (activePool) await activePool.end();
}
