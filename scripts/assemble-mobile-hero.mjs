import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const root = process.cwd();
const parts = await Promise.all(
  [0, 1, 2, 3].map((i) =>
    readFile(join(root, `scripts/assets/mobile-hero.part${i}.b64`), 'utf8')
  )
);

const output = join(root, 'public/images/mobile-hero-cubes.webp');
await mkdir(dirname(output), { recursive: true });

const bytes = Buffer.from(parts.join('').replace(/\s+/g, ''), 'base64');
if (!bytes.length) throw new Error('Mobile hero asset decoded to an empty file.');

await writeFile(output, bytes);
console.log(`Assembled mobile hero asset: ${bytes.length} bytes`);
