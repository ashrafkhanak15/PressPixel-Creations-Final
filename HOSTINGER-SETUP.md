# PressPixel Creations — Hostinger deployment

This build has been converted from Cloudflare Workers + D1 to Astro's Node adapter + MySQL for Hostinger. Enquiry submissions are stored in MySQL first and then notification emails are sent to both owner inboxes.

## What was changed

- Cloudflare adapter replaced with `@astrojs/node` in standalone mode.
- Cloudflare D1 enquiry storage replaced with `mysql2` connection pooling.
- `/api/enquiries` uses validation, required same-origin requests, a honeypot, idempotency, and atomic database-backed limits by hashed client IP and email.
- SMTP notifications are sent after a successful database insert.
- Notification delivery status/error is recorded on the enquiry row.
- Retried requests with the same enquiry ID do not send duplicate notification emails.
- A protected `/admin` workspace provides one-admin sign-in, database-backed sessions, login rate limiting, private drafts, the structured block editor, private previews, SEO/AEO fields, Cloudinary media signing, and scheduling.
- The public `/journal` route now reads published posts from MySQL, promotes due scheduled posts, supports pagination, serves database-backed article URLs, preserves old slugs through redirects, and exposes a runtime database-backed `/sitemap.xml`.
- Public journal delivery uses the JSON article only as a temporary fallback when MySQL is unavailable. Migrate the existing article in Step 6, then the fallback can be removed.
- The public form and non-journal website pages are otherwise unchanged.

## 1. Hostinger database

Create a MySQL database in hPanel, configure the `DB_*` variables, and run:

```bash
npm run db:migrate
```

The migration runner installs `db/schema.sql` on an empty database, records applied versions in `schema_migrations`, and safely recognizes installations where numbered migrations were previously applied manually. Keep the SQL files for inspection, but do not rerun them manually after the runner has recorded them.

Then add these environment variables to the Hostinger web app:

- `DB_HOST`
- `DB_PORT` (normally `3306`)
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

Never put the real database password into the repository or `.env.example`.

For the first administrator, also configure:

- `ADMIN_AUTH_SECRET` with an independent random value of at least 32 characters
- `ADMIN_BOOTSTRAP_EMAIL`
- `ADMIN_BOOTSTRAP_PASSWORD` with a unique password of at least 16 characters
- `ADMIN_SESSION_DAYS=7`
- `ADMIN_LOGIN_IP_LIMIT_PER_15_MINUTES=10`
- `ADMIN_LOGIN_EMAIL_LIMIT_PER_15_MINUTES=5`

After deploying the foundation, open `/admin/login` and sign in once with the bootstrap credentials. Then remove `ADMIN_BOOTSTRAP_PASSWORD` from the Hostinger environment and restart the app. If access is ever lost, run `npm run admin:reset-password` in an interactive terminal; it replaces the scrypt password hash and revokes all existing sessions. The password is scrypt-hashed before storage; the raw bootstrap password is not stored in MySQL. Keep `ADMIN_AUTH_SECRET` configured because it protects login rate-limit keys.

To enable journal image uploads, also configure:

- `CLOUDINARY_CLOUD_NAME`
- `CLOUDINARY_API_KEY`
- `CLOUDINARY_API_SECRET`
- `CLOUDINARY_JOURNAL_FOLDER=presspixel-creations/journal` (optional)

Create these in the Cloudinary dashboard. The API secret remains only on the Node server. The editor asks the server for a short-lived signature, uploads directly to Cloudinary, then stores only the verified image identifier, URL, dimensions, alt text, and caption in MySQL. Never place the API secret in frontend code, a public upload preset, or a Git repository.

## 2. Enquiry abuse protection

Add these environment variables:

- `TRUST_PROXY=true` for Hostinger's managed proxy
- `ENQUIRY_RATE_LIMIT_SECRET` with an independent random value of at least 32 characters
- `ENQUIRY_IP_LIMIT_PER_HOUR=10`
- `ENQUIRY_EMAIL_LIMIT_PER_HOUR=3`

Generate the rate-limit secret independently. Do not reuse the database password, SMTP password, or an API key. The application HMAC-hashes network identifiers before storage, so the database never receives the raw client IP.

The limiter updates counters atomically inside the same database transaction used to save the enquiry. Missing-origin and cross-site submissions are rejected before validation or database access. If Hostinger changes its proxy behavior, verify that the first `X-Forwarded-For` address is the real visitor before leaving `TRUST_PROXY=true`.

## 3. Email notification SMTP

Configure the SMTP account that should SEND the website alerts. The notification RECIPIENTS are:

- `ashrafkhanak15@gmail.com`
- `support@presspixelcreations.com`

Add these environment variables:

- `SMTP_HOST`
- `SMTP_PORT` (commonly `465` for implicit TLS or `587` for STARTTLS)
- `SMTP_SECURE` (`true` for port 465; normally `false` for 587)
- `SMTP_USER`
- `SMTP_PASS`
- `ENQUIRY_FROM_EMAIL` (normally the same mailbox as `SMTP_USER`)
- `ENQUIRY_NOTIFY_TO=ashrafkhanak15@gmail.com,support@presspixelcreations.com`

Use the SMTP settings supplied by the provider that hosts the sending mailbox. If that mailbox uses two-factor authentication, use the provider's app password or SMTP credential instead of your normal account password where required.

The customer email is set as `Reply-To`, so clicking Reply on a notification starts a reply to the person who submitted the form. Retries use the same stable message ID to reduce duplicate delivery and keep messages threaded.

## 4. Notification retry and monitoring

Add these environment variables:

- `ENQUIRY_NOTIFICATION_MAX_ATTEMPTS=6`
- `ENQUIRY_NOTIFICATION_BATCH_SIZE=5`
- `ENQUIRY_NOTIFICATION_LEASE_SECONDS=600`
- `ENQUIRY_NOTIFICATION_WORKER_INTERVAL_SECONDS=60`
- `WORKER_STALE_GRACE_MINUTES=30`
- `HEALTHCHECK_TOKEN` with an independent random value of at least 32 characters

The production server triggers the retry worker and scheduled-blog publishing worker internally. Due notification rows are claimed with database locks and a lease, so multiple application instances cannot normally process the same row simultaneously. Failed attempts use increasing delays from five minutes to 24 hours. After the maximum attempt count, the row remains stored with its last error and the health endpoint reports a degraded state. Due scheduled posts are promoted to `published` using their stored UTC schedule.

Monitor `GET /api/health` with:

```text
Authorization: Bearer <HEALTHCHECK_TOKEN>
```

The endpoint returns counts only, never enquiry content. HTTP 200 means there are no exhausted or stale-due notifications and no overdue scheduled posts. HTTP 503 means processing is degraded or the database is unavailable.

## 5. Deterministic install, build, and start

Runtime requirements:

- Node.js 22.19 or newer; select Node.js 24.x on Hostinger because its current 22.x image is 22.18
- npm 10 or 11 (`npm@10.9.3` is the reproducible local reference declared in `package.json`)
- `package-lock.json` present beside `package.json`

Do not upload `node_modules`. Hostinger's managed Node.js deployment installs dependencies from the package files. Keep the lockfile in the deployment archive so that installation uses the reviewed dependency tree.

For a clean local, CI, or VPS deployment, install with:

```bash
npm ci
```

Hostinger build command:

```bash
npm run build
```

The public journal and sitemap are server-rendered. Keep the Node start process running rather than deploying only `dist/client` as static files.

Set `REQUIRE_PRODUCTION_SERVICES=true` in Hostinger so startup fails when required environment variables or database tables are missing. The start command also loads a local `.env` when present:

```bash
npm start
```

Before uploading a release, run this locally:

```bash
npm ci
npm run verify
npm audit --omit=dev
```

The application startup entry is `server.mjs`. It imports Astro's generated `dist/server/entry.mjs` handler and adds Brotli/gzip compression plus explicit caching rules. Keep `server.mjs` in the deployment root.

After deployment, inspect the live response headers for `/`, a `/_astro/` JavaScript file, an image, and `/api/enquiries`. Hostinger or an upstream CDN can override application headers. Expected cache and security policies are documented in `README.md`; API responses must remain `Cache-Control: no-store`.

Confirm the public HTTPS response includes `Strict-Transport-Security`. The application deliberately omits HSTS for plain HTTP requests and adds it only when the connection or Hostinger's `X-Forwarded-Proto` header indicates HTTPS. The generated CSP must contain SHA-256 script hashes and must not contain `unsafe-inline`.

Select Node.js 24.x in Hostinger. Its current 22.x image is 22.18, while the reviewed dependency tree requires Node 22.19 or newer.

## 6. Enquiry smoke test after deployment

1. Open the live `/contact` page.
2. Submit a real test enquiry using an email address you control.
3. Confirm the browser shows the success state.
4. Open phpMyAdmin and verify the row exists in the `enquiries` table.
5. Confirm `notification_sent_at` is populated and `notification_error` is empty.
6. Confirm the notification arrives at BOTH `ashrafkhanak15@gmail.com` and `support@presspixelcreations.com`.
7. Hit Reply on the notification and confirm the recipient is the test customer's email address.
8. In a controlled test only, submit more than three distinct enquiries with the same email within an hour; the fourth should return HTTP 429.
9. Confirm a row exists in `enquiry_rate_limits` and that `enquiries.ip_hash` contains a 64-character hash rather than a raw IP address.
10. Confirm the enquiry row records `consent_version` as `2026-05` (or the current privacy-policy revision) so consent can be tied to a policy version.
11. Confirm an origin-less POST to `/api/enquiries` receives HTTP 403.
12. Temporarily use invalid SMTP credentials, submit one controlled enquiry, and verify `notification_attempts`, `notification_error`, and `notification_next_attempt_at` are populated.
13. Restore SMTP credentials and confirm the queued enquiry is delivered and `/api/health` returns HTTP 200.
14. Open `/admin/login`, sign in with the bootstrap account, confirm `/admin` loads, then remove the bootstrap password from the environment.
15. Run `npm run cms:import-legacy`, confirm the article exists in `/admin/posts`, set `BLOG_LEGACY_FALLBACK=false`, and restart the application.
16. Confirm an unauthenticated request to `/admin` redirects to `/admin/login`, and an authenticated session can sign out.
17. In `/admin/posts`, create a draft containing each relevant block type, add category and tags, save it, reload the editor, and confirm the content persists.
18. Use private preview and confirm that the draft is not reachable without an authenticated session and does not appear in the public `/journal` route or sitemap.
19. With Cloudinary configured, upload a JPG, PNG, WebP, or AVIF below 10 MB, set meaningful alt text, save the draft, reload, and confirm the verified Cloudinary URL and dimensions are retained.
20. Schedule a controlled draft in `America/Denver`, confirm `blog_posts.scheduled_for` contains the corresponding UTC value, wait for the publishing worker or request the public journal after the scheduled time, and confirm the post becomes `published` with a populated `published_at`.

21. Open `/sitemap.xml` and confirm it is valid XML, contains published posts, excludes drafts and `noindex` posts, and contains no `/admin` URLs.
22. Change a published post's slug, publish the update, then confirm the old slug returns an HTTP 301 to the new slug.

Do not consider the migration complete until the database row, both notification inboxes, public journal route, scheduled publishing, sitemap, and redirects have been verified.
