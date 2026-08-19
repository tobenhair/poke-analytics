// Pins the pure Cardmarket ingestion core (scripts/cardmarket-lib.mjs) — the
// same math the scheduled ingest job writes to Supabase. Guards against silent
// drift in the name-matching and the Price / Set Value derivation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIds, deriveProducts, norm, score, singlesByExpansion, guardSetValue, SV_MAX_DAILY_JUMP } from '../../scripts/cardmarket-lib.mjs';

// A tiny stand-in for cardmarket-map.json.
const map = {
  priceField: 'avg30',
  products: {
    'Evolving Skies Booster Box': { type: 'BOX', release: '2021-08-27', cardmarket_url: 'u1' },
    'Mega Evolutions Booster Box': { type: 'BOX', release: '2025-09-26' },
    'Team Up Booster Box': { type: 'BOX', release: '2019-02-01', priceOverride: 11000 },
    'Shrouded Fable Booster Bundle': { type: 'BUNDLE', release: '2024-08-02', nameHint: 'Shrouded Fable Booster Bundle Version 1' },
  },
};

const nonsingles = [
  { idProduct: 100, name: 'Evolving Skies Booster Box', categoryName: 'Booster Box', idExpansion: 10 },
  { idProduct: 200, name: 'Mega Evolution Booster Box', categoryName: 'Booster Box', idExpansion: 20 }, // singular
  { idProduct: 250, name: 'Evolutions Booster Box', categoryName: 'Booster Box', idExpansion: 25 }, // the decoy Mega must NOT hit
  { idProduct: 300, name: 'Team Up Booster Box', categoryName: 'Booster Box', idExpansion: 30 },
  { idProduct: 401, name: 'Shrouded Fable Booster Bundle Display', categoryName: 'Booster Box', idExpansion: 40 },
  { idProduct: 402, name: 'Shrouded Fable Booster Bundle Version 1', categoryName: 'Booster Box', idExpansion: 40 },
];

test('norm singularises so plural/singular collide but distinct sets do not', () => {
  assert.equal(norm('Mega Evolutions Booster Box'), norm('Mega Evolution Booster Box'));
  assert.equal(score('Mega Evolutions Booster Box', 'Mega Evolution Booster Box'), 1);
  assert.ok(score('Mega Evolutions Booster Box', 'Evolutions Booster Box') < 1);
});

test('resolveIds matches names, honours nameHint, rejects the wrong-type decoy', () => {
  const r = resolveIds(map, nonsingles);
  assert.equal(r['Evolving Skies Booster Box'].idProduct, 100);
  // singularisation makes the real Mega win over the 2016 "Evolutions" decoy
  assert.equal(r['Mega Evolutions Booster Box'].idProduct, 200);
  // nameHint pins the "Version 1" bundle, not the "Display" case
  assert.equal(r['Shrouded Fable Booster Bundle'].idProduct, 402);
});

test('resolveIds honours an explicit pinned idProduct', () => {
  const pinned = { products: { 'Team Up Booster Box': { idProduct: 300 } } };
  const r = resolveIds(pinned, nonsingles);
  assert.equal(r['Team Up Booster Box'].idProduct, 300);
  assert.equal(r['Team Up Booster Box'].source, 'pinned');
});

// Price guide: sealed boxes carry avg/low/trend only (no avg30); singles carry avg30.
const priceGuide = [
  // sealed boxes
  { idProduct: 100, avg: 2000, low: 1200, trend: 1800 }, // Evolving Skies box
  { idProduct: 200, avg: 260, low: 150, trend: 250 }, // Mega box
  { idProduct: 300, avg: 10100, low: 1849, trend: 6300 }, // Team Up box — trend/avg diverge → thin
  { idProduct: 402, avg: 41, low: 30, trend: 40 }, // Shrouded Fable bundle
  // singles (avg30 populated)
  { idProduct: 1001, avg30: 50, low: 20, trend: 55 },
  { idProduct: 1002, avg30: 10, low: 8, trend: 11 },
  { idProduct: 2001, avg30: 30, low: 15, trend: 33 },
];
const singles = [
  { idProduct: 1001, idExpansion: 10 },
  { idProduct: 1002, idExpansion: 10 },
  { idProduct: 2001, idExpansion: 20 },
];

test('deriveProducts: box price = trend/avg blend, Set Value = avg30 singles sum', () => {
  const resolved = resolveIds(map, nonsingles);
  const d = deriveProducts(map, resolved, priceGuide, singles);
  // Evolving Skies: price = (trend 1800 + avg 2000)/2 = 1900; SV = 50 + 10 = 60
  assert.equal(d['Evolving Skies Booster Box'].price, 1900);
  assert.equal(d['Evolving Skies Booster Box'].priceSrc, 'blend');
  assert.equal(d['Evolving Skies Booster Box'].setValue, 60);
  assert.equal(d['Evolving Skies Booster Box'].nSingles, 2);
  // Mega: price = (trend 250 + avg 260)/2 = 255; SV = 30 (single 2001 in exp 20)
  assert.equal(d['Mega Evolutions Booster Box'].price, 255);
  assert.equal(d['Mega Evolutions Booster Box'].setValue, 30);
});

test('deriveProducts: promoValue = the bundled promo single\'s avg30 (its moving value)', () => {
  // A product that pins a promo single id gets that card's avg30 — the same
  // basis as Set Value — so the promo tracks the market instead of a static €.
  const m = { products: { 'Promo ETB': { type: 'ETB', release: '2024-01-01', promoIdProduct: 9001 } } };
  const ns = [{ idProduct: 500, name: 'Promo ETB', categoryName: 'Elite Trainer Box', idExpansion: 50 }];
  const pg = [
    { idProduct: 500, avg: 100, trend: 100, low: 90 },     // the box itself
    { idProduct: 9001, avg30: 12.5, trend: 14, low: 9 },   // the bundled promo single
  ];
  const d = deriveProducts(m, resolveIds(m, ns), pg, []);
  assert.equal(d['Promo ETB'].promoIdProduct, 9001);
  assert.equal(d['Promo ETB'].promoValue, 12.5);           // avg30, not a static number
});

test('deriveProducts: no promo id → promoValue null', () => {
  const m = { products: { 'Plain Box': { type: 'BOX', release: '2024-01-01' } } };
  const ns = [{ idProduct: 600, name: 'Plain Box', categoryName: 'Booster Box', idExpansion: 60 }];
  const d = deriveProducts(m, resolveIds(m, ns), [{ idProduct: 600, avg: 100, trend: 100 }], []);
  assert.equal(d['Plain Box'].promoValue, null);
});

test('deriveProducts: a trend far below avg uses avg, not the dragged-down blend', () => {
  const m = { products: { 'Grail Box': { type: 'BOX', release: '2019-01-01' } } };
  const ns = [{ idProduct: 950, name: 'Grail Box', categoryName: 'Booster Box', idExpansion: 95 }];
  // trend 600 is 40% below avg 1000 → past the 30% gap → use avg (a stale/thin
  // trend would otherwise blend to a wrong 800).
  const pg = [{ idProduct: 950, avg: 1000, low: 400, trend: 600 }];
  const d = deriveProducts(m, resolveIds(m, ns), pg, []);
  assert.equal(d['Grail Box'].price, 1000);       // avg, not the blend 800
  assert.equal(d['Grail Box'].priceSrc, 'avg');
  assert.equal(d['Grail Box'].lowLiquidity, true); // still flagged for review
});

test('deriveProducts: a trend only moderately below avg still blends', () => {
  const m = { products: { 'Thin Box': { type: 'BOX', release: '2019-01-01' } } };
  const ns = [{ idProduct: 951, name: 'Thin Box', categoryName: 'Booster Box', idExpansion: 96 }];
  // trend 800 is 20% below avg 1000 → within the 30% gap → blend (900).
  const pg = [{ idProduct: 951, avg: 1000, low: 500, trend: 800 }];
  const d = deriveProducts(m, resolveIds(m, ns), pg, []);
  assert.equal(d['Thin Box'].price, 900);
  assert.equal(d['Thin Box'].priceSrc, 'blend');
});

test('deriveProducts: box price falls back to the single value when avg is absent', () => {
  const m = { products: { 'X Box': { type: 'BOX', release: '2020-01-01' } } };
  const ns = [{ idProduct: 900, name: 'X Box', categoryName: 'Booster Box', idExpansion: 90 }];
  const pg = [{ idProduct: 900, trend: 400 }]; // no avg
  const d = deriveProducts(m, resolveIds(m, ns), pg, []);
  assert.equal(d['X Box'].price, 400);
  assert.equal(d['X Box'].priceSrc, 'trend');
});

test('deriveProducts: priceOverride wins for the box price; Set Value stays derived', () => {
  const resolved = resolveIds(map, nonsingles);
  const d = deriveProducts(map, resolved, priceGuide, singles);
  assert.equal(d['Team Up Booster Box'].price, 11000); // the override, not trend 6300
  assert.equal(d['Team Up Booster Box'].priceSrc, 'override');
});

test('deriveProducts: lowLiquidity flags a thin box (trend vs avg ≥20% apart)', () => {
  const resolved = resolveIds(map, nonsingles);
  const d = deriveProducts(map, resolved, priceGuide, singles);
  assert.equal(d['Team Up Booster Box'].lowLiquidity, true); // 10100 vs 6300
  assert.equal(d['Evolving Skies Booster Box'].lowLiquidity, false); // 2000 vs 1800
});

test('deriveProducts: avgPrice / lowPrice carry the guide reference prices', () => {
  const resolved = resolveIds(map, nonsingles);
  const d = deriveProducts(map, resolved, priceGuide, singles);
  // Team Up guide row: avg 10100, low 1849 — the spread shown for review.
  assert.equal(d['Team Up Booster Box'].avgPrice, 10100);
  assert.equal(d['Team Up Booster Box'].lowPrice, 1849);
  // priceOverride doesn't touch the reference prices.
  assert.equal(d['Team Up Booster Box'].price, 11000);
});

test('singlesByExpansion groups single ids by expansion (the precomputed catalog)', () => {
  const byExp = singlesByExpansion(singles);
  // keyed by String(idExpansion); values are numeric single idProducts
  assert.deepEqual(byExp.get('10'), [1001, 1002]);
  assert.deepEqual(byExp.get('20'), [2001]);
  assert.equal(byExp.has('99'), false);
  // this is exactly the Edge Function's Set Value input: Σ avg30 over these ids
  // for expansion 10 = 50 + 10 = 60, matching the deriveProducts assertion above.
});

test('singlesByExpansion drops excluded ids (the mis-tagged-single exclusion list)', () => {
  assert.deepEqual(singlesByExpansion(singles, [1001]).get('10'), [1002]); // number id dropped
  assert.deepEqual(singlesByExpansion(singles, new Set(['1001'])).get('10'), [1002]); // string/Set too
  assert.deepEqual(singlesByExpansion(singles, [1001]).get('20'), [2001]); // other expansions untouched
});

test('deriveProducts: excludeIds drops a mis-tagged single from the Set Value sum', () => {
  const resolved = resolveIds(map, nonsingles);
  const d = deriveProducts(map, resolved, priceGuide, singles, { excludeIds: [1001] });
  // Evolving Skies SV without the excluded 1001 (avg30 50) = 10, over 1 single
  assert.equal(d['Evolving Skies Booster Box'].setValue, 10);
  assert.equal(d['Evolving Skies Booster Box'].nSingles, 1);
});

test('guardSetValue holds a big single-day RISE (the mis-tagged-card artefact)', () => {
  // The Sword & Shield case: €635 → €3,132 overnight (4.93×) from one promo card
  // wrongly summed into the set. The guard holds the previous value instead.
  const g = guardSetValue(3131.6, 635.51);
  assert.equal(g.held, true);
  assert.equal(g.value, 635.51);       // held at the previous good value, not the spike
  assert.equal(g.ratio, 4.9277);
});

test('guardSetValue lets an ordinary day-to-day move through', () => {
  const g = guardSetValue(648, 635.51);   // ~2% up
  assert.equal(g.held, false);
  assert.equal(g.value, 648);
});

test('guardSetValue lets a FALL through so a fixed artefact self-corrects', () => {
  // Once the bad card is removed the recomputed value drops back; a down-guard
  // would trap the set at the inflated value, so falls are always accepted.
  const g = guardSetValue(632, 3131.6);
  assert.equal(g.held, false);
  assert.equal(g.value, 632);
});

test('guardSetValue is a no-op with no usable previous value', () => {
  assert.deepEqual(guardSetValue(3000, null), { value: 3000, held: false, ratio: null });
  assert.deepEqual(guardSetValue(3000, 0), { value: 3000, held: false, ratio: null });
  assert.equal(guardSetValue(null, 635).value, null);
});

test('guardSetValue boundary: exactly at the threshold is allowed, just over is held', () => {
  const atCap = 635.51 * (1 + SV_MAX_DAILY_JUMP);
  assert.equal(guardSetValue(atCap, 635.51).held, false);              // == +50% passes
  assert.equal(guardSetValue(atCap + 1, 635.51).held, true);           // just over is held
});
