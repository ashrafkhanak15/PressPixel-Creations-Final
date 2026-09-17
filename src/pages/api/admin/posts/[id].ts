import type { APIRoute } from 'astro';
import { z } from 'zod';
import { BlogSlugConflictError, getAdminBlogPost, saveAdminBlogPost } from '../../../../../db/blog';
import { isResponse, requireAdminMutation } from '../../../../../lib/admin-request';
import { blogDocumentSchema } from '../../../../../lib/blog-content';
import { denverDateTimeToUtc, isSafeCanonicalUrl, parseTags, publicationValidationError } from '../../../../../lib/blog';

export const prerender = false;

const payloadSchema = z.object({
  title: z.string().max(200),
  slug: z.string().max(200),
  excerpt: z.string().max(500),
  content: blogDocumentSchema,
  aeoSummary: z.string().max(4_000),
  seoTitle: z.string().max(62),
  metaDescription: z.string().max(170),
  canonicalUrl: z.string().max(500),
  socialTitle: z.string().max(70),
  socialDescription: z.string().max(200),
  noindex: z.boolean(),
  status: z.enum(['draft', 'scheduled', 'published', 'trashed']),
  scheduledFor: z.string().max(16),
  category: z.string().max(80),
  tags: z.array(z.string().max(80)).max(12),
  featuredMediaId: z.string().uuid().nullable(),
  featuredMediaAlt: z.string().max(300),
  featuredMediaCaption: z.string().max(500),
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export const PUT: APIRoute = async (context) => {
  const contentLength = Number(context.request.headers.get('content-length') || 0);
  if (contentLength > 1_000_000) return json({ error: 'Post data is too large.' }, 413);

  const authorization = await requireAdminMutation(context, context.request.headers.get('x-csrf-token') || '');
  if (isResponse(authorization)) return authorization;

  const id = context.params.id || '';
  if (!z.string().uuid().safeParse(id).success) return json({ error: 'Post not found.' }, 404);

  let payload: z.infer<typeof payloadSchema>;
  try {
    payload = payloadSchema.parse(await context.request.json());
  } catch {
    return json({ error: 'Some post fields are invalid.' }, 400);
  }
  if (!isSafeCanonicalUrl(payload.canonicalUrl.trim())) return json({ error: 'Canonical URL must be an http or https URL.' }, 400);

  const scheduledFor = payload.status === 'scheduled' ? denverDateTimeToUtc(payload.scheduledFor) : null;
  if (payload.status === 'scheduled' && !scheduledFor) {
    return json({ error: 'Choose a valid publish time in America/Denver. Times during the daylight-saving gap are unavailable.' }, 400);
  }
  const publicationError = publicationValidationError({
    status: payload.status,
    title: payload.title,
    slug: payload.slug,
    blockCount: payload.content.blocks.length,
    scheduledFor,
  });
  if (publicationError) return json({ error: publicationError }, 400);

  try {
    await saveAdminBlogPost({
      id,
      authorId: authorization.userId,
      title: payload.title,
      slug: payload.slug,
      excerpt: payload.excerpt,
      content: payload.content,
      aeoSummary: payload.aeoSummary,
      seoTitle: payload.seoTitle,
      metaDescription: payload.metaDescription,
      canonicalUrl: payload.canonicalUrl,
      socialTitle: payload.socialTitle,
      socialDescription: payload.socialDescription,
      noindex: payload.noindex,
      status: payload.status,
      scheduledFor,
      category: payload.category,
      tags: parseTags(payload.tags),
      featuredMediaId: payload.featuredMediaId,
      featuredMediaAlt: payload.featuredMediaAlt,
      featuredMediaCaption: payload.featuredMediaCaption,
    });
    const post = await getAdminBlogPost(id);
    return json({ post });
  } catch (error) {
    if (error instanceof BlogSlugConflictError) return json({ error: error.message }, 409);
    if (error instanceof Error && (error.message === 'Post not found.' || error.message.includes('selected images') || error.message.includes('uploaded image') || error.message.includes('each uploaded image') || error.message.includes('scheduled post') || error.message.includes('before it can be published') || error.message.includes('Category and tag'))) {
      return json({ error: error.message }, error.message === 'Post not found.' ? 404 : 400);
    }
    const databaseCode = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : 'UNKNOWN';
    console.error('Admin post save failed:', databaseCode, error instanceof Error ? error.message : 'Unknown error');
    return json({ error: 'Unable to save this post right now.' }, 503);
  }
};
