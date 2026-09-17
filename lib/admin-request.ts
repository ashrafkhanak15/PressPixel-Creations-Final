import type { APIContext } from 'astro';
import { getAdminSession, type AdminSession } from '../db/admin';
import { CSRF_COOKIE, SESSION_COOKIE, isSameOriginRequest, secureTextEqual, tokenHash } from './admin-auth';

export async function getRequestAdminSession(context: Pick<APIContext, 'cookies'>) {
  const sessionToken = context.cookies.get(SESSION_COOKIE)?.value || '';
  if (!sessionToken) return null;
  return getAdminSession(tokenHash(sessionToken));
}

export async function requireAdminMutation(context: APIContext, csrfToken: string): Promise<AdminSession | Response> {
  if (!isSameOriginRequest(context.request)) {
    return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }

  const session = await getRequestAdminSession(context);
  if (!session) return new Response('Unauthorized', { status: 401, headers: { 'Cache-Control': 'no-store' } });

  const cookieToken = context.cookies.get(CSRF_COOKIE)?.value || '';
  if (!csrfToken || !cookieToken || !secureTextEqual(csrfToken, cookieToken) || !secureTextEqual(tokenHash(csrfToken), session.csrfHash)) {
    return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  return session;
}

export function isResponse(value: AdminSession | Response): value is Response {
  return value instanceof Response;
}
