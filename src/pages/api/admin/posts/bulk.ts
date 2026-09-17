import type { APIRoute } from 'astro';
import { z } from 'zod';
import { bulkUpdateAdminBlogPosts } from '../../../../../db/blog';
import { isResponse, requireAdminMutation } from '../../../../../lib/admin-request';

export const prerender = false;

const payloadSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(['trash', 'restore']),
});

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
}

export const POST: APIRoute = async (context) => {
  const contentLength = Number(context.request.headers.get('content-length') || 0);
  if (contentLength > 20_000) return json({ error: 'Bulk request is too large.' }, 413);

  const authorization = await requireAdminMutation(context, context.request.headers.get('x-csrf-token') || '');
  if (isResponse(authorization)) return authorization;

  let payload: z.infer<typeof payloadSchema>;
  try {
    payload = payloadSchema.parse(await context.request.json());
  } catch {
    return json({ error: 'Choose at least one valid post and action.' }, 400);
  }

  try {
    const changed = await bulkUpdateAdminBlogPosts(authorization.userId, payload.ids, payload.action);
    return json({ changed });
  } catch (error) {
    const databaseCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'UNKNOWN';
    console.error('Admin bulk post update failed:', databaseCode, error instanceof Error ? error.message : 'Unknown error');
    return json({ error: 'Unable to update the selected posts right now.' }, 503);
  }
};
