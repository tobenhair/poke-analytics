// ============================================================
// Scale fixture generator (dev-only, never shipped)
// ============================================================
// Produces a contract-valid workbook of arbitrary size so the board and charts
// can be measured at catalogue scale *before* the catalogue gets there
// organically. Output is deterministic for a given --seed, so a measurement run
// can be repeated and compared.
//
// Two axes matter and they stress different code:
//   --products N   more rows in the board, scatter, relative value, momentum,
//                  the comparison pickers, and the Data Entry grid.
//   --snapshots M  longer price[]/setVal[] series per product — the charts,
//                  momentum/drawdown, and every per-snapshot loop.
// Measuring only N would report "all clear" while leaving the M-shaped risk
// (automated ingestion moves the cadence from monthly to daily) untested.
//
// Usage:
//   node scripts/gen-scale-fixture.mjs --products 400 --snapshots 24 \
//        --cadence monthly --out /tmp/scale-400x24.xlsx
//   npm run scale:fixture -- --products 200 --out /tmp/f.xlsx
//
// The output satisfies exactly what parseXlsx() + deriveProducts() require, so
// `node scripts/validate-workbook.mjs <out>` must pass on it — the generator
// self-checks the invariants that matter, but run the validator too: it is the
// contract's real mirror.
// ============================================================

import * as XLSX from 'xlsx';
import { writeFileSync } from 'node:fs';
import { boostersFromType } from '../metrics.js';

// ── Args ──
const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
};

const N        = parseInt(arg('products', '400'), 10);
const M        = parseInt(arg('snapshots', '24'), 10);
const CADENCE  = String(arg('cadence', 'monthly'));
const SEED     = parseInt(arg('seed', '20260725'), 10);
const OUT      = arg('out', `scale-${N}x${M}.xlsx`);

if (!Number.isInteger(N) || N < 1) fail('--products must be a positive integer');
if (!Number.isInteger(M) || M < 1) fail('--snapshots must be a positive integer');
if (!['monthly', 'weekly', 'daily'].includes(CADENCE)) fail('--cadence must be monthly, weekly, or daily');

// ── Deterministic PRNG (mulberry32) ──
// Seeded so two runs of the same matrix produce byte-identical fixtures; a
// measurement that can't be repeated isn't a measurement.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(SEED);
const between = (lo, hi) => lo + rand() * (hi - lo);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

// ── Product mix ──
// Mirrors the real workbook's shape (36 products: 23 BOX / 7 ETB / 6 BUNDLE)
// so the type-dependent maths (boosters, SV/Booster) sees a realistic spread
// rather than a uniform one.
const TYPE_MIX = [
  ...Array(64).fill('BOX'),
  ...Array(19).fill('ETB'),
  ...Array(17).fill('BUNDLE'),
];

// Release dates: ~60 distinct dates spread over the era the real catalogue
// covers (2015 → 2026), so age-dependent metrics (age weight, the age fit,
// peer residuals grouped by release) have realistic buckets to work with.
const RELEASE_COUNT = Math.max(6, Math.min(60, Math.ceil(N / 6)));
const releaseDates = [];
for (let i = 0; i < RELEASE_COUNT; i++) {
  const d = new Date(Date.UTC(2015, 0, 15));
  d.setUTCMonth(d.getUTCMonth() + Math.round((i / Math.max(1, RELEASE_COUNT - 1)) * 135)); // ~11.25 years
  releaseDates.push(d);
}

const iso = (d) => d.toISOString().slice(0, 10);
const pad = (n, w) => String(n).padStart(w, '0');

// ── Summary rows ──
// Names are unique by construction (set index + type + ordinal), which is the
// contract's one hard uniqueness rule.
const TYPE_LABEL = { BOX: 'Booster Box', ETB: 'Elite Trainer Box', BUNDLE: 'Booster Bundle' };
const products = [];
for (let i = 0; i < N; i++) {
  const type = TYPE_MIX[i % TYPE_MIX.length];
  const setIdx = i % RELEASE_COUNT;
  products.push({
    name: `Fixture Set ${pad(setIdx + 1, 3)} ${TYPE_LABEL[type]} ${pad(i + 1, 4)}`,
    type,
    setIdx,
    release: releaseDates[setIdx],
    // Target SV/Booster. Price is *derived* from it (below) so that products
    // sharing a set stay mutually consistent — the property typeOutliers()
    // checks. A per-product target within a narrow band gives the relative-value
    // and peer-residual code realistic within-set scatter to work on.
    targetSvb: between(22, 45),
  });
}

// ── Snapshot dates ──
// The cadence is the honest part of the M axis: 365 *monthly* snapshots would
// imply a 30-year history, so long series are generated daily (which is also
// exactly what automated ingestion would produce).
const stepDays = CADENCE === 'monthly' ? 30 : CADENCE === 'weekly' ? 7 : 1;
const lastSnapshot = Date.UTC(2026, 6, 6); // matches the real workbook's newest
const snapshotDates = [];
for (let i = M - 1; i >= 0; i--) {
  snapshotDates.push(new Date(lastSnapshot - i * stepDays * 864e5));
}

// ── Set Value series, one per set ──
// Set Value is a property of the *set*, not the product: every product from a
// given set shares it (that is exactly what the real workbook contains, and
// what typeOutliers() assumes when it compares same-set siblings). Modelling it
// per-product instead produced a fixture where SV/Booster disagreed wildly
// within a set — 143 spurious data-quality warnings, and unrealistic input for
// the peer-residual maths.
const setValueSeries = releaseDates.map((release) => {
  const ageYears = (Date.UTC(2026, 6, 1) - release.getTime()) / (365.25 * 864e5);
  // Older sets carry more value (their singles have appreciated).
  let sv = between(150, 900) * (1 + ageYears * between(0.15, 0.55));
  const drift = between(-0.002, 0.008);
  return snapshotDates.map(() => {
    sv = Math.max(20, sv * (1 + drift + between(-0.03, 0.03)));
    return sv;
  });
});

// ── Historical rows ──
// Price is derived from the set's value and the product's target SV/Booster
// (SV/Booster = setVal ÷ (price ÷ boosters), so price = setVal × boosters ÷
// target), then given its own noise so momentum/drawdown and the trend charts
// see real movement rather than a scaled copy of the set curve.
const history = [];
for (const p of products) {
  const boosters = boostersFromType(p.type);
  const svSeries = setValueSeries[p.setIdx];
  let noise = 1;
  snapshotDates.forEach((d, t) => {
    noise = Math.min(1.35, Math.max(0.75, noise * (1 + between(-0.04, 0.04))));
    const setValue = svSeries[t];
    const price = Math.max(5, (setValue * boosters / p.targetSvb) * noise);
    history.push({
      Product: p.name,
      'Snapshot Date': iso(d),
      'Price (€)': Math.round(price * 100) / 100,
      'Set Value (€)': Math.round(setValue * 100) / 100,
    });
  });
}

// ── Links (optional sheet — exercised because the real workbook has one) ──
const links = products
  .filter((_, i) => i % 2 === 0)
  .map((p) => ({ Product: p.name, URL: `https://example.invalid/${encodeURIComponent(p.name)}` }));

// ── Self-checks: the invariants whose breach makes the app silently fall back ──
const problems = [];
if (new Set(products.map((p) => p.name)).size !== products.length) problems.push('duplicate product names');
if (!products.every((p) => ['BOX', 'ETB', 'BUNDLE'].includes(p.type))) problems.push('invalid Type');
if (!products.every((p) => boostersFromType(p.type) > 0)) problems.push('Type with no booster count');
if (history.length !== products.length * snapshotDates.length) problems.push('history row count mismatch');
if (!history.every((r) => r['Price (€)'] >= 0 && r['Set Value (€)'] >= 0)) problems.push('negative price or set value');
if (problems.length) fail(`generated fixture is invalid: ${problems.join('; ')}`);

// ── Write ──
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(products.map((p) => ({
  Product: p.name,
  Type: p.type,
  'Release Date': iso(p.release),
}))), 'Summary');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(history), 'Historical Data');
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(links), 'Links');
XLSX.writeFile(wb, OUT);

console.log(`✓ ${OUT}`);
console.log(`  ${products.length} products · ${history.length} history rows · ${snapshotDates.length} ${CADENCE} snapshots (${iso(snapshotDates[0])} → ${iso(snapshotDates[snapshotDates.length - 1])}) · seed ${SEED}`);
console.log(`  Validate it: node scripts/validate-workbook.mjs ${OUT}`);

function fail(msg) {
  console.error(`✕ ${msg}`);
  process.exit(1);
}
