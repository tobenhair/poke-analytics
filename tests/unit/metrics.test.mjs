// ============================================================
// Unit tests for the shared metrics module
// ============================================================
// The pure scoring/derivation functions in metrics.js are the analytical core
// the whole dashboard exists to show. index.html imports the same file, so
// these assertions guard the numbers on the live page — not a copy. Run with
// `npm run test:unit` (node --test); wired into `npm test` and CI.
//
// No DOM and no build step: these functions take every dependency as a
// parameter, so they import and run directly under Node.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boostersFromType,
  calcAgeWeight,
  recomputeScores,
  deriveProducts,
} from '../../metrics.js';

// ── boostersFromType: the fixed physical constants ──────────────
test('boostersFromType returns the fixed booster counts', () => {
  assert.equal(boostersFromType('BOX'), 36);
  assert.equal(boostersFromType('ETB'), 9);
  assert.equal(boostersFromType('BUNDLE'), 6);
});

test('boostersFromType returns null for an unknown type', () => {
  assert.equal(boostersFromType('SINGLE'), null);
  assert.equal(boostersFromType(''), null);
  assert.equal(boostersFromType(undefined), null);
});

// ── calcAgeWeight: 0–1 youth penalty vs the threshold ───────────
test('calcAgeWeight is full weight at or above the threshold', () => {
  assert.equal(calcAgeWeight(1, 1), 1.0);   // exactly at threshold
  assert.equal(calcAgeWeight(2.5, 1), 1.0); // above threshold
  assert.equal(calcAgeWeight(5, 3), 1.0);
});

test('calcAgeWeight scales linearly below the threshold', () => {
  assert.equal(calcAgeWeight(0.5, 1), 0.5);
  assert.equal(calcAgeWeight(1.5, 3), 0.5);
  assert.equal(calcAgeWeight(0.75, 1), 0.75);
});

test('calcAgeWeight floors at 0.10 for very new products', () => {
  assert.equal(calcAgeWeight(0, 1), 0.10);
  assert.equal(calcAgeWeight(0.01, 1), 0.10); // below the floor → clamped
  assert.equal(calcAgeWeight(0.10, 1), 0.10); // exactly the floor
});

test('calcAgeWeight rounds to two decimals', () => {
  // 0.333.../1 rounds to 0.33
  assert.equal(calcAgeWeight(1 / 3, 1), 0.33);
});

// ── recomputeScores: threshold-dependent ageWeight + score ──────
test('recomputeScores mutates ageWeight and score from the threshold', () => {
  const products = [
    { age: 0.5, svPerBooster: 40 }, // young → penalised
    { age: 5,   svPerBooster: 20 }, // old   → full weight
  ];
  recomputeScores(products, 1);
  assert.equal(products[0].ageWeight, 0.5);
  assert.equal(products[0].score, 20.0); // 40 × 0.5
  assert.equal(products[1].ageWeight, 1.0);
  assert.equal(products[1].score, 20.0); // 20 × 1.0
});

test('recomputeScores re-ranks when the threshold changes but leaves svPerBooster alone', () => {
  const products = [{ age: 1.5, svPerBooster: 100 }];
  recomputeScores(products, 1);
  assert.equal(products[0].ageWeight, 1.0);   // 1.5 >= 1
  assert.equal(products[0].score, 100.0);
  recomputeScores(products, 3);
  assert.equal(products[0].ageWeight, 0.5);   // 1.5 / 3
  assert.equal(products[0].score, 50.0);
  assert.equal(products[0].svPerBooster, 100); // untouched
});

// ── deriveProducts: raw inputs + latest snapshot → metrics ──────
// Use a release far in the past so the provisional (3-year) age weight is a
// deterministic 1.0 regardless of when the test runs; that isolates the
// time-independent price/value math.
function box(name, price, setVal) {
  return {
    products: [{ name, type: 'BOX', release: '2000-01-01' }],
    hist: { [name]: { price: [price], setVal: [setVal] } },
  };
}

test('deriveProducts computes price/booster, sv/booster and score', () => {
  const { products, hist } = box('Old Box', 360, 720);
  const errors = deriveProducts(products, hist);
  assert.deepEqual(errors, []);
  const p = products[0];
  assert.equal(p.boosters, 36);
  assert.equal(p.price, 360);
  assert.equal(p.setVal, 720);
  assert.equal(p.pricePerBooster, 10);   // 360 / 36
  assert.equal(p.svPerBooster, 72);      // 720 / 10
  assert.equal(p.ageWeight, 1.0);        // released in 2000 → older than 3y
  assert.equal(p.score, 72.0);           // 72 × 1.0
});

test('deriveProducts uses the latest non-null price and set value', () => {
  const products = [{ name: 'Gappy', type: 'BOX', release: '2000-01-01' }];
  const hist = { Gappy: { price: [360, null, 720], setVal: [100, 1440, null] } };
  deriveProducts(products, hist);
  const p = products[0];
  assert.equal(p.price, 720);            // latest non-null price
  assert.equal(p.setVal, 1440);          // latest non-null set value
  assert.equal(p.pricePerBooster, 20);   // 720 / 36
  assert.equal(p.svPerBooster, 72);      // 1440 / 20
});

test('deriveProducts reports missing price and set value', () => {
  const products = [{ name: 'Empty', type: 'BOX', release: '2000-01-01' }];
  const errors = deriveProducts(products, { Empty: { price: [null], setVal: [null] } });
  assert.equal(errors.length, 2);
  assert.match(errors[0], /"Empty": no valid Price/);
  assert.match(errors[1], /"Empty": no valid Set Value/);
});

test('deriveProducts reports a product absent from historical data', () => {
  const products = [{ name: 'Ghost', type: 'ETB', release: '2000-01-01' }];
  const errors = deriveProducts(products, {});
  assert.equal(errors.length, 2); // no price and no set value
});
