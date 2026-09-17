import { timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { closeDb } from '../../../../db/index';

export const prerender = false;

function authorized(request: Request) {
  const expected = process.env.INTERNAL_SHUTDOWN_TOKEN || '';
  const supplied = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

export const POST: APIRoute = async ({ request }) => {
  if (!authorized(request)) return Response.json({ error: 'Not found.' }, { status: 404 });
  try {
    await closeDb();
    return Response.json({ closed: true });
  } catch (error) {
    console.error('Database shutdown failed:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ closed: false }, { status: 503 });
  }
};
