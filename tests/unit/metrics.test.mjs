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
  linearFit,
  expectedSvPerBooster,
  fairPrice,
  FAIR_PRICE_MIN_R2,
  verdict,
  VERDICT,
  setLabel,
  groupSets,
  meanSeries,
  concentrationShares,
  rebalanceSuggestions,
  OVER_EXPOSED_SHARE,
  portfolioValueSeries,
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

// ── linearFit: least-squares slope/intercept + R² ──────────────
test('linearFit needs at least two points', () => {
  assert.equal(linearFit([]), null);
  assert.equal(linearFit([{ x: 1, y: 1 }]), null);
});

test('linearFit is null when the ages do not vary (vertical fit)', () => {
  assert.equal(linearFit([{ x: 2, y: 10 }, { x: 2, y: 40 }]), null);
});

test('linearFit recovers a perfect line with R² = 1', () => {
  // y = 5 + 2x exactly
  const fit = linearFit([{ x: 0, y: 5 }, { x: 1, y: 7 }, { x: 2, y: 9 }]);
  assert.ok(Math.abs(fit.a - 5) < 1e-9);
  assert.ok(Math.abs(fit.b - 2) < 1e-9);
  assert.ok(Math.abs(fit.r2 - 1) < 1e-9);
});

test('linearFit treats a flat spread of y as a perfect (R² = 1) flat line', () => {
  const fit = linearFit([{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }]);
  assert.ok(Math.abs(fit.b) < 1e-9); // zero slope
  assert.equal(fit.r2, 1);
});

test('linearFit reports R² ≈ 0 for an uncorrelated cloud', () => {
  // Symmetric zig-zag: best-fit slope is 0, so the fit explains no variance.
  const fit = linearFit([{ x: 0, y: 0 }, { x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 0 }]);
  assert.ok(Math.abs(fit.b) < 1e-9);
  assert.ok(fit.r2 < 1e-9);
});

// ── expectedSvPerBooster: read the fit at an age, floored at 0 ──
test('expectedSvPerBooster reads the fit line at an age', () => {
  const fit = { a: 100, b: -10, r2: 1 };
  assert.equal(expectedSvPerBooster(fit, 3), 70); // 100 − 10·3
});

test('expectedSvPerBooster floors a negative extrapolation at 0', () => {
  const fit = { a: 100, b: -10, r2: 1 };
  assert.equal(expectedSvPerBooster(fit, 20), 0); // 100 − 200 → 0
});

test('expectedSvPerBooster is null without a fit', () => {
  assert.equal(expectedSvPerBooster(null, 3), null);
});

// ── fairPrice: invert the fit to a euro price + signed gap ──────
test('fairPrice inverts the fit: setVal × boosters ÷ expected SV/Booster', () => {
  // Expected SV/Booster of 72 for a box worth 720 set value → fair €360.
  const fit = { a: 72, b: 0, r2: 1 };
  const fp = fairPrice({ age: 4, setVal: 720, boosters: 36, price: 360 }, fit);
  assert.equal(fp.expected, 72);
  assert.equal(fp.fair, 360);      // 720 × 36 ÷ 72
  assert.equal(fp.gapPct, 0);      // priced exactly at fair
});

test('fairPrice reports a negative gap when priced under fair (a deal)', () => {
  const fit = { a: 72, b: 0, r2: 1 };
  const fp = fairPrice({ age: 4, setVal: 720, boosters: 36, price: 288 }, fit);
  assert.equal(fp.fair, 360);
  assert.equal(fp.gapPct, -20); // (288 − 360) / 360 → 20% under fair
});

test('fairPrice reports a positive gap when priced over fair', () => {
  const fit = { a: 72, b: 0, r2: 1 };
  const fp = fairPrice({ age: 4, setVal: 720, boosters: 36, price: 450 }, fit);
  assert.equal(fp.gapPct, 25); // (450 − 360) / 360 → 25% over fair
});

test('fairPrice is null when the expected value is non-positive', () => {
  const fit = { a: 0, b: -1, r2: 1 }; // expected floored to 0 at any positive age
  assert.equal(fairPrice({ age: 4, setVal: 720, boosters: 36, price: 360 }, fit), null);
});

test('fairPrice is null without a fit or when inputs are missing', () => {
  assert.equal(fairPrice({ age: 4, setVal: 720, boosters: 36, price: 360 }, null), null);
  const fit = { a: 72, b: 0, r2: 1 };
  assert.equal(fairPrice({ age: 4, setVal: null, boosters: 36, price: 360 }, fit), null);
  assert.equal(fairPrice({ age: 4, setVal: 720, boosters: null, price: 360 }, fit), null);
});

test('FAIR_PRICE_MIN_R2 is a sensible 0–1 confidence threshold', () => {
  assert.ok(FAIR_PRICE_MIN_R2 > 0 && FAIR_PRICE_MIN_R2 < 1);
});

// ── verdict: synthesise fair gap + drawdown + set-value trend ───
test('verdict flags a clear deal as under fair price', () => {
  const v = verdict({ fairGap: -20, drawdown: -5, svTrend: 0, fairTrusted: true });
  assert.equal(v.label, 'Under fair price');
  assert.equal(v.tone, 'good');
  assert.equal(v.rank, 0);
});

test('verdict appends "near tracked low" to a deal deep off its peak', () => {
  const v = verdict({ fairGap: -20, drawdown: -30, svTrend: 0, fairTrusted: true });
  assert.equal(v.label, 'Under fair price · near tracked low');
  assert.equal(v.tone, 'good');
});

test('verdict calls a fairly-priced product no edge', () => {
  const v = verdict({ fairGap: 0, drawdown: -2, svTrend: 1, fairTrusted: true });
  assert.equal(v.label, 'Fair — no edge');
  assert.equal(v.tone, 'neutral');
  assert.equal(v.rank, 2);
});

test('verdict flags an expensive product, and notes an eroding set value', () => {
  const plain = verdict({ fairGap: 6, drawdown: -1, svTrend: 0, fairTrusted: true });
  assert.equal(plain.label, 'Over fair price');
  assert.equal(plain.tone, 'bad');
  const eroding = verdict({ fairGap: 15, drawdown: -1, svTrend: -12, fairTrusted: true });
  assert.equal(eroding.label, 'Overpriced for age · set value falling');
  assert.equal(eroding.tone, 'bad');
  assert.equal(eroding.rank, 4);
});

test('verdict ranks best deal → worst monotonically', () => {
  const ranks = [-20, -5, 0, 6, 15].map(g =>
    verdict({ fairGap: g, drawdown: 0, svTrend: 0, fairTrusted: true }).rank);
  for (let i = 1; i < ranks.length; i++) assert.ok(ranks[i] > ranks[i - 1]);
});

test('verdict stays neutral and drops the fair claim when the fit is weak', () => {
  const nearLow = verdict({ fairGap: -20, drawdown: -30, svTrend: 0, fairTrusted: false });
  assert.equal(nearLow.label, 'Near tracked low');
  assert.equal(nearLow.tone, 'neutral');
  const flat = verdict({ fairGap: -20, drawdown: -1, svTrend: 0, fairTrusted: false });
  assert.equal(flat.label, 'No clear edge');
  assert.equal(flat.tone, 'neutral');
});

test('verdict falls back to momentum when there is no fair gap', () => {
  const v = verdict({ fairGap: null, drawdown: -2, svTrend: -20, fairTrusted: true });
  assert.equal(v.label, 'Set value slipping');
  assert.equal(v.tone, 'neutral');
});

test('VERDICT thresholds are ordered under < 0 < over', () => {
  assert.ok(VERDICT.UNDER_STRONG < VERDICT.UNDER_SOFT);
  assert.ok(VERDICT.UNDER_SOFT < 0 && 0 < VERDICT.OVER_SOFT);
  assert.ok(VERDICT.OVER_SOFT < VERDICT.OVER_STRONG);
});

// ── setLabel: name a set from its members' common prefix ────────
test('setLabel strips the product-type suffix from a common prefix', () => {
  assert.equal(setLabel(['Surging Sparks Booster Box', 'Surging Sparks Elite Trainer Box']), 'Surging Sparks');
  assert.equal(setLabel(['Prismatic Evolutions Booster Bundle']), 'Prismatic Evolutions');
});

test('setLabel falls back to the first name when members share too little', () => {
  assert.equal(setLabel(['Ab', 'Xy']), 'Ab');
  assert.equal(setLabel([]), 'New release');
});

// ── groupSets: group products by release, newest first ──────────
test('groupSets groups by release date and names each set', () => {
  const products = [
    { name: 'Surging Sparks Booster Box', type: 'BOX', release: '2024-11-08' },
    { name: 'Surging Sparks Elite Trainer Box', type: 'ETB', release: '2024-11-08' },
    { name: 'Prismatic Evolutions Booster Box', type: 'BOX', release: '2025-01-17' },
  ];
  const sets = groupSets(products);
  assert.equal(sets.length, 2);
  // newest release first
  assert.equal(sets[0].label, 'Prismatic Evolutions');
  assert.equal(sets[1].label, 'Surging Sparks');
  assert.deepEqual(sets[1].members, ['Surging Sparks Booster Box', 'Surging Sparks Elite Trainer Box']);
});

test('groupSets over a type-filtered pool rolls a set up from members in scope', () => {
  // Passing only ETBs mimics the global "ETB only" filter: the BOX-only set drops out.
  const etbsOnly = [
    { name: 'Surging Sparks Elite Trainer Box', type: 'ETB', release: '2024-11-08' },
  ];
  const sets = groupSets(etbsOnly);
  assert.equal(sets.length, 1);
  assert.deepEqual(sets[0].members, ['Surging Sparks Elite Trainer Box']);
});

// ── meanSeries: snapshot-aligned mean with gap preservation ─────
test('meanSeries averages non-null values per index', () => {
  assert.deepEqual(meanSeries([[10, 20, 30], [20, 40, 60]]), [15, 30, 45]);
});

test('meanSeries ignores nulls but keeps a genuine all-null gap', () => {
  // index 1: only the second series has a value → that value; index 2: both null → null
  assert.deepEqual(meanSeries([[10, null, null], [30, 50, null]]), [20, 50, null]);
});

test('meanSeries handles a single input and empty input', () => {
  assert.deepEqual(meanSeries([[4, 8]]), [4, 8]);
  assert.deepEqual(meanSeries([]), []);
});

// ── concentrationShares: portfolio spread per bucket ────────────
test('concentrationShares aggregates by bucket and computes value shares', () => {
  const rows = [
    { bucket: 'A', value: 60, cost: 50 },
    { bucket: 'A', value: 20, cost: 10 },
    { bucket: 'B', value: 20, cost: 20 },
  ];
  const { totalValue, totalCost, buckets } = concentrationShares(rows);
  assert.equal(totalValue, 100);
  assert.equal(totalCost, 80);
  assert.equal(buckets[0].bucket, 'A');      // sorted by value desc
  assert.equal(buckets[0].value, 80);
  assert.equal(buckets[0].valueShare, 0.8);
  assert.equal(buckets[0].over, true);       // 0.8 ≥ 0.4
  assert.equal(buckets[1].bucket, 'B');
  assert.equal(buckets[1].valueShare, 0.2);
  assert.equal(buckets[1].over, false);
});

test('concentrationShares never divides by zero on an empty/zero portfolio', () => {
  const empty = concentrationShares([]);
  assert.equal(empty.totalValue, 0);
  assert.deepEqual(empty.buckets, []);
  const zero = concentrationShares([{ bucket: 'X', value: 0, cost: 0 }]);
  assert.equal(zero.buckets[0].valueShare, 0);
  assert.equal(zero.buckets[0].over, false);
});

test('OVER_EXPOSED_SHARE is the 40% concentration threshold', () => {
  assert.equal(OVER_EXPOSED_SHARE, 0.4);
  const { buckets } = concentrationShares([
    { bucket: 'A', value: 40, cost: 40 },
    { bucket: 'B', value: 60, cost: 60 },
  ]);
  assert.equal(buckets.find(b => b.bucket === 'A').over, true);  // exactly 0.4 → over
});

// ── rebalanceSuggestions: fair-price-aware diversifiers ─────────
test('rebalanceSuggestions ranks under-fair-price diversifiers, unheld sets first', () => {
  const products = [
    { name: 'Held deal',  type: 'BOX', setKey: 's1', fairGap: -20, fairTrusted: true },
    { name: 'New deal',   type: 'ETB', setKey: 's2', fairGap: -10, fairTrusted: true },
    { name: 'Over set',   type: 'BOX', setKey: 's3', fairGap: -30, fairTrusted: true },
    { name: 'Not a deal', type: 'ETB', setKey: 's4', fairGap:   5, fairTrusted: true },
    { name: 'Weak fit',   type: 'ETB', setKey: 's5', fairGap: -40, fairTrusted: false },
  ];
  const out = rebalanceSuggestions(products, {
    overSets: new Set(['s3']), overTypes: new Set(), heldSets: new Set(['s1']),
  });
  // unheld 'New deal' outranks held 'Held deal'; over-exposed set, non-deal and
  // weak-fit products are all excluded.
  assert.deepEqual(out.map(o => o.name), ['New deal', 'Held deal']);
  assert.equal(out[0].newSet, true);
  assert.equal(out[1].newSet, false);
});

test('rebalanceSuggestions excludes over-exposed types and honours the limit', () => {
  const products = [
    { name: 'A', type: 'BOX', setKey: 'a', fairGap: -10, fairTrusted: true },
    { name: 'B', type: 'ETB', setKey: 'b', fairGap: -20, fairTrusted: true },
    { name: 'C', type: 'BOX', setKey: 'c', fairGap: -30, fairTrusted: true },
  ];
  const excl = rebalanceSuggestions(products, { overTypes: new Set(['ETB']) });
  assert.deepEqual(excl.map(o => o.name).sort(), ['A', 'C']); // ETB 'B' gone
  const limited = rebalanceSuggestions(products, { limit: 1 });
  assert.equal(limited.length, 1);
});

// ── portfolioValueSeries: total holdings value across snapshots ──
test('portfolioValueSeries sums qty×price per snapshot, carry-filling gaps', () => {
  const holdings = { A: { quantity: 2 }, B: { quantity: 1 } };
  const hist = {
    A: { price: [10, null, 20], setVal: [] },
    B: { price: [null, 5, 6],  setVal: [] },
  };
  // A carry-fills to [10,10,20]; B back-fills the leading gap to [5,5,6].
  // i0: 2·10 + 1·5 = 25; i1: 2·10 + 1·5 = 25; i2: 2·20 + 1·6 = 46
  assert.deepEqual(portfolioValueSeries(holdings, hist, 3), [25, 25, 46]);
});

test('portfolioValueSeries returns [] when nothing is valuable', () => {
  assert.deepEqual(portfolioValueSeries({}, {}, 3), []);
  assert.deepEqual(portfolioValueSeries({ A: { quantity: 0 } }, { A: { price: [1] } }, 1), []);
  assert.deepEqual(portfolioValueSeries({ A: { quantity: 1 } }, { A: { price: [null] } }, 1), []);
});
