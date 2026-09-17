import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import compression from 'compression';

// Import Astro without allowing its generated entrypoint to start a second server.
process.env.ASTRO_NODE_AUTOSTART = 'disabled';
// These tokens exist only inside the process and authenticate local maintenance triggers.
process.env.INTERNAL_NOTIFICATION_WORKER_TOKEN ||= randomBytes(48).toString('base64url');
process.env.INTERNAL_PUBLISH_WORKER_TOKEN ||= randomBytes(48).toString('base64url');
process.env.INTERNAL_READINESS_TOKEN ||= randomBytes(48).toString('base64url');
process.env.INTERNAL_SHUTDOWN_TOKEN ||= randomBytes(48).toString('base64url');
const runningFromBuildOutput = import.meta.url.endsWith('/start.mjs');
const entryUrl = new URL(runningFromBuildOutput ? './entry.mjs' : './dist/server/entry.mjs', import.meta.url);
const policyUrl = new URL(runningFromBuildOutput ? './security-policy.json' : './dist/server/security-policy.json', import.meta.url);
const { handler, options } = await import(entryUrl.href);
const securityPolicy = JSON.parse(await readFile(policyUrl, 'utf8'));

const compressionMiddleware = compression({ threshold: 1024 });

function firstForwardedValue(value) {
  return String(value || '').split(',')[0].trim().toLowerCase();
}

function applySecurityHeaders(request, response) {
  response.setHeader('Content-Security-Policy', securityPolicy.contentSecurityPolicy);
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  response.setHeader('Origin-Agent-Cluster', '?1');
  response.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()');
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  try {
    if (new URL(request.url || '/', 'http://localhost').pathname.startsWith('/admin')) {
      response.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }
  } catch {
    // Astro handles malformed request URLs.
  }

  const forwardedProtocol = firstForwardedValue(request.headers['x-forwarded-proto']);
  if (forwardedProtocol === 'https' || request.socket.encrypted) {
    response.setHeader('Strict-Transport-Security', 'max-age=31536000');
  }
}

function cachePolicy(pathname) {
  if (pathname === '/api' || pathname.startsWith('/api/') || pathname === '/admin' || pathname.startsWith('/admin/')) {
    return 'no-store';
  }

  // Astro filenames contain a content hash, so they can be cached permanently.
  if (pathname.startsWith('/_astro/')) {
    return 'public, max-age=31536000, immutable';
  }

  // Public assets keep stable filenames. Cache them, but allow reasonably quick updates.
  if (/\.(?:avif|gif|ico|jpe?g|png|svg|webp|woff2?)$/i.test(pathname)) {
    return 'public, max-age=604800, stale-while-revalidate=86400';
  }

  if (pathname === '/robots.txt' || pathname.startsWith('/sitemap')) {
    return 'public, max-age=3600, stale-while-revalidate=86400';
  }

  // HTML should be revalidated so deployments become visible immediately.
  return 'public, max-age=0, must-revalidate';
}

function applyCachePolicy(request, response) {
  let pathname = '/';
  try {
    pathname = new URL(request.url || '/', 'http://localhost').pathname;
  } catch {
    // Astro will return the appropriate response for a malformed request URL.
  }

  const policy = cachePolicy(pathname);
  const setHeader = response.setHeader.bind(response);
  setHeader('Cache-Control', policy);

  // The Astro static-file handler sets max-age=0. Keep the explicit policy above.
  response.setHeader = (name, value) =>
    setHeader(name, String(name).toLowerCase() === 'cache-control' ? policy : value);
}

const server = http.createServer((request, response) => {
  applySecurityHeaders(request, response);
  applyCachePolicy(request, response);
  compressionMiddleware(request, response, (compressionError) => {
    if (compressionError) {
      console.error('Response compression failed:', compressionError);
      if (!response.headersSent) response.writeHead(500);
      response.end('Internal server error');
      return;
    }

    Promise.resolve(handler(request, response)).catch((error) => {
      console.error('Request handling failed:', error);
      if (!response.headersSent) response.writeHead(500);
      response.end('Internal server error');
    });
  });
});

const port = Number(process.env.PORT || options.port || 3000);
const configuredHost = process.env.HOST?.trim();
const host = configuredHost || '0.0.0.0';
const workerLoopbackHost = '127.0.0.1';
const strictStartup = process.env.REQUIRE_PRODUCTION_SERVICES === 'true';
if (strictStartup) {
  const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'ADMIN_AUTH_SECRET', 'ENQUIRY_RATE_LIMIT_SECRET', 'HEALTHCHECK_TOKEN', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS'];
  const missing = required.filter((name) => !process.env[name]?.trim());
  if (missing.length) throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
}

const backgroundWorkersEnabled = process.env.ENABLE_BACKGROUND_WORKERS === 'true';
const workerIntervalSeconds = (() => {
  const configured = Number(process.env.ENQUIRY_NOTIFICATION_WORKER_INTERVAL_SECONDS || 60);
  return Number.isInteger(configured) && configured >= 15 && configured <= 3600 ? configured : 60;
})();
let workerRunning = false;
let publishingRunning = false;
let initialWorkerTimer;
let workerTimer;
let maintenancePromise = null;
let shuttingDown = false;

async function runNotificationWorker() {
  if (workerRunning) return;
  workerRunning = true;
  try {
    const response = await internalPost('/api/internal/enquiry-notifications', process.env.INTERNAL_NOTIFICATION_WORKER_TOKEN);
    if (!response.ok) {
      const body = await response.text();
      console.error(`Notification worker returned HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
  } catch (error) {
    console.error('Notification worker request failed:', error instanceof Error ? error.message : 'Unknown error');
  } finally {
    workerRunning = false;
  }
}

async function runPublishingWorker() {
  if (publishingRunning) return;
  publishingRunning = true;
  try {
    const response = await internalPost('/api/internal/blog-publishing', process.env.INTERNAL_PUBLISH_WORKER_TOKEN);
    if (!response.ok) {
      const body = await response.text();
      console.error(`Blog publishing worker returned HTTP ${response.status}: ${body.slice(0, 300)}`);
    }
  } catch (error) {
    console.error('Blog publishing worker request failed:', error instanceof Error ? error.message : 'Unknown error');
  } finally {
    publishingRunning = false;
  }
}

async function runMaintenanceWorkers() {
  await Promise.all([runNotificationWorker(), runPublishingWorker()]);
}

function triggerMaintenance() {
  if (maintenancePromise || shuttingDown) return maintenancePromise;
  maintenancePromise = runMaintenanceWorkers().finally(() => { maintenancePromise = null; });
  return maintenancePromise;
}

function internalPost(pathname, token) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: workerLoopbackHost,
      port,
      path: pathname,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: `http://${workerLoopbackHost}:${port}`,
        'Content-Length': '0',
      },
      timeout: 10_000,
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const status = response.statusCode || 500;
        resolve({
          ok: status >= 200 && status < 300,
          status,
          text: async () => body,
        });
      });
    });
    request.once('timeout', () => request.destroy(new Error('Internal request timed out.')));
    request.once('error', reject);
    request.end();
  });
}

server.listen(port, host, async () => {
  if (strictStartup) {
    try {
      const response = await internalPost('/api/internal/readiness', process.env.INTERNAL_READINESS_TOKEN);
      if (!response.ok) throw new Error(`database readiness returned HTTP ${response.status}`);
    } catch (error) {
      console.error('Production readiness check failed:', error instanceof Error ? error.message : 'Unknown error');
      process.exitCode = 1;
      await shutdown('STARTUP');
      return;
    }
  }
  console.log(`PressPixel server listening on http://${host}:${port}${strictStartup ? '' : ' (degraded startup checks allowed)'}`);
  if (backgroundWorkersEnabled) {
    initialWorkerTimer = setTimeout(triggerMaintenance, 15_000);
    workerTimer = setInterval(triggerMaintenance, workerIntervalSeconds * 1000);
    initialWorkerTimer.unref();
    workerTimer.unref();
  } else {
    console.log('Background maintenance workers disabled for this runtime.');
  }
});

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  clearTimeout(initialWorkerTimer);
  clearInterval(workerTimer);
  const forceTimer = setTimeout(() => {
    console.error(`${signal} shutdown exceeded 10 seconds; forcing exit.`);
    process.exit(1);
  }, 10_000);
  try {
    if (maintenancePromise) await Promise.race([maintenancePromise, new Promise((resolve) => setTimeout(resolve, 5_000))]);
    if (backgroundWorkersEnabled) {
      await internalPost('/api/internal/shutdown', process.env.INTERNAL_SHUTDOWN_TOKEN).catch(() => null);
    }
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } catch (error) {
    console.error(`${signal} shutdown failed:`, error);
    process.exitCode = 1;
  } finally {
    clearTimeout(forceTimer);
  }
}

process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
process.once('SIGINT', () => { void shutdown('SIGINT'); });
