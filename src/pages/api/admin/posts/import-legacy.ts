import type { APIRoute } from 'astro';
import { isResponse, requireAdminMutation } from '../../../../../lib/admin-request';
import { importBundledLegacyArticles } from '../../../../../lib/legacy-blog-import';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const authorization = await requireAdminMutation(context, context.request.headers.get('x-csrf-token') || '');
  if (isResponse(authorization)) return authorization;

  try {
    const result = await importBundledLegacyArticles(authorization.userId);
    return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const databaseCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'UNKNOWN';
    console.error('Legacy article import failed:', databaseCode, error instanceof Error ? error.message : 'Unknown error');
    return Response.json({ error: 'Unable to import the existing article right now.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
};
