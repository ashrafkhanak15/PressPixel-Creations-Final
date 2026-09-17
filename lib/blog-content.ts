import { z } from 'zod';
import { cloudinaryImageSrcSet, cloudinaryImageUrl } from './blog-images.ts';

const MAX_BLOCKS = 120;

const plainText = (maximum: number, minimum = 0) => z.string().trim().min(minimum).max(maximum);
const optionalText = (maximum: number) => z.string().trim().max(maximum).optional().default('');

const paragraphBlock = z.object({
  id: z.string().uuid(),
  type: z.literal('paragraph'),
  text: plainText(10_000),
});

const headingBlock = z.object({
  id: z.string().uuid(),
  type: z.literal('heading'),
  level: z.union([z.literal(2), z.literal(3)]),
  text: plainText(300),
});

const listBlock = z.object({
  id: z.string().uuid(),
  type: z.literal('list'),
  style: z.union([z.literal('unordered'), z.literal('ordered')]),
  items: z.array(plainText(500)).min(1).max(100),
});

const quoteBlock = z.object({
  id: z.string().uuid(),
  type: z.literal('quote'),
  text: plainText(2_000),
  attribution: optionalText(160),
});

const calloutBlock = z.object({
  id: z.string().uuid(),
  type: z.literal('callout'),
  title: optionalText(160),
  text: plainText(2_000),
});

const faqBlock = z.object({
  id: z.string().uuid(),
  type: z.literal('faq'),
  question: plainText(300),
  answer: plainText(4_000),
});

const referenceBlock = z.object({
  id: z.string().uuid(),
  type: z.literal('reference'),
  label: plainText(300),
  url: z.string().url().max(1_000),
});

const imageBlock = z.object({
  id: z.string().uuid(),
  type: z.literal('image'),
  mediaId: z.string().uuid(),
  url: z.string().url().max(1_000),
  alt: optionalText(300),
  caption: optionalText(500),
  width: z.number().int().positive().max(20_000),
  height: z.number().int().positive().max(20_000),
});

const blockSchema = z.discriminatedUnion('type', [
  paragraphBlock,
  headingBlock,
  listBlock,
  quoteBlock,
  calloutBlock,
  faqBlock,
  referenceBlock,
  imageBlock,
]);

export const blogDocumentSchema = z.object({
  version: z.literal(1),
  blocks: z.array(blockSchema).max(MAX_BLOCKS),
});

export type BlogBlock = z.infer<typeof blockSchema>;
export type BlogDocument = z.infer<typeof blogDocumentSchema>;

export function emptyBlogDocument(): BlogDocument {
  return { version: 1, blocks: [] };
}

function escapeHtml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  })[character] || character);
}

function textWithLineBreaks(value: string) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function safeExternalUrl(value: string) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

export function renderBlogDocument(document: BlogDocument) {
  return document.blocks.map((block) => {
    switch (block.type) {
      case 'paragraph':
        return `<p>${textWithLineBreaks(block.text)}</p>`;
      case 'heading':
        return `<h${block.level}>${escapeHtml(block.text)}</h${block.level}>`;
      case 'list': {
        const tag = block.style === 'ordered' ? 'ol' : 'ul';
        return `<${tag}>${block.items.map((item) => `<li>${textWithLineBreaks(item)}</li>`).join('')}</${tag}>`;
      }
      case 'quote':
        return `<figure class="journal-quote"><blockquote>${textWithLineBreaks(block.text)}</blockquote>${block.attribution ? `<figcaption>${escapeHtml(block.attribution)}</figcaption>` : ''}</figure>`;
      case 'callout':
        return `<aside class="journal-callout">${block.title ? `<h2>${escapeHtml(block.title)}</h2>` : ''}<p>${textWithLineBreaks(block.text)}</p></aside>`;
      case 'faq':
        return `<section class="journal-faq"><h2>${escapeHtml(block.question)}</h2><p>${textWithLineBreaks(block.answer)}</p></section>`;
      case 'reference': {
        const url = safeExternalUrl(block.url);
        return url ? `<p class="journal-reference"><a href="${escapeHtml(url)}" rel="noopener noreferrer" target="_blank">${escapeHtml(block.label)}</a></p>` : '';
      }
      case 'image': {
        const url = safeExternalUrl(block.url);
        if (!url) return '';
        const src = cloudinaryImageUrl(url, Math.min(block.width, 1200));
        const srcset = cloudinaryImageSrcSet(url, block.width);
        return `<figure class="journal-image"><img src="${escapeHtml(src)}"${srcset ? ` srcset="${escapeHtml(srcset)}" sizes="(max-width: 900px) calc(100vw - 40px), 780px"` : ''} alt="${escapeHtml(block.alt)}" width="${block.width}" height="${block.height}" loading="lazy" decoding="async">${block.caption ? `<figcaption>${escapeHtml(block.caption)}</figcaption>` : ''}</figure>`;
      }
    }
  }).join('\n');
}

export function extractFaqs(document: BlogDocument) {
  return document.blocks
    .filter((block): block is Extract<BlogBlock, { type: 'faq' }> => block.type === 'faq')
    .map(({ question, answer }) => ({ question, answer }));
}

export function extractReferences(document: BlogDocument) {
  return document.blocks
    .filter((block): block is Extract<BlogBlock, { type: 'reference' }> => block.type === 'reference')
    .map(({ label, url }) => ({ label, url }));
}
