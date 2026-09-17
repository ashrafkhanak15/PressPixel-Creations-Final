// Generates the default social sharing image (1200x630) used by Open Graph and
// Twitter cards. Re-run after brand changes: node scripts/generate-og-image.mjs
//
// The same dark palette, accent orange, and four-square pixel mark as the site
// header, so shared links look like the site rather than a generic preview.
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';

const OUT = new URL('../public/images/og-default.png', import.meta.url);

const PAPER = '#f2f2eb';
const MUTED = '#a5a59b';
const ACCENT = '#ffa500';
const INK = '#0b0b0b';

// Pixel mark: the four offset squares from favicon.svg, scaled up.
const mark = (x, y, unit) => {
  const s = unit;
  const gap = unit * 0.375;
  const cell = (cx, cy) => `<rect x="${x + cx * (s + gap)}" y="${y + cy * (s + gap)}" width="${s}" height="${s}" rx="${s * 0.16}" fill="${ACCENT}"/>`;
  return cell(0, 0.5) + cell(1.375, 0) + cell(0, 1.875) + cell(1.375, 1.375);
};

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="glow" x1="1" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffa500" stop-opacity="0.16"/>
      <stop offset="0.55" stop-color="#ffa500" stop-opacity="0.02"/>
      <stop offset="1" stop-color="#ffa500" stop-opacity="0"/>
    </linearGradient>
    <radialGradient id="spot" cx="0.86" cy="0.12" r="0.7">
      <stop offset="0" stop-color="#ffa500" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#ffa500" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="1200" height="630" fill="${INK}"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect width="1200" height="630" fill="url(#spot)"/>

  <!-- faint pixel grid, echoing the brand mark -->
  <g fill="${PAPER}" opacity="0.045">
    ${Array.from({ length: 11 }, (_, r) => Array.from({ length: 7 }, (_, c) => {
      const size = 9;
      return `<rect x="${1010 + c * 26}" y="${392 + r * 26}" width="${size}" height="${size}" rx="2"/>`;
    }).join('')).join('')}
  </g>

  <!-- logo lockup -->
  <g>
    ${mark(80, 74, 26)}
    <text x="${80 + 2.375 * 26 + 0.375 * 26 + 22}" y="110" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif"
      font-size="42" font-weight="700" letter-spacing="-1.4" fill="${PAPER}">presspixel</text>
    <text x="${80 + 2.375 * 26 + 0.375 * 26 + 24}" y="134" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif"
      font-size="15" font-weight="600" letter-spacing="7.5" fill="${MUTED}">CREATIONS</text>
  </g>

  <!-- headline -->
  <text x="80" y="300" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif"
    font-size="76" font-weight="700" letter-spacing="-3" fill="${PAPER}">Web design, SEO</text>
  <text x="80" y="384" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif"
    font-size="76" font-weight="700" letter-spacing="-3" fill="${PAPER}">&amp; digital growth for</text>
  <text x="80" y="468" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif"
    font-size="76" font-weight="700" letter-spacing="-3" fill="${ACCENT}">service businesses.</text>

  <!-- footer rule + domain -->
  <rect x="80" y="530" width="96" height="5" rx="2.5" fill="${ACCENT}"/>
  <text x="204" y="538" font-family="Segoe UI, Helvetica Neue, Arial, sans-serif"
    font-size="24" font-weight="500" fill="${MUTED}">presspixelcreations.com</text>
</svg>`;

const png = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
await writeFile(OUT, png);

const meta = await sharp(png).metadata();
console.log(`Wrote ${meta.width}x${meta.height} social card, ${(png.length / 1024).toFixed(1)} KB`);