import { timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { verifyDatabaseSchema } from '../../../../db/index';

export const prerender = false;

function authorized(request: Request) {
  const expected = process.env.INTERNAL_READINESS_TOKEN || '';
  const supplied = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const POST: APIRoute = async ({ request }) => {
  if (!authorized(request)) return Response.json({ error: 'Not found.' }, { status: 404 });
  try {
    await verifyDatabaseSchema();
    return Response.json({ ready: true });
  } catch (error) {
    console.error('Database readiness check failed:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ ready: false }, { status: 503 });
  }
};
