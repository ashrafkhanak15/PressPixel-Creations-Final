import { createHash, randomUUID } from 'node:crypto';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { getDb } from '../db/index';
import articles from './articles.json';
import { renderBlogDocument, type BlogDocument } from './blog-content';
import { slugify } from './blog';

interface IdRow extends RowDataPacket { id: string; }
interface CountRow extends RowDataPacket { count: number | string; }

const LEGACY_IMPORT_MARKER = 'content_legacy_articles_v1';

export async function legacyArticleImportCompleted() {
  const [rows] = await getDb().execute<CountRow[]>(
    'SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?',
    [LEGACY_IMPORT_MARKER],
  );
  return Number(rows[0]?.count || 0) > 0;
}

function plainText(value: string) {
  return value
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/gi, (match, decimal, hex, named) => {
      if (decimal) return String.fromCodePoint(Number(decimal));
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16));
      return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[named.toLowerCase()] || match;
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function documentFromHtml(html: string): BlogDocument {
  const blocks: BlogDocument['blocks'] = [];
  for (const match of html.matchAll(/<(p|h2|h3|ol|ul)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const tag = match[1].toLowerCase();
    if (tag === 'p') {
      blocks.push({ id: randomUUID(), type: 'paragraph', text: plainText(match[2]) });
    } else if (tag === 'h2' || tag === 'h3') {
      blocks.push({ id: randomUUID(), type: 'heading', level: tag === 'h2' ? 2 : 3, text: plainText(match[2]) });
    } else {
      const items = [...match[2].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((item) => plainText(item[1])).filter(Boolean);
      if (items.length) blocks.push({ id: randomUUID(), type: 'list', style: tag === 'ol' ? 'ordered' : 'unordered', items });
    }
  }
  return { version: 1, blocks };
}

async function categoryIdFor(connection: PoolConnection, name: string) {
  const [existing] = await connection.execute<IdRow[]>('SELECT id FROM blog_categories WHERE name = ? LIMIT 1', [name]);
  if (existing[0]) return existing[0].id;

  const baseSlug = slugify(name) || 'journal';
  const suffix = createHash('sha256').update(name.toLocaleLowerCase('en-US')).digest('hex').slice(0, 12);
  for (const slug of [baseSlug, `${baseSlug.slice(0, 87)}-${suffix}`]) {
    const [claimed] = await connection.execute<IdRow[]>('SELECT id FROM blog_categories WHERE slug = ? LIMIT 1', [slug]);
    if (claimed[0]) continue;
    const id = randomUUID();
    await connection.execute('INSERT INTO blog_categories (id, name, slug) VALUES (?, ?, ?)', [id, name, slug]);
    return id;
  }
  throw new Error('Unable to create a category for the imported article.');
}

export async function importBundledLegacyArticles(authorId: string) {
  const connection = await getDb().getConnection();
  const imported: string[] = [];
  const skipped: string[] = [];
  try {
    await connection.beginTransaction();
    for (const article of articles) {
      const [existing] = await connection.execute<IdRow[]>('SELECT id FROM blog_posts WHERE slug = ? LIMIT 1 FOR UPDATE', [article.slug]);
      if (existing[0]) {
        skipped.push(article.slug);
        continue;
      }

      const document = documentFromHtml(article.html);
      if (!document.blocks.length) throw new Error(`Could not convert article content: ${article.slug}`);
      const categoryId = await categoryIdFor(connection, article.category || 'Journal');
      const publishedAt = new Date(`${article.datePublished}T12:00:00Z`);
      const updatedAt = new Date(`${article.dateModified || article.datePublished}T12:00:00Z`);
      const answer = document.blocks.find((block) => block.type === 'paragraph');
      await connection.execute(
        `INSERT INTO blog_posts
          (id, author_id, primary_category_id, title, slug, excerpt, content_json, content_html, aeo_summary, faq_json, references_json,
           seo_title, meta_description, social_title, social_description, noindex, status, published_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', '[]', ?, ?, ?, ?, 0, 'published', ?, ?, ?)`,
        [randomUUID(), authorId, categoryId, article.title, article.slug, article.description, JSON.stringify(document), renderBlogDocument(document),
          answer?.type === 'paragraph' ? answer.text : article.description, article.seoTitle || article.title, article.description,
          article.seoTitle || article.title, article.description, publishedAt, publishedAt, updatedAt],
      );
      imported.push(article.slug);
    }
    await connection.execute(
      `INSERT INTO schema_migrations (version) VALUES (?)
       ON DUPLICATE KEY UPDATE version = VALUES(version)`,
      [LEGACY_IMPORT_MARKER],
    );
    await connection.commit();
    return { imported, skipped };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
