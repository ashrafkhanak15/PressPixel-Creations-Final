import { randomUUID } from 'node:crypto';
import mysql from 'mysql2/promise';
import articles from '../lib/articles.json' with { type: 'json' };
import { renderBlogDocument } from '../lib/blog-content.ts';
import { slugify } from '../lib/blog.ts';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}
function text(value) {
  return value.replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (match, decimal, hex, named) => {
    if (decimal) return String.fromCodePoint(Number(decimal));
    if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
    return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' })[named.toLowerCase()] || match;
  }).replace(/\s+/g, ' ').trim();
}
function blocksFromHtml(html) {
  const blocks = [];
  for (const match of html.matchAll(/<(p|h2|h3|ol|ul)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tag = match[1].toLowerCase();
    if (tag === 'p') blocks.push({ id: randomUUID(), type: 'paragraph', text: text(match[2]) });
    else if (tag === 'h2' || tag === 'h3') blocks.push({ id: randomUUID(), type: 'heading', level: Number(tag[1]), text: text(match[2]) });
    else {
      const items = [...match[2].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((item) => text(item[1])).filter(Boolean);
      if (items.length) blocks.push({ id: randomUUID(), type: 'list', style: tag === 'ol' ? 'ordered' : 'unordered', items });
    }
  }
  return { version: 1, blocks };
}

const connection = await mysql.createConnection({
  host: required('DB_HOST'), port: Number(process.env.DB_PORT || 3306), user: required('DB_USER'),
  password: required('DB_PASSWORD'), database: required('DB_NAME'), timezone: 'Z', charset: 'utf8mb4_unicode_ci',
});
try {
  await connection.beginTransaction();
  const [admins] = await connection.query('SELECT id FROM admin_users WHERE is_active = 1 ORDER BY created_at LIMIT 1 FOR UPDATE');
  if (!admins[0]) throw new Error('Create the bootstrap administrator before importing the legacy article.');
  for (const article of articles) {
    const [existing] = await connection.execute('SELECT id FROM blog_posts WHERE slug = ? LIMIT 1', [article.slug]);
    if (existing.length) { console.log(`Skipped existing article: ${article.slug}`); continue; }
    const categoryName = article.category || 'Journal';
    const categorySlug = slugify(categoryName);
    const [categories] = await connection.execute('SELECT id FROM blog_categories WHERE name = ? LIMIT 1', [categoryName]);
    const categoryId = categories[0]?.id || randomUUID();
    if (!categories[0]) await connection.execute('INSERT INTO blog_categories (id, name, slug) VALUES (?, ?, ?)', [categoryId, categoryName, categorySlug]);
    const document = blocksFromHtml(article.html);
    if (!document.blocks.length) throw new Error(`Could not convert article content: ${article.slug}`);
    const publishedAt = new Date(`${article.datePublished}T12:00:00Z`);
    const updatedAt = new Date(`${article.dateModified || article.datePublished}T12:00:00Z`);
    await connection.execute(
      `INSERT INTO blog_posts
        (id, author_id, primary_category_id, title, slug, excerpt, content_json, content_html, aeo_summary, faq_json, references_json,
         seo_title, meta_description, social_title, social_description, noindex, status, published_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?, 0, 'published', ?, ?, ?)`,
      [randomUUID(), admins[0].id, categoryId, article.title, article.slug, article.description, JSON.stringify(document), renderBlogDocument(document),
       document.blocks.find((block) => block.type === 'paragraph')?.text || article.description, article.seoTitle || article.title, article.description,
       article.seoTitle || article.title, article.description, publishedAt, publishedAt, updatedAt],
    );
    console.log(`Imported article: ${article.slug}`);
  }
  await connection.commit();
  console.log('Legacy import complete. Set BLOG_LEGACY_FALLBACK=false and restart the application.');
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
