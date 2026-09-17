import { randomUUID } from 'node:crypto';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { AdminLoginRateLimit } from '../lib/admin-auth';
import { getDb } from './index';

export type AdminUser = {
  id: string;
  email: string;
  passwordHash: string;
};

export type AdminSession = {
  id: string;
  userId: string;
  email: string;
  csrfHash: string;
  expiresAt: Date;
};

export type BlogPostCounts = {
  draft: number;
  scheduled: number;
  published: number;
  trashed: number;
};

interface AdminUserRow extends RowDataPacket {
  id: string;
  email: string;
  password_hash: string;
}

interface AdminSessionRow extends RowDataPacket {
  id: string;
  user_id: string;
  email: string;
  csrf_hash: string;
  expires_at: Date | string;
}

interface CountRow extends RowDataPacket {
  count: number | string;
}

interface RateLimitRow extends RowDataPacket {
  request_count: number;
}

interface BlogPostCountRow extends RowDataPacket {
  status: keyof BlogPostCounts;
  count: number | string;
}

function duplicateKey(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY';
}

async function consumeLoginLimit(connection: PoolConnection, key: string, limit: number) {
  await connection.execute(
    `INSERT INTO admin_login_rate_limits (rate_key, window_started_at, request_count)
     VALUES (?, UTC_TIMESTAMP(3), 1)
     ON DUPLICATE KEY UPDATE
       request_count = IF(
         window_started_at <= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE),
         1,
         request_count + 1
       ),
       window_started_at = IF(
         window_started_at <= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 15 MINUTE),
         UTC_TIMESTAMP(3),
         window_started_at
       )`,
    [key],
  );

  const [rows] = await connection.execute<RateLimitRow[]>(
    'SELECT request_count FROM admin_login_rate_limits WHERE rate_key = ? FOR UPDATE',
    [key],
  );
  return (rows[0]?.request_count ?? limit + 1) > limit;
}

export async function consumeAdminLoginRateLimit(rateLimit: AdminLoginRateLimit) {
  const connection = await getDb().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `DELETE FROM admin_login_rate_limits
        WHERE window_started_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 DAY)
        LIMIT 100`,
    );

    if (await consumeLoginLimit(connection, rateLimit.ipKey, rateLimit.ipLimit)) {
      await connection.commit();
      return { limited: true as const, limitedBy: 'ip' as const };
    }
    if (await consumeLoginLimit(connection, rateLimit.emailKey, rateLimit.emailLimit)) {
      await connection.commit();
      return { limited: true as const, limitedBy: 'email' as const };
    }

    await connection.commit();
    return { limited: false as const };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function hasAdminUsers() {
  const [rows] = await getDb().execute<CountRow[]>('SELECT COUNT(*) AS count FROM admin_users');
  return Number(rows[0]?.count || 0) > 0;
}

export async function ensureBootstrapAdmin(email: string, passwordHash: string) {
  const db = getDb();
  if (await hasAdminUsers()) return false;

  try {
    await db.execute<ResultSetHeader>(
      `INSERT INTO admin_users (id, email, password_hash, is_active)
       VALUES (?, ?, ?, 1)`,
      [randomUUID(), email, passwordHash],
    );
    return true;
  } catch (error) {
    if (duplicateKey(error)) return false;
    throw error;
  }
}

export async function findAdminByEmail(email: string): Promise<AdminUser | null> {
  const [rows] = await getDb().execute<AdminUserRow[]>(
    `SELECT id, email, password_hash
       FROM admin_users
      WHERE email = ? AND is_active = 1
      LIMIT 1`,
    [email],
  );
  const row = rows[0];
  return row ? { id: row.id, email: row.email, passwordHash: row.password_hash } : null;
}

export async function createAdminSession(user: AdminUser, sessionHash: string, csrfHash: string, expiresAt: Date) {
  const connection = await getDb().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute(
      `DELETE FROM admin_sessions
        WHERE expires_at <= UTC_TIMESTAMP()
        LIMIT 100`,
    );
    await connection.execute(
      `INSERT INTO admin_sessions (id, user_id, session_hash, csrf_hash, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [randomUUID(), user.id, sessionHash, csrfHash, expiresAt],
    );
    await connection.execute(
      'UPDATE admin_users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?',
      [user.id],
    );
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getAdminSession(sessionHash: string): Promise<AdminSession | null> {
  const [rows] = await getDb().execute<AdminSessionRow[]>(
    `SELECT s.id, s.user_id, u.email, s.csrf_hash, s.expires_at
       FROM admin_sessions s
       INNER JOIN admin_users u ON u.id = s.user_id
      WHERE s.session_hash = ?
        AND s.expires_at > UTC_TIMESTAMP()
        AND u.is_active = 1
      LIMIT 1`,
    [sessionHash],
  );
  const row = rows[0];
  if (!row) return null;
  const expiresAt = row.expires_at instanceof Date ? row.expires_at : new Date(row.expires_at);
  if (Number.isNaN(expiresAt.getTime())) return null;

  await getDb().execute(
    'UPDATE admin_sessions SET last_seen_at = UTC_TIMESTAMP() WHERE id = ?',
    [row.id],
  );
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email,
    csrfHash: row.csrf_hash,
    expiresAt,
  };
}

export async function deleteAdminSession(sessionHash: string) {
  await getDb().execute('DELETE FROM admin_sessions WHERE session_hash = ?', [sessionHash]);
}

export async function getBlogPostCounts(): Promise<BlogPostCounts> {
  const [rows] = await getDb().execute<BlogPostCountRow[]>(
    'SELECT status, COUNT(*) AS count FROM blog_posts GROUP BY status',
  );
  const counts: BlogPostCounts = { draft: 0, scheduled: 0, published: 0, trashed: 0 };
  for (const row of rows) {
    if (row.status in counts) counts[row.status] = Number(row.count || 0);
  }
  return counts;
}
