import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import net from 'node:net';
import { resolve } from 'node:path';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return port;
}

async function waitForServer(child, readOutput) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Production server exited with code ${child.exitCode}.`);
    if (readOutput().includes('PressPixel server listening')) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 100));
  }
  throw new Error('Timed out waiting for the production server ready signal.');
}

async function request(baseUrl, pathname, acceptEncoding, init = {}) {
  return fetch(`${baseUrl}${pathname}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      'Accept-Encoding': acceptEncoding,
    },
  });
}

function assertSecurityHeaders(response, expectHsts = false) {
  const csp = response.headers.get('content-security-policy') || '';
  assert(csp.includes("default-src 'self'"), 'CSP default-src is missing.');
  assert(csp.includes("frame-ancestors 'none'"), 'CSP frame protection is missing.');
  assert(csp.includes("script-src 'self' 'sha256-"), 'CSP script hashes are missing.');
  assert(csp.includes('https://api.cloudinary.com'), 'CSP Cloudinary upload permission is missing.');
  assert(csp.includes('https://res.cloudinary.com'), 'CSP Cloudinary image permission is missing.');
  assert(!csp.includes("'unsafe-inline'"), 'CSP permits unsafe inline content.');
  assert(response.headers.get('x-content-type-options') === 'nosniff', 'MIME-sniffing protection is missing.');
  assert(response.headers.get('referrer-policy') === 'strict-origin-when-cross-origin', 'Referrer policy is incorrect.');
  assert(response.headers.get('x-frame-options') === 'DENY', 'Legacy frame protection is missing.');
  assert(response.headers.get('cross-origin-opener-policy') === 'same-origin', 'Opener isolation is missing.');
  assert(response.headers.get('permissions-policy')?.includes('camera=()'), 'Permissions policy is missing.');
  if (expectHsts) assert(response.headers.get('strict-transport-security') === 'max-age=31536000', 'HSTS is missing for HTTPS traffic.');
  else assert(!response.headers.has('strict-transport-security'), 'HSTS was sent over plain HTTP.');
}

const port = await availablePort();
const baseUrl = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['./server.mjs'], {
  cwd: resolve('.'),
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(port),
    INTERNAL_NOTIFICATION_WORKER_TOKEN: 'local-internal-worker-verification-token',
    INTERNAL_PUBLISH_WORKER_TOKEN: 'local-publish-worker-verification-token',
    HEALTHCHECK_TOKEN: 'local-healthcheck-token-with-at-least-32-characters',
    ADMIN_AUTH_SECRET: 'local-admin-auth-secret-with-more-than-32-characters',
    ENQUIRY_NOTIFICATION_WORKER_INTERVAL_SECONDS: '3600',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });

try {
  await waitForServer(child, () => output);

  const assetFiles = await readdir(resolve('dist/client/_astro'));
  const javascript = assetFiles.find(file => file.endsWith('.js'));
  const stylesheet = assetFiles.find(file => file.endsWith('.css'));
  assert(javascript, 'No generated JavaScript asset was found.');
  assert(stylesheet, 'No generated CSS asset was found.');

  const home = await request(baseUrl, '/', 'br');
  assert(home.status === 200, `Home returned ${home.status}.`);
  assert(home.headers.get('content-encoding') === 'br', 'Home HTML was not Brotli compressed.');
  assert(home.headers.get('cache-control') === 'public, max-age=0, must-revalidate', 'Home HTML cache policy is incorrect.');
  assertSecurityHeaders(home);

  const secureHome = await request(baseUrl, '/', 'br', { headers: { 'X-Forwarded-Proto': 'https' } });
  assertSecurityHeaders(secureHome, true);

  const js = await request(baseUrl, `/_astro/${javascript}`, 'br');
  assert(js.status === 200, `JavaScript asset returned ${js.status}.`);
  assert(js.headers.get('content-encoding') === 'br', 'JavaScript was not Brotli compressed.');
  assert(js.headers.get('cache-control') === 'public, max-age=31536000, immutable', 'Hashed JavaScript cache policy is incorrect.');

  const css = await request(baseUrl, `/_astro/${stylesheet}`, 'gzip');
  assert(css.status === 200, `CSS asset returned ${css.status}.`);
  assert(css.headers.get('content-encoding') === 'gzip', 'CSS was not gzip compressed.');
  assert(css.headers.get('cache-control') === 'public, max-age=31536000, immutable', 'Hashed CSS cache policy is incorrect.');

  const image = await request(baseUrl, '/images/chrome-loop-orange.webp', 'br');
  assert(image.status === 200, `Image returned ${image.status}.`);
  assert(image.headers.get('cache-control') === 'public, max-age=604800, stale-while-revalidate=86400', 'Public image cache policy is incorrect.');

  const adminLogin = await request(baseUrl, '/admin/login', 'br');
  assert(adminLogin.status === 200, `Admin login returned ${adminLogin.status}.`);
  assert(adminLogin.headers.get('cache-control') === 'no-store', 'Admin login is cacheable.');
  assert(adminLogin.headers.get('x-robots-tag') === 'noindex, nofollow, noarchive', 'Admin login is indexable.');
  assertSecurityHeaders(adminLogin);

  const adminDashboard = await request(baseUrl, '/admin', 'br', { redirect: 'manual' });
  assert(adminDashboard.status === 302, `Unauthenticated admin dashboard returned ${adminDashboard.status}, expected 302.`);
  assert(adminDashboard.headers.get('location') === '/admin/login', 'Unauthenticated admin dashboard redirects to the wrong location.');
  assert(adminDashboard.headers.get('cache-control') === 'no-store', 'Admin redirect is cacheable.');

  const adminPosts = await request(baseUrl, '/admin/posts', 'br', { redirect: 'manual' });
  assert(adminPosts.status === 302 && adminPosts.headers.get('location') === '/admin/login', 'Unauthenticated post editor list is not protected.');

  const unauthorizedPostCreate = await request(baseUrl, '/api/admin/posts', 'br', {
    method: 'POST',
    headers: { Origin: baseUrl, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'csrfToken=missing',
  });
  assert(unauthorizedPostCreate.status === 401, `Unauthenticated post creation returned ${unauthorizedPostCreate.status}, expected 401.`);

  const unauthorizedMediaSignature = await request(baseUrl, '/api/admin/media/sign', 'br', {
    method: 'POST',
    headers: { Origin: baseUrl, 'X-CSRF-Token': 'missing' },
  });
  assert(unauthorizedMediaSignature.status === 401, `Unauthenticated media signature returned ${unauthorizedMediaSignature.status}, expected 401.`);

  const journal = await request(baseUrl, '/journal', 'br');
  assert(journal.status === 200, `Journal returned ${journal.status}.`);
  assert(journal.headers.get('cache-control') === 'public, max-age=0, must-revalidate', 'Journal cache policy is incorrect.');
  assert((await journal.text()).includes('Why Your Small-Business Website Is Not Generating Leads'), 'Journal fallback article is missing when the database is unavailable.');

  const fallbackArticle = await request(baseUrl, '/journal/why-small-businesses-need-more-than-just-a-website-in-2026', 'br');
  assert(fallbackArticle.status === 200, `Fallback journal article returned ${fallbackArticle.status}.`);
  assert((await fallbackArticle.text()).includes('Why Your Small-Business Website Is Not Generating Leads'), 'Fallback journal article content is missing.');

  const missingArticle = await request(baseUrl, '/journal/does-not-exist', 'br');
  assert(missingArticle.status === 404, `Missing journal article returned ${missingArticle.status}, expected 404.`);
  assert(missingArticle.headers.get('x-robots-tag') === null, 'Public missing article received an admin robots header.');

  const sitemap = await request(baseUrl, '/sitemap.xml', 'br');
  const sitemapText = await sitemap.text();
  assert(sitemap.status === 200, `Runtime sitemap returned ${sitemap.status}.`);
  assert(sitemap.headers.get('content-type')?.includes('application/xml'), 'Runtime sitemap content type is incorrect.');
  assert(sitemap.headers.get('cache-control') === 'public, max-age=3600, stale-while-revalidate=86400', 'Runtime sitemap cache policy is incorrect.');
  assert(sitemapText.includes('<urlset'), 'Runtime sitemap is not XML.');
  assert(sitemapText.includes('/journal/why-small-businesses-need-more-than-just-a-website-in-2026'), 'Runtime sitemap fallback article is missing.');
  assert(!sitemapText.includes('/admin'), 'Runtime sitemap contains an admin route.');

  const crossSiteAdminLogin = await request(baseUrl, '/api/admin/login', 'br', {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Origin: 'https://attacker.example',
      'Sec-Fetch-Site': 'cross-site',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'email=admin%40example.com&password=not-a-real-password',
  });
  assert(crossSiteAdminLogin.status === 403, `Cross-site admin login returned ${crossSiteAdminLogin.status}, expected 403.`);

  const missingOrigin = await request(baseUrl, '/api/enquiries', 'br', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert(missingOrigin.status === 403, `Origin-less enquiry returned ${missingOrigin.status}, expected 403.`);

  const crossSite = await request(baseUrl, '/api/enquiries', 'br', {
    method: 'POST',
    headers: {
      Origin: 'https://attacker.example',
      'Sec-Fetch-Site': 'cross-site',
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert(crossSite.status === 403, `Cross-site enquiry returned ${crossSite.status}, expected 403.`);

  const api = await request(baseUrl, '/api/enquiries', 'br', {
    method: 'POST',
    headers: {
      Origin: baseUrl,
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  assert(api.status === 400, `Invalid enquiry returned ${api.status}, expected 400.`);
  assert(api.headers.get('cache-control') === 'no-store', 'API response is cacheable.');
  assertSecurityHeaders(api);

  const unauthorizedWorker = await request(baseUrl, '/api/internal/enquiry-notifications', 'br', {
    method: 'POST',
    headers: { Origin: baseUrl },
  });
  assert(unauthorizedWorker.status === 404, `Unauthorized retry worker returned ${unauthorizedWorker.status}, expected 404.`);
  const authorizedWorker = await request(baseUrl, '/api/internal/enquiry-notifications', 'br', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer local-internal-worker-verification-token',
      Origin: baseUrl,
    },
  });
  assert(authorizedWorker.status === 503, `Retry worker without database returned ${authorizedWorker.status}, expected 503.`);

  const unauthorizedReadiness = await request(baseUrl, '/api/internal/readiness', 'br', { method: 'POST', headers: { Origin: baseUrl } });
  assert(unauthorizedReadiness.status === 404, `Unauthorized readiness endpoint returned ${unauthorizedReadiness.status}, expected 404.`);
  const unauthorizedShutdown = await request(baseUrl, '/api/internal/shutdown', 'br', { method: 'POST', headers: { Origin: baseUrl } });
  assert(unauthorizedShutdown.status === 404, `Unauthorized shutdown endpoint returned ${unauthorizedShutdown.status}, expected 404.`);

  const unauthorizedPublisher = await request(baseUrl, '/api/internal/blog-publishing', 'br', { method: 'POST', headers: { Origin: baseUrl } });
  assert(unauthorizedPublisher.status === 404, `Unauthorized publishing worker returned ${unauthorizedPublisher.status}, expected 404.`);
  const authorizedPublisher = await request(baseUrl, '/api/internal/blog-publishing', 'br', {
    method: 'POST',
    headers: { Authorization: 'Bearer local-publish-worker-verification-token', Origin: baseUrl },
  });
  assert(authorizedPublisher.status === 503, `Publishing worker without database returned ${authorizedPublisher.status}, expected 503.`);

  const unauthorizedHealth = await request(baseUrl, '/api/health', 'br');
  assert(unauthorizedHealth.status === 404, `Unauthorized health check returned ${unauthorizedHealth.status}, expected 404.`);
  const authorizedHealth = await request(baseUrl, '/api/health', 'br', {
    headers: { Authorization: 'Bearer local-healthcheck-token-with-at-least-32-characters' },
  });
  assert(authorizedHealth.status === 503, `Health check without database returned ${authorizedHealth.status}, expected 503.`);
  assert(authorizedHealth.headers.get('cache-control') === 'no-store', 'Health response is cacheable.');

  console.log('Validated compression, cache and security headers, public journal fallback, runtime sitemap, enquiry origin checks, protected admin/editor/internal routes, and authenticated degraded-health handling.');
} catch (error) {
  console.error(output.trim());
  throw error;
} finally {
  child.kill();
  await new Promise(resolveExit => {
    if (child.exitCode !== null) return resolveExit();
    child.once('exit', resolveExit);
    setTimeout(resolveExit, 2000);
  });
}
