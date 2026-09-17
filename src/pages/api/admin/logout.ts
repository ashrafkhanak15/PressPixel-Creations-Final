import type { APIRoute } from 'astro';
import { clearAdminSessionCookies, CSRF_COOKIE, isSameOriginRequest, SESSION_COOKIE, tokenHash } from '../../../../lib/admin-auth';
import { deleteAdminSession, getAdminSession } from '../../../../db/admin';

export const prerender = false;

export const POST: APIRoute = async (context) => {
  const { request, cookies } = context;
  const sessionToken = cookies.get(SESSION_COOKIE)?.value;
  const csrfCookie = cookies.get(CSRF_COOKIE)?.value;
  if (!isSameOriginRequest(request) || !sessionToken || !csrfCookie) return context.redirect('/admin/login', 303);

  try {
    const form = await request.formData();
    const submittedToken = typeof form.get('csrfToken') === 'string' ? String(form.get('csrfToken')) : '';
    const session = await getAdminSession(tokenHash(sessionToken));
    if (!session || tokenHash(csrfCookie) !== session.csrfHash || tokenHash(submittedToken) !== session.csrfHash) {
      return context.redirect('/admin/login', 303);
    }
    await deleteAdminSession(tokenHash(sessionToken));
  } catch {
    // Always clear the browser cookies even if the database is unavailable.
  }

  clearAdminSessionCookies(cookies, request);
  return context.redirect('/admin/login', 303);
};
