import type { APIRoute } from 'astro';
import { getClaimedBlogSlugs, listPublicBlogSitemapEntries, type PublicBlogSitemapEntry } from '../../db/blog';
import { legacyBlogFallbackEnabled } from '../../lib/blog';
import { projects, services } from '../../lib/content';
import articles from '../../lib/articles.json';
import legal from '../../lib/legal.json';

export const prerender = false;

function escapeXml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&apos;',
    '"': '&quot;',
  })[character] || character);
}

const staticPaths = [
  '/',
  '/about',
  '/contact',
  '/journal',
  '/pricing',
  '/services',
  '/work',
  ...services.map((service) => `/services/${service.slug}`),
  ...projects.map((project) => `/work/${project.slug}`),
  ...Object.keys(legal).map((slug) => `/${slug}`),
];

export const GET: APIRoute = async () => {
  let databaseAvailable = true;
  let databaseEntries: PublicBlogSitemapEntry[];
  let claimed = new Set<string>();
  const legacyFallback = legacyBlogFallbackEnabled();
  try {
    databaseEntries = await listPublicBlogSitemapEntries();
    if (legacyFallback) claimed = await getClaimedBlogSlugs(articles.map((article) => article.slug));
  } catch {
    databaseAvailable = false;
    databaseEntries = [];
    claimed = new Set<string>();
  }

  const entries = new Map<string, string | null>(staticPaths.map((path) => [path, null]));
  if (legacyFallback) {
    for (const article of articles) {
      if (!databaseAvailable || !claimed.has(article.slug)) entries.set(`/journal/${article.slug}`, null);
    }
  }
  for (const entry of databaseEntries) {
    entries.set(`/journal/${entry.slug}`, entry.updatedAt.toISOString());
  }

  const body = [...entries.entries()].map(([path, lastmod]) => `<url><loc>${escapeXml(new URL(path, 'https://presspixelcreations.com').toString())}</loc>${lastmod ? `<lastmod>${escapeXml(lastmod)}</lastmod>` : ''}</url>`).join('');
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
    },
  });
};
