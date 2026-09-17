import { access, readFile, readdir } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve('dist/client');
const redirects = await readFile(join(root, '_redirects'), 'utf8').catch(() => '');
const redirectPaths = new Set(redirects.split('\n').map(line => line.trim().split(/\s+/)[0]).filter(Boolean));
const htmlFiles = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (extname(entry.name) === '.html') htmlFiles.push(path);
  }
}
await walk(root);

const errors = [];
for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  if (!/<title>[^<]+<\/title>/.test(html)) errors.push(`${file}: missing title`);
  if (!/<meta name="description" content="[^"]+"/.test(html)) errors.push(`${file}: missing description`);
  if (!/<link rel="canonical" href="https:\/\/presspixelcreations\.com\//.test(html)) errors.push(`${file}: missing canonical`);
  if (!/<h1[ >]/.test(html)) errors.push(`${file}: missing h1`);

  // Social sharing metadata: every indexable page must ship a large card image.
  const ogImage = html.match(/<meta property="og:image" content="([^"]+)"/)?.[1];
  if (!ogImage) errors.push(`${file}: missing og:image`);
  else if (!ogImage.startsWith('https://presspixelcreations.com/')) errors.push(`${file}: og:image is not an absolute site URL`);
  if (!/^https:\/\/[^\"]+\.(png|jpg|jpeg|webp)$/i.test(ogImage || '')) errors.push(`${file}: og:image should be a shareable raster image, got ${ogImage}`);
  if (!/<meta name="twitter:card" content="summary_large_image"/.test(html)) errors.push(`${file}: twitter card is not summary_large_image`);
  if (!/<meta name="twitter:image" content="[^"]+"/.test(html)) errors.push(`${file}: missing twitter:image`);
  if (!/<meta property="og:image:width" content="1200"/.test(html) || !/<meta property="og:image:height" content="630"/.test(html)) {
    errors.push(`${file}: og:image dimensions are not declared`);
  }

  // Titles are measured after decoding entities, matching how a search engine sees them.
  const rawTitle = html.match(/<title>([^<]*)<\/title>/)?.[1] || '';
  const title = rawTitle.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"');
  if (title.length > 62) errors.push(`${file}: title is ${title.length} characters and may be truncated in search results`);


  // Legal pages are generated from lib/legal.json; numbered sections must be
  // real headings so they are navigable and machine-readable.
  if (/\/(privacy-policy|terms-of-service|refund_returns)\/index\.html$/.test(file)) {
    const legalBody = html.match(/<article class="wrap legal-body"[\s\S]*?<\/article>/)?.[0] || '';
    if (!/<h2>\s*1\./.test(legalBody)) errors.push(`${file}: legal sections are not marked up as headings`);
    if (/utm_source=/.test(html)) errors.push(`${file}: legal page contains tracking parameters`);
  }

  for (const match of html.matchAll(/href="([^"]+)"/g)) {
    const href = match[1];
    if (!href.startsWith('/') || href.startsWith('//')) continue;
    const pathname = href.split(/[?#]/)[0] || '/';
    if (redirectPaths.has(pathname)) continue;
    // Database-backed journal routes are resolved by SSR at request time.
    if (pathname === '/journal' || (pathname.startsWith('/journal/') && pathname !== '/journal/')) continue;
    const target = pathname === '/' ? join(root, 'index.html') : join(root, pathname, 'index.html');
    const direct = join(root, pathname);
    try { await access(target); }
    catch { try { await access(direct); } catch { errors.push(`${file}: broken internal link ${href}`); } }
  }
}

await access(resolve('dist/server/entry.mjs')).catch(() => errors.push('missing Node server entrypoint'));
const serverEntry = await readFile(resolve('dist/server/entry.mjs'), 'utf8').catch(() => '');
if (!serverEntry) errors.push('Node server entrypoint is empty');

await access(resolve('server.mjs')).catch(() => errors.push('missing production server wrapper'));
await access(resolve('dist/server/start.mjs')).catch(() => errors.push('missing Hostinger production entry'));
const productionServer = await readFile(resolve('server.mjs'), 'utf8').catch(() => '');
if (!productionServer.includes("./dist/server/entry.mjs") || !productionServer.includes("from 'compression'")) {
  errors.push('production server wrapper is not wired to Astro and compression');
}
if (!productionServer.includes('Content-Security-Policy') || !productionServer.includes('Strict-Transport-Security')) {
  errors.push('production server wrapper is missing required security headers');
}

const securityPolicyText = await readFile(resolve('dist/server/security-policy.json'), 'utf8').catch(() => '');
let securityPolicy;
try { securityPolicy = JSON.parse(securityPolicyText); } catch { errors.push('generated security policy is missing or invalid'); }
if (!securityPolicy?.contentSecurityPolicy?.includes("frame-ancestors 'none'")) errors.push('CSP is missing frame-ancestors protection');
if (!securityPolicy?.contentSecurityPolicy?.includes("script-src 'self' 'sha256-")) errors.push('CSP is missing inline-script hashes');
if (!securityPolicy?.contentSecurityPolicy?.includes('https://api.cloudinary.com')) errors.push('CSP is missing the Cloudinary upload endpoint');
if (!securityPolicy?.contentSecurityPolicy?.includes('https://res.cloudinary.com')) errors.push('CSP is missing the Cloudinary image host');
if (securityPolicy?.contentSecurityPolicy?.includes("'unsafe-inline'")) errors.push('CSP unexpectedly permits unsafe inline content');

const packageJson = JSON.parse(await readFile(resolve('package.json'), 'utf8'));
if (!packageJson.scripts?.start?.includes('server.mjs')) errors.push('start script does not use production server wrapper');
if (!packageJson.scripts?.start?.includes('--env-file-if-exists=.env')) errors.push('start script does not load the optional local environment file');

const robots = await readFile(resolve('public/robots.txt'), 'utf8').catch(() => '');
if (!robots.includes('Sitemap: https://presspixelcreations.com/sitemap.xml')) errors.push('robots.txt does not point to the runtime sitemap');
const databaseSchema = await readFile(resolve('db/schema.sql'), 'utf8').catch(() => '');
if (!databaseSchema.includes('CREATE TABLE IF NOT EXISTS enquiry_rate_limits') || !databaseSchema.includes('ip_hash CHAR(64)')) {
  errors.push('database schema is missing enquiry abuse-protection structures');
}
await access(resolve('db/migrations/001_enquiry_abuse_protection.sql')).catch(() => errors.push('missing enquiry abuse-protection migration'));
await access(resolve('db/migrations/002_notification_retry_queue.sql')).catch(() => errors.push('missing notification retry migration'));
if (!databaseSchema.includes('notification_next_attempt_at') || !databaseSchema.includes('idx_enquiries_notification_queue')) {
  errors.push('database schema is missing notification retry structures');
}
await access(resolve('db/migrations/003_enquiry_consent_version.sql')).catch(() => errors.push('missing enquiry consent-version migration'));
await access(resolve('db/migrations/004_blog_admin_foundation.sql')).catch(() => errors.push('missing blog admin-foundation migration'));
if (!databaseSchema.includes('CREATE TABLE IF NOT EXISTS admin_users') || !databaseSchema.includes('CREATE TABLE IF NOT EXISTS blog_posts') || !databaseSchema.includes('CREATE TABLE IF NOT EXISTS blog_post_redirects')) {
  errors.push('database schema is missing blog admin foundation structures');
}
if (!databaseSchema.includes('uq_admin_users_singleton (singleton_key)')) {
  errors.push('database schema does not enforce the one-admin limit');
}

// The sharing image must exist and use the card dimensions social platforms expect.
try {
  const png = await readFile(resolve('dist/client/images/og-default.png'));
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  if (width !== 1200 || height !== 630) errors.push(`social sharing image is ${width}x${height}, expected 1200x630`);
} catch {
  errors.push('missing social sharing image dist/client/images/og-default.png');
}
if (!databaseSchema.includes('consent_version')) errors.push('database schema is missing consent version tracking');

// The recorded consent version must match the privacy policy's own date, so the
// constant cannot silently drift when the policy is revised.
const legal = JSON.parse(await readFile(resolve('lib/legal.json'), 'utf8').catch(() => '{}'));
const consentSource = await readFile(resolve('lib/enquiry-consent.ts'), 'utf8').catch(() => '');
const policyHtml = legal['privacy-policy']?.html || '';
const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const policyDate = policyHtml.match(/Last Updated:\s*<\/strong>\s*([A-Za-z]+)\s+(\d{4})/);
if (!policyDate) {
  errors.push('privacy policy is missing a Last Updated date');
} else {
  const monthIndex = monthNames.indexOf(policyDate[1].toLowerCase());
  const expected = monthIndex === -1 ? 'unknown' : `${policyDate[2]}-${String(monthIndex + 1).padStart(2, '0')}`;
  const declared = consentSource.match(/CONSENT_VERSION\s*=\s*'([^']+)'/)?.[1];
  if (declared !== expected) {
    errors.push(`consent version ${declared} does not match privacy policy date ${expected}`);
  }
}

const serverChunks = await readdir(resolve('dist/server/chunks')).catch(() => []);
let foundEnquiryEndpoint = false;
let foundAdminEndpoint = false;
let foundSitemapEndpoint = false;
for (const chunk of serverChunks) {
  if (!chunk.endsWith('.mjs') && !chunk.endsWith('.js')) continue;
  const content = await readFile(resolve('dist/server/chunks', chunk), 'utf8').catch(() => '');
  if (content.includes('/api/enquiries') || content.includes('Enquiry save failed')) {
    foundEnquiryEndpoint = true;
  }
  if (content.includes('Admin sign-in failed') || content.includes('pp_admin_session')) {
    foundAdminEndpoint = true;
  }
  if (content.includes('listPublicBlogSitemapEntries')) {
    foundSitemapEndpoint = true;
  }
  if (foundEnquiryEndpoint && foundAdminEndpoint && foundSitemapEndpoint) break;
}
if (!foundEnquiryEndpoint && !serverEntry.includes('/api/enquiries')) {
  errors.push('enquiry endpoint missing from Node server bundle');
}
if (!foundAdminEndpoint && !serverEntry.includes('/api/admin/login')) {
  errors.push('admin authentication endpoint missing from Node server bundle');
}
if (!serverEntry.includes('/admin/posts') || !serverEntry.includes('/api/admin/posts') || !serverEntry.includes('/api/admin/media')) {
  errors.push('admin editor or media endpoint missing from Node server bundle');
}
if (!serverEntry.includes('/sitemap.xml') || !foundSitemapEndpoint) {
  errors.push('runtime database-backed sitemap missing from Node server bundle');
}
if (!serverEntry.includes('/api/internal/blog-publishing')) {
  errors.push('scheduled blog publishing worker missing from Node server bundle');
}
const clientAssets = await readdir(resolve('dist/client/_astro')).catch(() => []);
for (const asset of clientAssets) {
  const content = await readFile(resolve('dist/client/_astro', asset), 'utf8').catch(() => '');
  if (content.includes('CLOUDINARY_API_SECRET')) errors.push(`client asset ${asset} exposes a Cloudinary API secret reference`);
}

if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`Validated ${htmlFiles.length} prerendered HTML pages, internal links, Node server output, enquiry endpoint, admin editor, runtime sitemap, and scheduled publishing routes.`);
