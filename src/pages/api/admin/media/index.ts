import type { APIRoute } from 'astro';
import { z } from 'zod';
import { createBlogMedia } from '../../../../../db/blog';
import { isResponse, requireAdminMutation } from '../../../../../lib/admin-request';
import { isExpectedCloudinaryImage } from '../../../../../lib/cloudinary';

export const prerender = false;

const assetSchema = z.object({
  publicId: z.string().min(1).max(255),
  url: z.string().url().max(1_000),
  width: z.number().int(),
  height: z.number().int(),
});

export const POST: APIRoute = async (context) => {
  const authorization = await requireAdminMutation(context, context.request.headers.get('x-csrf-token') || '');
  if (isResponse(authorization)) return authorization;

  try {
    const asset = assetSchema.parse(await context.request.json());
    if (!isExpectedCloudinaryImage(asset)) {
      return new Response(JSON.stringify({ error: 'Invalid Cloudinary image response.' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }
    const media = await createBlogMedia({ uploaderId: authorization.userId, ...asset });
    return new Response(JSON.stringify({ media }), {
      status: 201,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'issues' in error) {
      return new Response(JSON.stringify({ error: 'Invalid image response.' }), { status: 400, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
    }
    return new Response(JSON.stringify({ error: 'Unable to register this image.' }), { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
  }
};
