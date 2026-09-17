import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { EnquiryRateLimit } from '../lib/enquiry-rate-limit';
import { CONSENT_TEXT, CONSENT_VERSION } from '../lib/enquiry-consent';
import { getDb } from './index';

type EnquiryInput = {
  id: string;
  name: string;
  email: string;
  company: string;
  website: string;
  services: string[];
  message: string;
};

export type PendingEnquiryNotification = EnquiryInput & {
  attemptNumber: number;
};

interface ExistingRow extends RowDataPacket {
  id: string;
}

interface RateLimitRow extends RowDataPacket {
  request_count: number;
}

interface PendingNotificationRow extends RowDataPacket {
  id: string;
  name: string;
  email: string;
  company: string;
  website: string;
  services: unknown;
  message: string;
  notification_attempts: number;
}

interface NotificationHealthRow extends RowDataPacket {
  pending: number | string | null;
  exhausted: number | string | null;
  sent_last_24h: number | string | null;
  oldest_pending_at: Date | string | null;
  overdue: number | string | null;
}

async function consumeRateLimit(connection: PoolConnection, key: string, limit: number) {
  await connection.execute(
    `INSERT INTO enquiry_rate_limits (rate_key, window_started_at, request_count)
     VALUES (?, UTC_TIMESTAMP(3), 1)
     ON DUPLICATE KEY UPDATE
       request_count = IF(
         window_started_at <= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 HOUR),
         1,
         request_count + 1
       ),
       window_started_at = IF(
         window_started_at <= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 HOUR),
         UTC_TIMESTAMP(3),
         window_started_at
       )`,
    [key],
  );

  const [rows] = await connection.execute<RateLimitRow[]>(
    'SELECT request_count FROM enquiry_rate_limits WHERE rate_key = ? FOR UPDATE',
    [key],
  );
  return (rows[0]?.request_count ?? limit + 1) > limit;
}

function isDuplicateKeyError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY';
}

function normalizeServices(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export async function saveEnquiry(data: EnquiryInput, rateLimit: EnquiryRateLimit) {
  const connection = await getDb().getConnection();

  try {
    await connection.beginTransaction();

    const [existing] = await connection.execute<ExistingRow[]>(
      'SELECT id FROM enquiries WHERE id = ? LIMIT 1 FOR UPDATE',
      [data.id],
    );
    if (existing.length > 0) {
      await connection.commit();
      return { saved: true as const, duplicate: true as const, limited: false as const };
    }

    await connection.execute(
      `DELETE FROM enquiry_rate_limits
        WHERE window_started_at < DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 2 DAY)
        LIMIT 100`,
    );

    if (await consumeRateLimit(connection, rateLimit.ipKey, rateLimit.ipLimit)) {
      await connection.commit();
      return { saved: false as const, duplicate: false as const, limited: true as const, limitedBy: 'ip' as const };
    }

    if (await consumeRateLimit(connection, rateLimit.emailKey, rateLimit.emailLimit)) {
      await connection.commit();
      return { saved: false as const, duplicate: false as const, limited: true as const, limitedBy: 'email' as const };
    }

    const [insert] = await connection.execute<ResultSetHeader>(
      `INSERT INTO enquiries
        (id, name, email, ip_hash, company, website, services, message, consent, consent_version, notification_next_attempt_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 5 MINUTE))`,
      [
        data.id,
        data.name,
        data.email,
        rateLimit.ipHash,
        data.company,
        data.website,
        JSON.stringify(data.services),
        data.message,
        CONSENT_TEXT,
        CONSENT_VERSION,
      ],
    );

    await connection.commit();
    return { saved: insert.affectedRows === 1, duplicate: false as const, limited: false as const };
  } catch (error) {
    await connection.rollback();
    if (isDuplicateKeyError(error)) {
      return { saved: true as const, duplicate: true as const, limited: false as const };
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function recordEnquiryNotificationAttempt(
  id: string,
  sent: boolean,
  attemptNumber: number,
  error?: string,
  nextAttemptAt?: Date,
) {
  const db = getDb();
  await db.execute(
    `UPDATE enquiries
        SET notification_attempts = GREATEST(notification_attempts, ?),
            notification_last_attempt_at = UTC_TIMESTAMP(),
            notification_sent_at = IF(?, COALESCE(notification_sent_at, UTC_TIMESTAMP()), notification_sent_at),
            notification_error = IF(?, NULL, ?),
            notification_next_attempt_at = IF(?, NULL, ?)
      WHERE id = ?
        AND notification_sent_at IS NULL`,
    [
      attemptNumber,
      sent,
      sent,
      sent ? null : (error || 'Unknown notification error').slice(0, 500),
      sent,
      sent ? null : (nextAttemptAt || null),
      id,
    ],
  );
}

export async function claimPendingEnquiryNotifications(limit: number, maxAttempts: number, leaseSeconds: number) {
  const connection = await getDb().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute<PendingNotificationRow[]>(
      `SELECT id, name, email, company, website, services, message, notification_attempts
         FROM enquiries
        WHERE notification_sent_at IS NULL
          AND notification_attempts < ?
          AND notification_next_attempt_at IS NOT NULL
          AND notification_next_attempt_at <= UTC_TIMESTAMP()
        ORDER BY notification_next_attempt_at ASC
        LIMIT ?
        FOR UPDATE SKIP LOCKED`,
      [maxAttempts, limit],
    );

    if (rows.length > 0) {
      const placeholders = rows.map(() => '?').join(', ');
      await connection.execute(
        `UPDATE enquiries
            SET notification_next_attempt_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND)
          WHERE id IN (${placeholders})`,
        [leaseSeconds, ...rows.map(row => row.id)],
      );
    }

    await connection.commit();
    return rows.map(row => ({
      id: row.id,
      name: row.name,
      email: row.email,
      company: row.company,
      website: row.website,
      services: normalizeServices(row.services),
      message: row.message,
      attemptNumber: Number(row.notification_attempts) + 1,
    } satisfies PendingEnquiryNotification));
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getNotificationHealth(maxAttempts: number, staleMinutes = 30) {
  const [rows] = await getDb().execute<NotificationHealthRow[]>(
    `SELECT
       SUM(notification_sent_at IS NULL AND notification_attempts < ?) AS pending,
       SUM(notification_sent_at IS NULL AND notification_attempts >= ?) AS exhausted,
       SUM(notification_sent_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 24 HOUR)) AS sent_last_24h,
       MIN(IF(notification_sent_at IS NULL AND notification_attempts < ?, created_at, NULL)) AS oldest_pending_at,
       SUM(notification_sent_at IS NULL AND notification_attempts < ? AND notification_next_attempt_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)) AS overdue
     FROM enquiries`,
    [maxAttempts, maxAttempts, maxAttempts, maxAttempts, staleMinutes],
  );
  const row = rows[0];
  return {
    pending: Number(row?.pending || 0),
    exhausted: Number(row?.exhausted || 0),
    sentLast24Hours: Number(row?.sent_last_24h || 0),
    oldestPendingAt: row?.oldest_pending_at || null,
    overdue: Number(row?.overdue || 0),
  };
}
