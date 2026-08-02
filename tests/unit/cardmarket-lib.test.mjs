// Pins the pure Cardmarket ingestion core (scripts/cardmarket-lib.mjs) — the
// same math the scheduled ingest job writes to Supabase. Guards against silent
// drift in the name-matching and the Price / Set Value derivation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveIds, deriveProducts, norm, score, singlesByExpansion } from '../../scripts/cardmarket-lib.mjs';

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
