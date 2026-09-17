import { timingSafeEqual } from 'node:crypto';
import type { APIRoute } from 'astro';
import { publishDueBlogPosts } from '../../../../db/blog';

export const prerender = false;

function authorized(request: Request) {
  const expected = process.env.INTERNAL_PUBLISH_WORKER_TOKEN || '';
  const authorization = request.headers.get('authorization') || '';
  const supplied = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!expected || !supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && timingSafeEqual(expectedBuffer, suppliedBuffer);
}

export const POST: APIRoute = async ({ request }) => {
  if (!authorized(request)) return Response.json({ error: 'Not found.' }, { status: 404 });
  try {
    const published = await publishDueBlogPosts();
    return Response.json({ published });
  } catch (error) {
    console.error('Blog publishing worker failed:', error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'Blog publishing worker failed.' }, { status: 503 });
  }
};
