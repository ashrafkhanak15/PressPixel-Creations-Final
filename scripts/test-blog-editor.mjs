import assert from 'node:assert/strict';
import {
  blogDocumentSchema,
  extractFaqs,
  extractReferences,
  renderBlogDocument,
} from '../lib/blog-content.ts';
import {
  denverDateTimeToUtc,
  isSafeCanonicalUrl,
  publicationValidationError,
  slugify,
  utcToDenverDateTime,
} from '../lib/blog.ts';
import { cloudinaryImageSrcSet, cloudinaryImageUrl } from '../lib/blog-images.ts';
import {
  cloudinaryUploadsAvailable,
  createCloudinaryUploadSignature,
  isExpectedCloudinaryImage,
} from '../lib/cloudinary.ts';

const document = blogDocumentSchema.parse({
  version: 1,
  blocks: [
    { id: 'a5b8c0c5-5cc7-43c9-b63a-c0f525d2dd11', type: 'paragraph', text: '<script>alert(1)</script>' },
    { id: '0eb8fca7-7123-4dea-a0f4-4b4878cf4d17', type: 'faq', question: 'What is structured content?', answer: 'Content with meaningful blocks.' },
    { id: 'a9426441-cb2a-47e1-a7c0-89ce8fdc666f', type: 'reference', label: 'Primary source', url: 'https://example.com/source' },
  ],
});
const rendered = renderBlogDocument(document);
assert(rendered.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'Block renderer did not escape text.');
assert(!rendered.includes('<script>'), 'Block renderer emitted executable markup.');
assert.deepEqual(extractFaqs(document), [{ question: 'What is structured content?', answer: 'Content with meaningful blocks.' }]);
assert.deepEqual(extractReferences(document), [{ label: 'Primary source', url: 'https://example.com/source' }]);
assert.equal(slugify(' A Better, Faster Website! '), 'a-better-faster-website');
assert.equal(isSafeCanonicalUrl('https://presspixelcreations.com/journal/example'), true);
assert.equal(isSafeCanonicalUrl('javascript:alert(1)'), false);
assert.match(publicationValidationError({ status: 'scheduled', title: 'Scheduled', slug: 'scheduled', blockCount: 0, scheduledFor: new Date() }), /content block/);
assert.equal(publicationValidationError({ status: 'scheduled', title: 'Scheduled', slug: 'scheduled', blockCount: 1, scheduledFor: new Date() }), '');
assert.equal(cloudinaryImageUrl('https://res.cloudinary.com/demo/image/upload/v1/example.webp', 768), 'https://res.cloudinary.com/demo/image/upload/f_auto,q_auto,c_limit,w_768/v1/example.webp');
assert.match(cloudinaryImageSrcSet('https://res.cloudinary.com/demo/image/upload/v1/example.webp', 1200), /768w/);

const winter = denverDateTimeToUtc('2026-01-15T09:30');
assert.equal(winter?.toISOString(), '2026-01-15T16:30:00.000Z', 'Denver winter time was not converted to UTC.');
const summer = denverDateTimeToUtc('2026-06-15T09:30');
assert.equal(summer?.toISOString(), '2026-06-15T15:30:00.000Z', 'Denver summer time was not converted to UTC.');
assert.equal(denverDateTimeToUtc('2026-03-08T02:30'), null, 'Nonexistent Denver daylight-saving time was accepted.');
assert.equal(utcToDenverDateTime(winter), '2026-01-15T09:30');

const original = {
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
  CLOUDINARY_JOURNAL_FOLDER: process.env.CLOUDINARY_JOURNAL_FOLDER,
};
delete process.env.CLOUDINARY_CLOUD_NAME;
delete process.env.CLOUDINARY_API_KEY;
delete process.env.CLOUDINARY_API_SECRET;
assert.equal(cloudinaryUploadsAvailable(), false, 'Cloudinary upload feature should be disabled without credentials.');
process.env.CLOUDINARY_CLOUD_NAME = 'presspixel-demo';
process.env.CLOUDINARY_API_KEY = '123456789012345';
process.env.CLOUDINARY_API_SECRET = 'a-very-long-test-secret-value';
process.env.CLOUDINARY_JOURNAL_FOLDER = 'presspixel-creations/journal';
const signature = createCloudinaryUploadSignature();
assert.equal(signature.folder, 'presspixel-creations/journal');
assert.match(signature.signature, /^[a-f0-9]{40}$/);
assert.equal(isExpectedCloudinaryImage({
  publicId: 'presspixel-creations/journal/example-image',
  url: 'https://res.cloudinary.com/presspixel-demo/image/upload/v1/presspixel-creations/journal/example-image.webp',
  width: 1200,
  height: 630,
}), true);
assert.equal(isExpectedCloudinaryImage({
  publicId: 'outside-folder/image',
  url: 'https://example.com/image.webp',
  width: 1200,
  height: 630,
}), false);
for (const [key, value] of Object.entries(original)) {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

console.log('Validated structured block content, safe rendering, Denver scheduling, and Cloudinary upload guards.');
