// ============================================================
// PWA icon generator (dev tool — not in `npm test`)
// ============================================================
// Rasterises the app's logo mark (the same three-bar chart used by the inline
// SVG favicon in index.html and the header logo) into the PNG icons the web app
// manifest needs. Deterministic: run it whenever the mark changes, commit the
// PNGs. Kept out of `npm test` because it needs a browser to rasterise.
//
//   node scripts/gen-pwa-icons.mjs
//
// Colours are the design tokens (#0a0b0f canvas, the blue/gold/green bar hues);
// keep them in sync with :root and the favicon if the palette moves.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');

const BG = '#0a0b0f';
const BARS = [
  { h: 120, fill: '#5cc7f2' }, // blue  — shortest
  { h: 195, fill: '#f4c651' }, // gold  — mid
  { h: 255, fill: '#7fd493' }, // green — tallest
];

// Build the mark on a 512 grid, scaled by `s` (1 = full-bleed app icon, ~0.72 =
// maskable, so the OS's circle/squircle mask never clips into the bars). Bottom-
// aligned, horizontally centred; the dark background is always full-bleed.
function markSvg(s) {
  const barW = 44 * s, gap = 16 * s;
  const totalW = BARS.length * barW + (BARS.length - 1) * gap;
  const x0 = (512 - totalW) / 2;
  const baseY = 256 + (255 * s) / 2; // centre the tallest bar vertically
  const rects = BARS.map((b, i) => {
    const h = b.h * s;
    const x = x0 + i * (barW + gap);
    const y = baseY - h;
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="${(8 * s).toFixed(1)}" fill="${b.fill}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">`
    + `<rect width="512" height="512" fill="${BG}"/>${rects}</svg>`;
}

const ICONS = [
  { file: 'icon-192.png',          size: 192, scale: 1 },
  { file: 'icon-512.png',          size: 512, scale: 1 },
  { file: 'icon-maskable-512.png', size: 512, scale: 0.72 },
];

await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
try {
  for (const { file, size, scale } of ICONS) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{width:${size}px;height:${size}px}svg{display:block;width:${size}px;height:${size}px}</style>${markSvg(scale)}`
    );
    await page.locator('svg').screenshot({ path: join(OUT, file), omitBackground: false });
    await page.close();
    console.log('wrote icons/' + file + ` (${size}×${size})`);
  }
} finally {
  await browser.close();
}
