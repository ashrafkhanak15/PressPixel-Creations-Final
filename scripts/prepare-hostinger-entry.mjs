import { copyFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';

const source = resolve('server.mjs');
const target = resolve('dist/server/start.mjs');
await access(resolve('dist/server/entry.mjs'));
await access(resolve('dist/server/security-policy.json'));
await copyFile(source, target);
console.log('Prepared Hostinger runtime entry at dist/server/start.mjs.');
