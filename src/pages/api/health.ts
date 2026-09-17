import { timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { getNotificationHealth } from '../../../db/enquiries';
import { getOverdueScheduledPostCount } from '../../../db/blog';
import { notificationWorkerConfig } from '../../../lib/enquiry-notification-worker';

export const prerender = false;

function authorized(request: Request) {
  const expected = process.env.HEALTHCHECK_TOKEN?.trim() || '';
  const authorization = request.headers.get('authorization') || '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (expected.length < 32 || !supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export const GET: APIRoute = async ({ request }) => {
  if (!authorized(request)) {
    return Response.json({ error: 'Not found.' }, { status: 404 });
  }

  try {
    const { maxAttempts } = notificationWorkerConfig();
    const configuredGrace = Number(process.env.WORKER_STALE_GRACE_MINUTES || 30);
    const staleGraceMinutes = Number.isInteger(configuredGrace) && configuredGrace >= 5 && configuredGrace <= 1440 ? configuredGrace : 30;
    const [notifications, overdueScheduledPosts] = await Promise.all([
      getNotificationHealth(maxAttempts, staleGraceMinutes),
      getOverdueScheduledPostCount(staleGraceMinutes),
    ]);
    const healthy = notifications.exhausted === 0 && notifications.overdue === 0 && overdueScheduledPosts === 0;
    return Response.json(
      { status: healthy ? 'ok' : 'degraded', notifications, overdueScheduledPosts },
      { status: healthy ? 200 : 503 },
    );
  } catch (error) {
    console.error('Health check failed:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ status: 'unavailable' }, { status: 503 });
  }
};
