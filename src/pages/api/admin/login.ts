import type { APIRoute } from 'astro';
import {
  createAdminLoginRateLimit,
  createAdminSessionTokens,
  hashAdminPassword,
  isSameOriginRequest,
  isValidAdminEmail,
  normalizeAdminEmail,
  passwordValidationError,
  secureTextEqual,
  sessionDurationDays,
  setAdminSessionCookies,
  verifyAdminPassword,
} from '../../../../lib/admin-auth';
import {
  consumeAdminLoginRateLimit,
  createAdminSession,
  ensureBootstrapAdmin,
  findAdminByEmail,
  hasAdminUsers,
} from '../../../../db/admin';

export const prerender = false;

function redirect(context: Parameters<APIRoute>[0], error?: string) {
  return context.redirect(`/admin/login${error ? `?error=${error}` : ''}`, 303);
}

async function bootstrapFirstAdmin(submittedEmail: string, submittedPassword: string) {
  if (await hasAdminUsers()) return 'ready' as const;

  const email = normalizeAdminEmail(process.env.ADMIN_BOOTSTRAP_EMAIL || '');
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD || '';
  if (!isValidAdminEmail(email) || passwordValidationError(password)) return 'setup' as const;
  if (!secureTextEqual(submittedEmail, email) || !secureTextEqual(submittedPassword, password)) return 'invalid' as const;

  const created = await ensureBootstrapAdmin(email, await hashAdminPassword(password));
  if (created) process.env.ADMIN_BOOTSTRAP_PASSWORD = '';
  return 'ready' as const;
}

export const POST: APIRoute = async (context) => {
  const { request, clientAddress, cookies } = context;
  if (!isSameOriginRequest(request)) {
    return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
  }
  if (!request.headers.get('content-type')?.includes('application/x-www-form-urlencoded')) return redirect(context, 'invalid');
  if (Number(request.headers.get('content-length') || 0) > 4096) return redirect(context, 'invalid');

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return redirect(context, 'invalid');
  }

  const email = normalizeAdminEmail(typeof form.get('email') === 'string' ? String(form.get('email')) : '');
  const password = typeof form.get('password') === 'string' ? String(form.get('password')) : '';
  if (!isValidAdminEmail(email) || password.length > 256) return redirect(context, 'invalid');

  try {
    const rateLimit = createAdminLoginRateLimit(request, clientAddress, email);
    if ((await consumeAdminLoginRateLimit(rateLimit)).limited) return redirect(context, 'limited');

    const bootstrap = await bootstrapFirstAdmin(email, password);
    if (bootstrap === 'setup') return redirect(context, 'setup');
    if (bootstrap === 'invalid') return redirect(context, 'invalid');

    const user = await findAdminByEmail(email);
    if (!user || !(await verifyAdminPassword(password, user.passwordHash))) return redirect(context, 'invalid');

    const tokens = createAdminSessionTokens();
    const expiresAt = new Date(Date.now() + sessionDurationDays() * 24 * 60 * 60 * 1000);
    await createAdminSession(user, tokens.sessionHash, tokens.csrfHash, expiresAt);
    setAdminSessionCookies(cookies, request, tokens.sessionToken, tokens.csrfToken);
    return context.redirect('/admin', 303);
  } catch (error) {
    console.error('Admin sign-in failed:', error instanceof Error ? error.message : 'Unknown error');
    return redirect(context, 'unavailable');
  }
};
