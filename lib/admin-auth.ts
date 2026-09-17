import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { resolveClientIp } from './enquiry-rate-limit.ts';

const PASSWORD_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 32_768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const SESSION_COOKIE = 'pp_admin_session';
const CSRF_COOKIE = 'pp_admin_csrf';

type CookieJar = {
  set(name: string, value: string, options?: Record<string, unknown>): void;
  delete(name: string, options?: Record<string, unknown>): void;
};

export type AdminLoginRateLimit = {
  ipKey: string;
  emailKey: string;
  ipLimit: number;
  emailLimit: number;
};

export { CSRF_COOKIE, SESSION_COOKIE };

function deriveScrypt(password: string, salt: Buffer) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, PASSWORD_KEY_LENGTH, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

function requiredAdminSecret() {
  const secret = process.env.ADMIN_AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('ADMIN_AUTH_SECRET must contain at least 32 characters.');
  }
  return secret;
}

function positiveInteger(name: string, fallback: number, maximum: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${name} must be an integer between 1 and ${maximum}.`);
  }
  return value;
}

function firstForwardedValue(value: string | null) {
  return value?.split(',')[0]?.trim() || '';
}

function publicHost(request: Request) {
  const forwardedHost = process.env.TRUST_PROXY === 'true'
    ? firstForwardedValue(request.headers.get('x-forwarded-host'))
    : '';
  return (forwardedHost || firstForwardedValue(request.headers.get('host')) || new URL(request.url).host).toLowerCase();
}

export function normalizeAdminEmail(value: string) {
  return value.trim().toLowerCase();
}

export function isValidAdminEmail(value: string) {
  const email = normalizeAdminEmail(value);
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function secureTextEqual(left: string, right: string) {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function passwordValidationError(password: string) {
  if (password.length < 16) return 'Use a password with at least 16 characters.';
  if (password.length > 256) return 'Password must be 256 characters or fewer.';
  return '';
}

export async function hashAdminPassword(password: string) {
  const error = passwordValidationError(password);
  if (error) throw new Error(error);
  const salt = randomBytes(16);
  const hash = await deriveScrypt(password, salt);
  return [
    'scrypt',
    SCRYPT_OPTIONS.N,
    SCRYPT_OPTIONS.r,
    SCRYPT_OPTIONS.p,
    salt.toString('base64url'),
    hash.toString('base64url'),
  ].join('$');
}

export async function verifyAdminPassword(password: string, encoded: string) {
  const [algorithm, n, r, p, saltText, hashText] = encoded.split('$');
  if (
    algorithm !== 'scrypt' ||
    n !== String(SCRYPT_OPTIONS.N) ||
    r !== String(SCRYPT_OPTIONS.r) ||
    p !== String(SCRYPT_OPTIONS.p) ||
    !saltText ||
    !hashText
  ) return false;

  try {
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');
    if (salt.length !== 16 || expected.length !== PASSWORD_KEY_LENGTH) return false;
    const actual = await deriveScrypt(password, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function createAdminSessionTokens() {
  const sessionToken = randomBytes(48).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  return {
    sessionToken,
    csrfToken,
    sessionHash: tokenHash(sessionToken),
    csrfHash: tokenHash(csrfToken),
  };
}

export function sessionDurationDays() {
  return positiveInteger('ADMIN_SESSION_DAYS', 7, 30);
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (!origin || (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'same-site')) return false;
  try {
    return new URL(origin).host.toLowerCase() === publicHost(request);
  } catch {
    return false;
  }
}

export function isSecureRequest(request: Request) {
  if (process.env.TRUST_PROXY === 'true') {
    return firstForwardedValue(request.headers.get('x-forwarded-proto')).toLowerCase() === 'https';
  }
  return new URL(request.url).protocol === 'https:';
}

function cookieOptions(request: Request) {
  return {
    path: '/',
    sameSite: 'strict',
    secure: isSecureRequest(request),
  } as const;
}

export function setAdminSessionCookies(cookies: CookieJar, request: Request, sessionToken: string, csrfToken: string) {
  const maxAge = sessionDurationDays() * 24 * 60 * 60;
  const options = cookieOptions(request);
  cookies.set(SESSION_COOKIE, sessionToken, { ...options, httpOnly: true, maxAge });
  cookies.set(CSRF_COOKIE, csrfToken, { ...options, httpOnly: false, maxAge });
}

export function clearAdminSessionCookies(cookies: CookieJar, request: Request) {
  const options = cookieOptions(request);
  cookies.delete(SESSION_COOKIE, { ...options, httpOnly: true });
  cookies.delete(CSRF_COOKIE, { ...options, httpOnly: false });
}

export function createAdminLoginRateLimit(request: Request, directAddress: string | undefined, email: string): AdminLoginRateLimit {
  const secret = requiredAdminSecret();
  const ip = resolveClientIp(request, directAddress);
  const normalizedEmail = normalizeAdminEmail(email);
  return {
    ipKey: createHmac('sha256', secret).update(`admin-login-ip:${ip}`).digest('hex'),
    emailKey: createHmac('sha256', secret).update(`admin-login-email:${normalizedEmail}`).digest('hex'),
    ipLimit: positiveInteger('ADMIN_LOGIN_IP_LIMIT_PER_15_MINUTES', 10, 100),
    emailLimit: positiveInteger('ADMIN_LOGIN_EMAIL_LIMIT_PER_15_MINUTES', 5, 50),
  };
}
