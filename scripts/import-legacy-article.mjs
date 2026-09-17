import { closeDb, getDb } from '../db/index.ts';
import { importBundledLegacyArticles } from '../lib/legacy-blog-import.ts';

try {
  const [admins] = await getDb().query('SELECT id FROM admin_users WHERE is_active = 1 ORDER BY created_at LIMIT 1');
  if (!admins[0]) throw new Error('Create the bootstrap administrator before importing the legacy article.');
  const result = await importBundledLegacyArticles(admins[0].id);
  for (const slug of result.imported) console.log(`Imported article: ${slug}`);
  for (const slug of result.skipped) console.log(`Skipped existing article: ${slug}`);
  console.log('Legacy import complete. Set BLOG_LEGACY_FALLBACK=false and restart the application.');
} finally {
  await closeDb();
}
