import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const clientRoot = resolve('dist/client');
const outputPath = resolve('dist/server/security-policy.json');
const htmlFiles = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (extname(entry.name) === '.html') htmlFiles.push(path);
  }
}

await walk(clientRoot);

const scriptHashes = new Set();
const inlineScriptPattern = /<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  for (const match of html.matchAll(inlineScriptPattern)) {
    const content = match[1];
    if (!content) continue;
    const digest = createHash('sha256').update(content, 'utf8').digest('base64');
    scriptHashes.add(`'sha256-${digest}'`);
  }
}

const sortedHashes = [...scriptHashes].sort();
const directives = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https://api.cloudinary.com",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: https://res.cloudinary.com",
  "manifest-src 'self'",
  "media-src 'self'",
  "object-src 'none'",
  `script-src 'self' ${sortedHashes.join(' ')}`,
  "script-src-attr 'none'",
  "style-src 'self'",
  "style-src-attr 'none'",
  "worker-src 'self'",
  'upgrade-insecure-requests',
];

if (!sortedHashes.length) throw new Error('No inline scripts were found while generating the CSP.');

await writeFile(outputPath, `${JSON.stringify({
  contentSecurityPolicy: directives.join('; '),
  inlineScriptHashes: sortedHashes,
}, null, 2)}\n`);

console.log(`Generated CSP with ${sortedHashes.length} unique inline-script hashes from ${htmlFiles.length} HTML pages.`);
