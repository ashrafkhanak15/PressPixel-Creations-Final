import type { APIRoute } from 'astro';
import { createBlogDraft } from '../../../../../db/blog';
import { isResponse, requireAdminMutation } from '../../../../../lib/admin-request';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const formData = await context.request.formData().catch(() => null);
  const authorization = await requireAdminMutation(context, String(formData?.get('csrfToken') || ''));
  if (isResponse(authorization)) return authorization;

  try {
    const id = await createBlogDraft(authorization.userId);
    return context.redirect(`/admin/posts/${id}`, 303);
  } catch {
    return context.redirect('/admin?error=unavailable', 303);
  }
};
