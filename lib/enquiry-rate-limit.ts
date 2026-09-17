import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

export type EnquiryRateLimit = {
  ipHash: string;
  ipKey: string;
  emailKey: string;
  ipLimit: number;
  emailLimit: number;
};

function firstForwardedValue(value: string | null) {
  return value?.split(',')[0]?.trim() || '';
}

function normalizeIp(value: string) {
  let candidate = value.trim().toLowerCase();
  if (!candidate) return '';

  if (candidate.startsWith('[')) {
    const closingBracket = candidate.indexOf(']');
    if (closingBracket > 0) candidate = candidate.slice(1, closingBracket);
  } else if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(candidate)) {
    candidate = candidate.slice(0, candidate.lastIndexOf(':'));
  }

  const zoneIndex = candidate.indexOf('%');
  if (zoneIndex > 0) candidate = candidate.slice(0, zoneIndex);
  if (candidate.startsWith('::ffff:') && isIP(candidate.slice(7)) === 4) candidate = candidate.slice(7);

  return isIP(candidate) ? candidate : '';
}

export function resolveClientIp(request: Request, directAddress: string | undefined, trustProxy = process.env.TRUST_PROXY === 'true') {
  if (trustProxy) {
    const forwarded =
      firstForwardedValue(request.headers.get('cf-connecting-ip')) ||
      firstForwardedValue(request.headers.get('x-forwarded-for')) ||
      firstForwardedValue(request.headers.get('x-real-ip'));
    const normalizedForwarded = normalizeIp(forwarded);
    if (normalizedForwarded) return normalizedForwarded;
  }

  const normalizedDirect = normalizeIp(directAddress || '');
  if (normalizedDirect) return normalizedDirect;
  throw new Error('A valid client IP address is required for enquiry rate limiting.');
}

function requiredSecret() {
  const secret = process.env.ENQUIRY_RATE_LIMIT_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('ENQUIRY_RATE_LIMIT_SECRET must contain at least 32 characters.');
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

export function keyedHash(value: string, secret: string) {
  return createHmac('sha256', secret).update(value).digest('hex');
}

export function createEnquiryRateLimit(request: Request, directAddress: string | undefined, email: string): EnquiryRateLimit {
  const secret = requiredSecret();
  const ip = resolveClientIp(request, directAddress);
  const normalizedEmail = email.trim().toLowerCase();

  return {
    ipHash: keyedHash(`stored-ip:${ip}`, secret),
    ipKey: keyedHash(`rate-ip:${ip}`, secret),
    emailKey: keyedHash(`rate-email:${normalizedEmail}`, secret),
    ipLimit: positiveInteger('ENQUIRY_IP_LIMIT_PER_HOUR', 10, 1000),
    emailLimit: positiveInteger('ENQUIRY_EMAIL_LIMIT_PER_HOUR', 3, 100),
  };
}
