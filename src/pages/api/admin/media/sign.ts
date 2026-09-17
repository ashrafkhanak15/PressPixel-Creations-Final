import type { APIRoute } from 'astro';
import { isResponse, requireAdminMutation } from '../../../../../lib/admin-request';
import { createCloudinaryUploadSignature } from '../../../../../lib/cloudinary';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const authorization = await requireAdminMutation(context, context.request.headers.get('x-csrf-token') || '');
  if (isResponse(authorization)) return authorization;

  try {
    return new Response(JSON.stringify(createCloudinaryUploadSignature()), {
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch {
    return new Response(JSON.stringify({ error: 'Cloudinary image uploads are not configured.' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
};
