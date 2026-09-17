import { createHash, randomUUID } from 'node:crypto';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import type { BlogDocument } from '../lib/blog-content';
import { blogDocumentSchema, extractFaqs, extractReferences, renderBlogDocument } from '../lib/blog-content';
import { normalizeTaxonomyName, publicationValidationError, slugify } from '../lib/blog';
import { getDb } from './index';

export type BlogPostStatus = 'draft' | 'scheduled' | 'published' | 'trashed';

export type BlogMedia = {
  id: string;
  url: string;
  width: number;
  height: number;
  altText: string;
  caption: string;
};

export type AdminBlogPost = {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  content: BlogDocument;
  aeoSummary: string;
  seoTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  socialTitle: string;
  socialDescription: string;
  noindex: boolean;
  status: BlogPostStatus;
  scheduledFor: Date | null;
  category: string;
  tags: string[];
  featuredMedia: BlogMedia | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PublicBlogPost = Omit<AdminBlogPost, 'status' | 'scheduledFor'>;

export type PublicBlogPage = {
  posts: PublicBlogPost[];
  page: number;
  pageCount: number;
  total: number;
};

export type PublicBlogSitemapEntry = {
  slug: string;
  updatedAt: Date;
};

export type AdminBlogPostListItem = Pick<AdminBlogPost, 'id' | 'title' | 'slug' | 'status' | 'scheduledFor' | 'createdAt' | 'updatedAt'> & {
  category: string;
};

export type SaveBlogPostInput = Omit<AdminBlogPost, 'createdAt' | 'updatedAt' | 'publishedAt' | 'status' | 'featuredMedia'> & {
  authorId: string;
  status: BlogPostStatus;
  featuredMediaId: string | null;
  featuredMediaAlt: string;
  featuredMediaCaption: string;
};

export class BlogSlugConflictError extends Error {
  constructor() {
    super('A post already uses that URL slug.');
  }
}

interface BlogPostRow extends RowDataPacket {
  id: string;
  title: string;
  slug: string | null;
  excerpt: string;
  content_json: string | BlogDocument | null;
  aeo_summary: string | null;
  seo_title: string;
  meta_description: string;
  canonical_url: string | null;
  social_title: string;
  social_description: string;
  noindex: number;
  status: BlogPostStatus;
  scheduled_for: Date | string | null;
  published_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  category_name: string | null;
  featured_media_id: string | null;
  featured_media_url: string | null;
  featured_media_width: number | null;
  featured_media_height: number | null;
  featured_media_alt: string | null;
  featured_media_caption: string | null;
}

interface BlogPostListRow extends RowDataPacket {
  id: string;
  title: string;
  slug: string | null;
  status: BlogPostStatus;
  scheduled_for: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
  category_name: string | null;
}

interface NameRow extends RowDataPacket {
  id: string;
  name: string;
}

interface OwnedPostRow extends RowDataPacket {
  id: string;
  slug: string | null;
  status: BlogPostStatus;
  published_at: Date | string | null;
}

interface RedirectRow extends RowDataPacket {
  post_id: string;
}

interface ClaimedSlugRow extends RowDataPacket {
  claimed_slug: string;
}

interface CountRow extends RowDataPacket {
  count: number | string;
}

interface MediaRow extends RowDataPacket {
  id: string;
  url: string;
  width: number;
  height: number;
  alt_text: string;
  caption: string;
}

function asDate(value: Date | string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Database returned an invalid post date.');
  return date;
}

function parseDocument(value: BlogPostRow['content_json']): BlogDocument {
  if (!value) return { version: 1, blocks: [] };
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const result = blogDocumentSchema.safeParse(parsed);
    if (result.success) return result.data;
  } catch {
    // A malformed draft must never be rendered as raw HTML.
  }
  return { version: 1, blocks: [] };
}

function duplicateKey(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY';
}

function postFromRow(row: BlogPostRow, tags: string[]): AdminBlogPost {
  return {
    id: row.id,
    title: row.title,
    slug: row.slug || '',
    excerpt: row.excerpt,
    content: parseDocument(row.content_json),
    aeoSummary: row.aeo_summary || '',
    seoTitle: row.seo_title,
    metaDescription: row.meta_description,
    canonicalUrl: row.canonical_url || '',
    socialTitle: row.social_title,
    socialDescription: row.social_description,
    noindex: Boolean(row.noindex),
    status: row.status,
    scheduledFor: row.scheduled_for ? asDate(row.scheduled_for) : null,
    category: row.category_name || '',
    tags,
    featuredMedia: row.featured_media_id && row.featured_media_url && row.featured_media_width && row.featured_media_height ? {
      id: row.featured_media_id,
      url: row.featured_media_url,
      width: Number(row.featured_media_width),
      height: Number(row.featured_media_height),
      altText: row.featured_media_alt || '',
      caption: row.featured_media_caption || '',
    } : null,
    publishedAt: row.published_at ? asDate(row.published_at) : null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
  };
}

export async function createBlogDraft(authorId: string) {
  const id = randomUUID();
  await getDb().execute(
    'INSERT INTO blog_posts (id, author_id) VALUES (?, ?)',
    [id, authorId],
  );
  return id;
}

export async function getOverdueScheduledPostCount(staleMinutes = 30) {
  const [rows] = await getDb().execute<CountRow[]>(
    `SELECT COUNT(*) AS count
       FROM blog_posts
      WHERE status = 'scheduled'
        AND scheduled_for IS NOT NULL
        AND scheduled_for <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)`,
    [staleMinutes],
  );
  return Number(rows[0]?.count || 0);
}

export async function publishDueBlogPosts() {
  const [result] = await getDb().execute<ResultSetHeader>(
    `UPDATE blog_posts
        SET status = 'published',
            published_at = COALESCE(published_at, scheduled_for, UTC_TIMESTAMP()),
            scheduled_for = NULL,
            trashed_at = NULL
      WHERE status = 'scheduled'
        AND scheduled_for IS NOT NULL
        AND scheduled_for <= UTC_TIMESTAMP()`,
  );
  return result.affectedRows;
}

export async function getPublicBlogPage(requestedPage = 1, pageSize = 6): Promise<PublicBlogPage> {
  await publishDueBlogPosts();
  const size = Math.min(Math.max(Math.trunc(pageSize), 1), 24);
  const [totalRows] = await getDb().execute<CountRow[]>(
    `SELECT COUNT(*) AS count
       FROM blog_posts
      WHERE status = 'published'
        AND published_at IS NOT NULL
        AND published_at <= UTC_TIMESTAMP()`,
  );
  const total = Number(totalRows[0]?.count || 0);
  const pageCount = Math.ceil(total / size);
  const page = Math.min(Math.max(Math.trunc(requestedPage) || 1, 1), Math.max(pageCount, 1));
  const offset = (page - 1) * size;
  const [rows] = await getDb().execute<BlogPostRow[]>(
    `SELECT p.*, c.name AS category_name,
            m.id AS featured_media_id, m.url AS featured_media_url, m.width AS featured_media_width,
            m.height AS featured_media_height, m.alt_text AS featured_media_alt, m.caption AS featured_media_caption
       FROM blog_posts p
       LEFT JOIN blog_categories c ON c.id = p.primary_category_id
       LEFT JOIN blog_media m ON m.id = p.featured_media_id
      WHERE p.status = 'published'
        AND p.published_at IS NOT NULL
        AND p.published_at <= UTC_TIMESTAMP()
      ORDER BY p.published_at DESC, p.id DESC
      LIMIT ? OFFSET ?`,
    [size, offset],
  );
  return { posts: rows.map((row) => postFromRow(row, [])), page, pageCount, total };
}

export async function getPublicBlogPostBySlug(slug: string): Promise<PublicBlogPost | null> {
  await publishDueBlogPosts();
  const [rows] = await getDb().execute<BlogPostRow[]>(
    `SELECT p.*, c.name AS category_name,
            m.id AS featured_media_id, m.url AS featured_media_url, m.width AS featured_media_width,
            m.height AS featured_media_height, m.alt_text AS featured_media_alt, m.caption AS featured_media_caption
       FROM blog_posts p
       LEFT JOIN blog_categories c ON c.id = p.primary_category_id
       LEFT JOIN blog_media m ON m.id = p.featured_media_id
      WHERE p.slug = ?
        AND p.status = 'published'
        AND p.published_at IS NOT NULL
        AND p.published_at <= UTC_TIMESTAMP()
      LIMIT 1`,
    [slug],
  );
  const row = rows[0];
  if (!row) return null;
  const [tagRows] = await getDb().execute<NameRow[]>(
    `SELECT t.id, t.name
       FROM blog_tags t
       INNER JOIN blog_post_tags pt ON pt.tag_id = t.id
      WHERE pt.post_id = ?
      ORDER BY t.name`,
    [row.id],
  );
  return postFromRow(row, tagRows.map((tag) => tag.name));
}

export async function getPublicBlogRedirect(oldSlug: string) {
  await publishDueBlogPosts();
  const [rows] = await getDb().execute<RowDataPacket[]>(
    `SELECT p.slug
       FROM blog_post_redirects r
       INNER JOIN blog_posts p ON p.id = r.post_id
      WHERE r.old_slug = ?
        AND p.slug IS NOT NULL
        AND p.status = 'published'
        AND p.published_at IS NOT NULL
        AND p.published_at <= UTC_TIMESTAMP()
      LIMIT 1`,
    [oldSlug],
  );
  return typeof rows[0]?.slug === 'string' ? rows[0].slug : null;
}

export async function listPublicBlogSitemapEntries(): Promise<PublicBlogSitemapEntry[]> {
  await publishDueBlogPosts();
  const [rows] = await getDb().execute<RowDataPacket[]>(
    `SELECT slug, updated_at
       FROM blog_posts
      WHERE status = 'published'
        AND noindex = 0
        AND slug IS NOT NULL
        AND published_at IS NOT NULL
        AND published_at <= UTC_TIMESTAMP()
      ORDER BY published_at DESC, id DESC`,
  );
  return rows.map((row) => ({ slug: String(row.slug), updatedAt: asDate(row.updated_at as Date | string) }));
}

export async function getClaimedBlogSlugs(slugs: string[]) {
  const candidates = [...new Set(slugs.map((slug) => slugify(slug)).filter(Boolean))];
  if (!candidates.length) return new Set<string>();
  const placeholders = candidates.map(() => '?').join(', ');
  const [rows] = await getDb().execute<ClaimedSlugRow[]>(
    `SELECT slug AS claimed_slug FROM blog_posts WHERE slug IN (${placeholders})
     UNION
     SELECT old_slug AS claimed_slug FROM blog_post_redirects WHERE old_slug IN (${placeholders})`,
    [...candidates, ...candidates],
  );
  return new Set(rows.map((row) => row.claimed_slug));
}

export async function listAdminBlogPosts(limit = 100): Promise<AdminBlogPostListItem[]> {
  const [rows] = await getDb().execute<BlogPostListRow[]>(
    `SELECT p.id, p.title, p.slug, p.status, p.scheduled_for, p.created_at, p.updated_at, c.name AS category_name
       FROM blog_posts p
       LEFT JOIN blog_categories c ON c.id = p.primary_category_id
      ORDER BY p.updated_at DESC
      LIMIT ?`,
    [Math.min(Math.max(limit, 1), 100)],
  );
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    slug: row.slug || '',
    status: row.status,
    scheduledFor: row.scheduled_for ? asDate(row.scheduled_for) : null,
    createdAt: asDate(row.created_at),
    updatedAt: asDate(row.updated_at),
    category: row.category_name || '',
  }));
}

export async function bulkUpdateAdminBlogPosts(authorId: string, ids: string[], action: 'trash' | 'restore') {
  const uniqueIds = [...new Set(ids)].slice(0, 100);
  if (!uniqueIds.length) return 0;
  const placeholders = uniqueIds.map(() => '?').join(', ');
  const values = [authorId, ...uniqueIds];
  const sql = action === 'trash'
    ? `UPDATE blog_posts
          SET status = 'trashed', scheduled_for = NULL,
              trashed_at = COALESCE(trashed_at, UTC_TIMESTAMP())
        WHERE author_id = ? AND id IN (${placeholders}) AND status <> 'trashed'`
    : `UPDATE blog_posts
          SET status = 'draft', scheduled_for = NULL, trashed_at = NULL
        WHERE author_id = ? AND id IN (${placeholders}) AND status = 'trashed'`;
  const [result] = await getDb().execute<ResultSetHeader>(sql, values);
  return result.affectedRows;
}

export async function getAdminBlogPost(id: string): Promise<AdminBlogPost | null> {
  const [rows] = await getDb().execute<BlogPostRow[]>(
    `SELECT p.*, c.name AS category_name,
            m.id AS featured_media_id, m.url AS featured_media_url, m.width AS featured_media_width,
            m.height AS featured_media_height, m.alt_text AS featured_media_alt, m.caption AS featured_media_caption
       FROM blog_posts p
       LEFT JOIN blog_categories c ON c.id = p.primary_category_id
       LEFT JOIN blog_media m ON m.id = p.featured_media_id
      WHERE p.id = ?
      LIMIT 1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  const [tagRows] = await getDb().execute<NameRow[]>(
    `SELECT t.id, t.name
       FROM blog_tags t
       INNER JOIN blog_post_tags pt ON pt.tag_id = t.id
      WHERE pt.post_id = ?
      ORDER BY t.name`,
    [id],
  );
  return postFromRow(row, tagRows.map((tag) => tag.name));
}

async function resolveTerm(connection: PoolConnection, table: 'blog_categories' | 'blog_tags', name: string) {
  const normalized = normalizeTaxonomyName(name);
  if (!normalized) return null;
  const baseSlug = slugify(normalized);
  if (!baseSlug) throw new Error('Category and tag names must contain letters or numbers.');

  const [existing] = await connection.execute<NameRow[]>(`SELECT id, name FROM ${table} WHERE name = ? LIMIT 1`, [normalized]);
  if (existing[0]) return existing[0].id;

  const suffix = createHash('sha256').update(normalized.toLocaleLowerCase('en-US')).digest('hex').slice(0, 12);
  const candidates = [baseSlug, `${baseSlug.slice(0, 87)}-${suffix}`];
  for (const candidate of candidates) {
    const [slugRows] = await connection.execute<NameRow[]>(`SELECT id, name FROM ${table} WHERE slug = ? LIMIT 1`, [candidate]);
    if (slugRows[0]) continue;
    try {
      const id = randomUUID();
      await connection.execute(`INSERT INTO ${table} (id, name, slug) VALUES (?, ?, ?)`, [id, normalized, candidate]);
      return id;
    } catch (error) {
      if (!duplicateKey(error)) throw error;
      const [concurrent] = await connection.execute<NameRow[]>(`SELECT id, name FROM ${table} WHERE name = ? LIMIT 1`, [normalized]);
      if (concurrent[0]) return concurrent[0].id;
    }
  }
  throw new Error('Unable to create a unique category or tag URL.');
}

async function confirmOwnedMedia(connection: PoolConnection, authorId: string, postId: string, mediaIds: string[]) {
  const requested = mediaIds.filter(Boolean);
  const ids = [...new Set(requested)];
  if (ids.length !== requested.length) throw new Error('Use each uploaded image only once per post.');
  if (!ids.length) return [] as MediaRow[];
  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await connection.execute<MediaRow[]>(
    `SELECT id, url, width, height, alt_text, caption FROM blog_media WHERE uploader_id = ? AND id IN (${placeholders})`,
    [authorId, ...ids],
  );
  if (rows.length !== ids.length) throw new Error('One or more selected images are unavailable.');
  const [reuse] = await connection.execute<RowDataPacket[]>(
    `SELECT m.id
       FROM blog_media m
      WHERE m.id IN (${placeholders})
        AND EXISTS (
          SELECT 1 FROM blog_posts p
           WHERE p.id <> ?
             AND (p.featured_media_id = m.id OR JSON_SEARCH(p.content_json, 'one', m.id, NULL, '$.blocks[*].mediaId') IS NOT NULL)
        )
      LIMIT 1`,
    [...ids, postId],
  );
  if (reuse.length) throw new Error('An uploaded image cannot be reused across posts; upload a separate copy so its alt text stays independent.');
  return rows;
}

export async function saveAdminBlogPost(input: SaveBlogPostInput) {
  const connection = await getDb().getConnection();
  try {
    await connection.beginTransaction();
    const [ownedRows] = await connection.execute<OwnedPostRow[]>(
      'SELECT id, slug, status, published_at FROM blog_posts WHERE id = ? AND author_id = ? LIMIT 1 FOR UPDATE',
      [input.id, input.authorId],
    );
    const previousPost = ownedRows[0];
    if (!previousPost) throw new Error('Post not found.');

    const title = input.title.trim();
    const slug = slugify(input.slug || title);
    const publicationError = publicationValidationError({
      status: input.status,
      title,
      slug,
      blockCount: input.content.blocks.length,
      scheduledFor: input.scheduledFor,
    });
    if (publicationError) throw new Error(publicationError);

    if (slug) {
      const [reservedRows] = await connection.execute<RedirectRow[]>(
        'SELECT post_id FROM blog_post_redirects WHERE old_slug = ? LIMIT 1 FOR UPDATE',
        [slug],
      );
      if (reservedRows[0] && reservedRows[0].post_id !== input.id) throw new BlogSlugConflictError();
      if (reservedRows[0]?.post_id === input.id) {
        await connection.execute('DELETE FROM blog_post_redirects WHERE old_slug = ? AND post_id = ?', [slug, input.id]);
      }
    }

    const categoryId = await resolveTerm(connection, 'blog_categories', input.category);
    const tagIds = [] as string[];
    for (const tag of input.tags) {
      const tagId = await resolveTerm(connection, 'blog_tags', tag);
      if (tagId) tagIds.push(tagId);
    }

    const imageBlocks = input.content.blocks.filter((block) => block.type === 'image');
    const ownedMedia = await confirmOwnedMedia(connection, input.authorId, input.id, [input.featuredMediaId || '', ...imageBlocks.map((block) => block.mediaId)]);
    const mediaById = new Map(ownedMedia.map((media) => [media.id, media]));
    for (const block of imageBlocks) {
      const media = mediaById.get(block.mediaId);
      if (!media) throw new Error('One or more selected images are unavailable.');
      // URLs and dimensions are always taken from our verified media records,
      // never from a browser-submitted block payload.
      block.url = media.url;
      block.width = Number(media.width);
      block.height = Number(media.height);
    }

    if (input.featuredMediaId) {
      await connection.execute(
        `UPDATE blog_media
            SET alt_text = ?, caption = ?
          WHERE id = ? AND uploader_id = ?`,
        [input.featuredMediaAlt, input.featuredMediaCaption, input.featuredMediaId, input.authorId],
      );
    }
    for (const block of imageBlocks) {
      await connection.execute(
        `UPDATE blog_media
            SET alt_text = ?, caption = ?
          WHERE id = ? AND uploader_id = ?`,
        [block.alt, block.caption, block.mediaId, input.authorId],
      );
    }

    await connection.execute(
      `UPDATE blog_posts
          SET primary_category_id = ?, featured_media_id = ?, title = ?, slug = ?, excerpt = ?,
              content_json = ?, content_html = ?, aeo_summary = ?, faq_json = ?, references_json = ?,
              seo_title = ?, meta_description = ?, canonical_url = ?, social_title = ?, social_description = ?,
              noindex = ?, status = ?, scheduled_for = ?,
              published_at = CASE WHEN ? = 1 THEN COALESCE(published_at, UTC_TIMESTAMP()) ELSE published_at END,
              trashed_at = CASE WHEN ? = 1 THEN COALESCE(trashed_at, UTC_TIMESTAMP()) ELSE NULL END
        WHERE id = ?`,
      [
        categoryId,
        input.featuredMediaId,
        title,
        slug || null,
        input.excerpt.trim(),
        JSON.stringify(input.content),
        renderBlogDocument(input.content),
        input.aeoSummary.trim() || null,
        JSON.stringify(extractFaqs(input.content)),
        JSON.stringify(extractReferences(input.content)),
        input.seoTitle.trim(),
        input.metaDescription.trim(),
        input.canonicalUrl.trim() || null,
        input.socialTitle.trim(),
        input.socialDescription.trim(),
        input.noindex ? 1 : 0,
        input.status,
        input.status === 'scheduled' ? input.scheduledFor : null,
        input.status === 'published' ? 1 : 0,
        input.status === 'trashed' ? 1 : 0,
        input.id,
      ],
    );
    if (previousPost.slug && slug && previousPost.slug !== slug && previousPost.published_at) {
      const [existingRedirects] = await connection.execute<RedirectRow[]>(
        'SELECT post_id FROM blog_post_redirects WHERE old_slug = ? LIMIT 1 FOR UPDATE',
        [previousPost.slug],
      );
      if (existingRedirects[0] && existingRedirects[0].post_id !== input.id) throw new BlogSlugConflictError();
      await connection.execute(
        `INSERT INTO blog_post_redirects (old_slug, post_id) VALUES (?, ?)
         ON DUPLICATE KEY UPDATE post_id = VALUES(post_id)`,
        [previousPost.slug, input.id],
      );
    }
    await connection.execute('DELETE FROM blog_post_tags WHERE post_id = ?', [input.id]);
    for (const tagId of [...new Set(tagIds)]) {
      await connection.execute('INSERT INTO blog_post_tags (post_id, tag_id) VALUES (?, ?)', [input.id, tagId]);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    if (duplicateKey(error)) throw new BlogSlugConflictError();
    throw error;
  } finally {
    connection.release();
  }
}

export async function createBlogMedia(input: {
  uploaderId: string;
  publicId: string;
  url: string;
  width: number;
  height: number;
}): Promise<BlogMedia> {
  const id = randomUUID();
  try {
    await getDb().execute<ResultSetHeader>(
      `INSERT INTO blog_media (id, uploader_id, cloudinary_public_id, url, width, height)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, input.uploaderId, input.publicId, input.url, input.width, input.height],
    );
    return { id, url: input.url, width: input.width, height: input.height, altText: '', caption: '' };
  } catch (error) {
    if (!duplicateKey(error)) throw error;
    const [rows] = await getDb().execute<MediaRow[]>(
      `SELECT id, url, width, height, alt_text, caption
         FROM blog_media
        WHERE uploader_id = ? AND cloudinary_public_id = ?
        LIMIT 1`,
      [input.uploaderId, input.publicId],
    );
    const existing = rows[0];
    if (!existing) throw error;
    return {
      id: existing.id,
      url: existing.url,
      width: Number(existing.width),
      height: Number(existing.height),
      altText: existing.alt_text,
      caption: existing.caption,
    };
  }
}
