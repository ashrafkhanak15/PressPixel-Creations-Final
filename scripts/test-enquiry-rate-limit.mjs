import {
  createEnquiryRateLimit,
  keyedHash,
  resolveClientIp,
} from '../lib/enquiry-rate-limit.ts';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const request = new Request('https://presspixelcreations.com/api/enquiries', {
  headers: {
    'CF-Connecting-IP': '203.0.113.10',
    'X-Forwarded-For': '198.51.100.4, 10.0.0.1',
  },
});

assert(resolveClientIp(request, '127.0.0.1', true) === '203.0.113.10', 'Trusted proxy IP resolution failed.');
assert(resolveClientIp(request, '::ffff:127.0.0.1', false) === '127.0.0.1', 'Direct IPv4-mapped address normalization failed.');

process.env.TRUST_PROXY = 'true';
process.env.ENQUIRY_RATE_LIMIT_SECRET = 'local-test-secret-with-more-than-32-characters';
process.env.ENQUIRY_IP_LIMIT_PER_HOUR = '12';
process.env.ENQUIRY_EMAIL_LIMIT_PER_HOUR = '4';

const first = createEnquiryRateLimit(request, '127.0.0.1', 'Test@Example.com');
const second = createEnquiryRateLimit(request, '127.0.0.1', 'test@example.com');

assert(first.ipHash.length === 64, 'Stored IP hash is not SHA-256 sized.');
assert(first.ipHash === second.ipHash, 'IP hashing is not deterministic.');
assert(first.emailKey === second.emailKey, 'Email normalization is not deterministic.');
assert(first.ipHash !== first.ipKey, 'Stored IP and rate-limit keys must be domain-separated.');
assert(first.ipLimit === 12 && first.emailLimit === 4, 'Configured limits were not applied.');
assert(!JSON.stringify(first).includes('203.0.113.10'), 'Raw IP leaked into the rate-limit context.');
assert(keyedHash('one', process.env.ENQUIRY_RATE_LIMIT_SECRET) !== keyedHash('two', process.env.ENQUIRY_RATE_LIMIT_SECRET), 'Keyed hashes collided in the basic test.');

process.env.ENQUIRY_RATE_LIMIT_SECRET = 'too-short';
let rejectedShortSecret = false;
try {
  createEnquiryRateLimit(request, '127.0.0.1', 'test@example.com');
} catch {
  rejectedShortSecret = true;
}
assert(rejectedShortSecret, 'A short rate-limit secret was accepted.');

console.log('Validated trusted-proxy resolution, raw-IP avoidance, HMAC domain separation, configurable limits, and secret requirements.');
