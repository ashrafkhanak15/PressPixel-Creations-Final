process.env.ADMIN_AUTH_SECRET = 'local-admin-auth-secret-with-more-than-32-characters';
process.env.TRUST_PROXY = 'true';

const {
  createAdminLoginRateLimit,
  createAdminSessionTokens,
  hashAdminPassword,
  isSameOriginRequest,
  isValidAdminEmail,
  passwordValidationError,
  secureTextEqual,
  setAdminSessionCookies,
  tokenHash,
  verifyAdminPassword,
} = await import('../lib/admin-auth.ts');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const password = 'a unique long local admin password';
const encoded = await hashAdminPassword(password);
assert(encoded.startsWith('scrypt$32768$8$1$'), 'Password did not use the expected scrypt parameters.');
assert(await verifyAdminPassword(password, encoded), 'Correct password did not verify.');
assert(!(await verifyAdminPassword(`${password}!`, encoded)), 'Incorrect password verified.');
assert(passwordValidationError('too-short') === 'Use a password with at least 16 characters.', 'Short password was accepted.');
assert(isValidAdminEmail('Admin@Example.com'), 'Valid admin email was rejected.');
assert(!isValidAdminEmail('not-an-email'), 'Invalid admin email was accepted.');
assert(secureTextEqual('bootstrap credential', 'bootstrap credential'), 'Equal bootstrap credentials did not match.');
assert(!secureTextEqual('bootstrap credential', 'different credential'), 'Different bootstrap credentials matched.');

const request = new Request('https://presspixelcreations.com/api/admin/login', {
  headers: {
    origin: 'https://presspixelcreations.com',
    'sec-fetch-site': 'same-origin',
    'x-forwarded-host': 'presspixelcreations.com',
    'x-forwarded-proto': 'https',
    'x-forwarded-for': '203.0.113.61, 198.51.100.8',
  },
});
assert(isSameOriginRequest(request), 'Same-origin admin request was rejected.');
assert(!isSameOriginRequest(new Request('https://presspixelcreations.com/api/admin/login', { headers: { origin: 'https://attacker.example' } })), 'Cross-site admin request was accepted.');

const limiter = createAdminLoginRateLimit(request, '127.0.0.1', 'Admin@Example.com');
const serializedLimiter = JSON.stringify(limiter);
assert(!serializedLimiter.includes('203.0.113.61') && !serializedLimiter.includes('admin@example.com'), 'Admin rate limiter exposed raw identifiers.');
assert(limiter.ipLimit === 10 && limiter.emailLimit === 5, 'Admin rate-limit defaults are incorrect.');

const session = createAdminSessionTokens();
assert(session.sessionToken !== session.sessionHash && session.csrfToken !== session.csrfHash, 'Raw session values were stored as hashes.');
assert(tokenHash(session.sessionToken) === session.sessionHash, 'Session hash is not stable.');

const cookies = { setCalls: [], set(...args) { this.setCalls.push(args); }, delete() {} };
setAdminSessionCookies(cookies, request, session.sessionToken, session.csrfToken);
assert(cookies.setCalls.length === 2, 'Admin login did not set both cookies.');
assert(cookies.setCalls.every(([, , options]) => options.path === '/' && options.sameSite === 'strict' && options.secure === true), 'Admin cookie security options are incorrect.');
assert(cookies.setCalls.find(([name]) => name === 'pp_admin_session')?.[2].httpOnly === true, 'Session cookie is not HttpOnly.');
assert(cookies.setCalls.find(([name]) => name === 'pp_admin_csrf')?.[2].httpOnly === false, 'CSRF cookie should be readable by the dashboard form.');

console.log('Validated scrypt passwords, protected session tokens, secure cookies, same-origin checks, and raw-identifier-free admin login limits.');
