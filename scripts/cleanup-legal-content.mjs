// One-off maintenance script for Item 8 (legal content cleanup).
// Fixes broken markup, strips tracking parameters, and gives numbered legal
// sections real headings. Run with: node scripts/cleanup-legal-content.mjs
import { readFile, writeFile } from 'node:fs/promises';

const file = new URL('../lib/legal.json', import.meta.url);
const legal = JSON.parse(await readFile(file, 'utf8'));

const report = [];

// Documents whose numbered sections were plain text and need promoting to <h2>.
// Their existing <h2> subsections must then drop to <h3> to keep one hierarchy.
const promoteNumberedSections = new Set(['terms-of-service', 'privacy-policy']);

for (const [slug, doc] of Object.entries(legal)) {
  let html = doc.html;
  const stats = { slug, headings: 0, demoted: 0, trackingRemoved: 0, strayTagsFixed: 0 };

  // 1. Remove AI-draft tracking residue from internal links.
  const trackingMatches = html.match(/\?utm_source=chatgpt\.com/g) || [];
  stats.trackingRemoved = trackingMatches.length;
  html = html.replace(/\?utm_source=chatgpt\.com/g, '');

  // 2. Fix unmatched closing </a> in the refund policy contact block.
  const strayTag = '<br>Email: support@presspixelcreations.com</a>';
  if (html.includes(strayTag)) {
    stats.strayTagsFixed = 1;
    html = html.replace(
      strayTag,
      '<br>Email: <a href="mailto:support@presspixelcreations.com">support@presspixelcreations.com</a>',
    );
  }

  // 3. Promote plain-text numbered sections to real headings.
  html = html.replace(
    /(^|\n)\s*>?\s*(\d{1,2}\.\s+[^\n<]+?)\s*(?=\n)/g,
    (match, lead, title) => {
      const clean = title.trim();
      if (!/^\d{1,2}\.\s+\S/.test(clean)) return match;
      stats.headings += 1;
      return `${lead}<h2>${clean}</h2>`;
    },
  );

  // 4. Demote the pre-existing subsections so the outline stays valid (h2 -> h3).
  if (promoteNumberedSections.has(slug)) {
    html = html.replace(/<h2>([^<]+)<\/h2>/g, (match, title) => {
      // Numbered parent sections were just created and must stay <h2>.
      if (/^\d{1,2}\.\s/.test(title.trim())) return match;
      stats.demoted += 1;
      return `<h3>${title}</h3>`;
    });
  }

  // 5. Collapse the runaway blank lines left by the original editor.
  html = html
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n');

  doc.html = html;
  report.push(stats);
}

await writeFile(file, `${JSON.stringify(legal, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));