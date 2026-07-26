// ============================================================
// Serve the CDN libraries from node_modules
// ============================================================
// index.html loads Chart.js, SheetJS and Google Fonts from CDNs at runtime.
// That is right for the deployed page (no build step) but wrong for a test: an
// outage, a proxy, or an offline machine turns a green suite red for reasons
// that have nothing to do with the code. Worse, the failure is confusing —
// without Chart.js the page raises its "required library" guard, an overlay
// that swallows pointer events, so the first symptom is an unrelated-looking
// click timeout rather than "the CDN was unreachable".
//
// The node_modules copies are pinned in package.json to the exact versions in
// index.html's <script> tags. If you bump one, bump the other — the versions
// are asserted below so a mismatch fails loudly instead of testing a different
// library than the one that ships.
// ============================================================

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

export const chartJs = readFileSync(join(root, 'node_modules/chart.js/dist/chart.umd.js'), 'utf8');
export const xlsxJs = readFileSync(join(root, 'node_modules/xlsx/dist/xlsx.full.min.js'), 'utf8');

// Guard the pin: the served copy must be the version index.html asks for.
const indexHtml = readFileSync(join(root, 'index.html'), 'utf8');
for (const [label, pattern] of [
  ['Chart.js', /Chart\.js\/([0-9.]+)\/chart\.umd\.min\.js/],
  ['xlsx', /xlsx\/([0-9.]+)\/xlsx\.full\.min\.js/],
]) {
  const wanted = indexHtml.match(pattern)?.[1];
  const installed = JSON.parse(
    readFileSync(join(root, `node_modules/${label === 'Chart.js' ? 'chart.js' : 'xlsx'}/package.json`), 'utf8'),
  ).version;
  if (wanted && wanted !== installed) {
    throw new Error(
      `${label} version mismatch: index.html loads ${wanted} from the CDN but node_modules has ${installed}. ` +
      `Update the devDependency in package.json (or the CDN tag) so tests exercise the shipped version.`,
    );
  }
}

const js = (body) => ({ contentType: 'application/javascript', body });

// Fixed EUR→x rates for the Portfolio currency picker. The page fetches live
// rates on boot; left unstubbed, every spec would make a real call to
// Frankfurter — slow, offline-hostile, and non-deterministic (the picker's
// contents would depend on whether the network answered). Real values, frozen.
export const FX_RATES = { amount: 1, base: 'EUR', date: '2026-07-24', rates: { USD: 1.09, GBP: 0.84, SEK: 11.30 } };

/**
 * Route a page's external requests to local copies/stubs. Call before
 * page.goto(). Fonts are stubbed empty rather than served — they affect
 * nothing under test, and blocking them keeps the run offline-clean.
 *
 * A spec that wants different FX behaviour can register its own
 * `**frankfurter**` route afterwards: Playwright gives precedence to the most
 * recently registered matching handler.
 */
export async function routeLocalLibs(page) {
  await page.route('**cdnjs.cloudflare.com/**Chart.js**', (r) => r.fulfill(js(chartJs)));
  await page.route('**cdnjs.cloudflare.com/**xlsx**', (r) => r.fulfill(js(xlsxJs)));
  await page.route('**fonts.googleapis.com/**', (r) => r.fulfill({ contentType: 'text/css', body: '' }));
  await page.route('**fonts.gstatic.com/**', (r) => r.abort());
  await page.route('**frankfurter**', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(FX_RATES) }));
}
