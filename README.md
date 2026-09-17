# PressPixel Creations — Astro (Hostinger edition)

A standalone Astro website for PressPixel Creations. The site uses native Astro components and browser JavaScript; React and Next.js are not part of this project.

## Requirements

- Node.js 22.19 or newer, including Hostinger's supported Node 24 release line
- npm 10 or 11 (`npm@10.9.3` is the reproducible local reference declared in `package.json`)
- MySQL 8 / compatible Hostinger MySQL database

## Run locally

```sh
npm ci
npm run dev
```

`package-lock.json` is part of the deployment source and must remain committed or included in the uploaded archive. Use `npm ci` instead of `npm install` for clean local, CI, and manual deployment installs so the exact reviewed dependency tree is reproduced.

Create a local `.env` from `.env.example`, add working MySQL credentials, then run `npm run db:migrate` before testing database features or enquiry submissions.

## Production build

```sh
npm ci
npm run verify
npm start
```

`npm run verify` performs the Astro type/content checks and then creates and validates the production build.

Astro writes static browser assets to `dist/client/` and the standalone application handler to `dist/server/`. `server.mjs` starts that handler with Brotli/gzip compression and explicit cache policies suitable for Hostinger.

## Hosting

This edition uses Astro's official Node adapter in standalone mode. The `/api/enquiries` endpoint validates required same-origin requests, applies atomic hourly limits by HMAC-hashed client IP and normalized email, writes accepted submissions to MySQL, then sends SMTP notifications to `ashrafkhanak15@gmail.com` and `support@presspixelcreations.com`. Raw client IPs are not stored. Run `db/schema.sql` for a new database or the numbered migrations for an existing database, then configure the database, proxy, rate-limit, retry, health-monitoring, admin-authentication, and SMTP environment variables listed in `.env.example`.

Failed notification emails remain queued in MySQL with increasing retry delays. The managed Hostinger runtime blocks loopback requests, so deploy there with `ENABLE_BACKGROUND_WORKERS=false` and `REQUIRE_PRODUCTION_SERVICES=false`; use the protected health endpoint to monitor the queue until an external scheduler is configured. Database row locking and claim leases support multiple app instances. A bearer-token-protected `/api/health` endpoint reports pending and exhausted notification counts without exposing enquiry content.

Enquiry rows record the privacy-policy revision the visitor agreed to. When the policy's "Last Updated" date changes, update `CONSENT_VERSION` in `lib/enquiry-consent.ts`; the build fails if the two disagree.

Social sharing uses a generated 1200x630 card at `public/images/og-default.png`, referenced by `og:image` and `twitter:image` on every page. Regenerate it after brand changes with `npm run og:image`. Page titles are kept under 62 characters and the build fails if any exceed that limit.

The protected `/admin` workspace includes one-admin email/password sign-in, scrypt password hashes, database-backed sessions, strict cookies, same-origin and CSRF checks, and login rate limiting. `/admin/posts` provides search and status filters, individual edit/view/trash controls, select-all and bulk trash/restore actions, plus private structured drafts with paragraph, heading, list, quote, callout, FAQ, reference and image blocks; taxonomy; featured media; SEO and sharing fields; answer-first summaries; private previews; and America/Denver scheduling input stored as UTC. Trash is reversible and preserves historical slug ownership. All content is validated server-side and rendered from escaped structured data, never browser-provided HTML.

Cloudinary uploads use a short-lived, server-generated signature. Set `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`, and optionally `CLOUDINARY_JOURNAL_FOLDER` in the environment. The API secret stays server-side. Set the admin variables in `.env.example`, visit `/admin/login` once with the bootstrap credentials, then remove `ADMIN_BOOTSTRAP_PASSWORD`. Use `npm run admin:reset-password` from an interactive terminal if access must be recovered; all sessions are revoked after a reset.

The public `/journal` route reads only published MySQL posts, promotes due schedules to `published`, supports pagination and reserved old-slug redirects, and exposes a runtime `/sitemap.xml` that includes published, indexable database posts. `BLOG_LEGACY_FALLBACK=true` temporarily supplies the bundled article only when its slug has not been claimed by MySQL. After the first admin login, run `npm run cms:import-legacy`, set `BLOG_LEGACY_FALLBACK=false`, and restart.

The production server applies these response policies:

- Hashed `/_astro/` assets: one year, immutable
- Public images and fonts: seven days, with one day of stale-while-revalidate
- `robots.txt` and sitemap files: one hour, with one day of stale-while-revalidate
- HTML: immediate revalidation
- `/api/*`: no-store
- `/admin/*`: no-store
- Compressible responses larger than 1 KB: Brotli when accepted, otherwise gzip/deflate

Hostinger or an upstream CDN may override these headers, so verify the live responses after deployment.

The production server also sends:

- A restrictive Content Security Policy using SHA-256 hashes generated from the built inline scripts
- Frame embedding blocked through CSP and `X-Frame-Options: DENY`
- MIME sniffing disabled
- A strict-origin referrer policy
- Camera, microphone, geolocation, payment, and USB browser capabilities disabled
- Cross-origin opener isolation
- One-year HSTS only when the request reaches the app as HTTPS

The CSP hash file is regenerated by `npm run build`. Do not deploy a newly generated `dist/` directory with an older `dist/server/security-policy.json`.

The public pages, metadata, canonical URLs, runtime sitemap, GSAP animation, Lenis scrolling, and enquiry form UI remain consistent with the final Astro redevelopment. The journal is now the database-backed exception, with a temporary JSON fallback for continuity before the first migration.

See `HOSTINGER-SETUP.md` for the deployment checklist.

## Main folders

- `src/pages/` — routes and page templates
- `src/components/` — native Astro components
- `src/styles/theme.css` — global colours, fonts, spacing, radii, shadows, and motion tokens
- `src/styles/global.css` — layouts and component styling built from the theme tokens
- `public/` — images, icons, and static files
- `lib/` — site content and enquiry validation
- `db/` — Hostinger/MySQL enquiry and admin/blog storage and schema
- `src/pages/admin/` and `src/pages/api/admin/` — protected dashboard, draft editor, private previews, authentication, and signed media routes
- `lib/blog-content.ts` — validated block schema and safe HTML renderer
- `db/blog.ts` — private-draft, taxonomy, and media persistence
- `src/styles/admin.css` — admin-only styling, excluded from public page bundles

To change the brand system later, start with `src/styles/theme.css`.
