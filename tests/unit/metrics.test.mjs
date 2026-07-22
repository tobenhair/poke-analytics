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
  fairAlertTarget,
  FAIR_PRICE_MIN_R2,
  momentum,
  trendDirection,
  buySignal,
  BUY_SIGNAL_PRICE_DROP,
  BUY_SIGNAL_SV_HOLD,
  peerResiduals,
  scenarioOutcome,
  SCENARIO_SIGNAL,
  snapshotGaps,
  SNAPSHOT_GAP_DAYS,
  typeOutliers,
  TYPE_OUTLIER_RATIO,
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

// ── momentum: Δ last / since-first / SV trend / drawdown ─────────
// Two of these (drawdown, svSinceFirst) are Board-verdict ingredients, so this
// math being right is part of the verdict being right.
test('momentum computes last, since-first, SV trend and drawdown', () => {
  const m = momentum({ price: [100, 120, 90], setVal: [200, 210, 220] });
  assert.equal(m.price, 90);
  assert.equal(m.last, -25);                       // 120 → 90
  assert.equal(m.sinceFirst, -10);                 // 100 → 90
  assert.equal(m.svSinceFirst, 10);                // 200 → 220
  assert.equal(m.drawdown, -25);                   // peak 120 → 90
});

test('momentum ignores null gaps — only tracked values count', () => {
  const m = momentum({ price: [null, 100, null, 110], setVal: [null, 50, null, null] });
  assert.equal(m.last, 10);                        // 100 → 110, nulls skipped
  assert.equal(m.sinceFirst, 10);
  assert.equal(m.svSinceFirst, null);              // only one tracked set value
  assert.equal(m.drawdown, 0);                     // at the tracked peak
});

test('momentum is null without at least two tracked prices', () => {
  assert.equal(momentum(null), null);
  assert.equal(momentum({ price: [100], setVal: [1, 2] }), null);
  assert.equal(momentum({ price: [null, null], setVal: [] }), null);
});

test('momentum drawdown is 0 at the peak and negative below it', () => {
  assert.equal(momentum({ price: [80, 100], setVal: [] }).drawdown, 0);
  assert.equal(momentum({ price: [100, 75], setVal: [] }).drawdown, -25);
});

// ── trendDirection: the board's ▲/▼ arrow ────────────────────────
test('trendDirection reports the sign of the latest tracked move', () => {
  assert.equal(trendDirection([100, 110]), 1);
  assert.equal(trendDirection([110, 100]), -1);
  assert.equal(trendDirection([100, 100]), 0);
  assert.equal(trendDirection([100, 110, null]), 1); // trailing gap ignored
});

test('trendDirection is 0 with fewer than two tracked prices', () => {
  assert.equal(trendDirection([]), 0);
  assert.equal(trendDirection([100]), 0);
  assert.equal(trendDirection([null, 100, null]), 0);
});

// ── buySignal: price dropped, set value held ─────────────────────
test('buySignal fires when price drops ≥5% while set value holds', () => {
  assert.equal(buySignal({ price: [100, 90], setVal: [500, 500] }), true);   // −10% / 0%
  assert.equal(buySignal({ price: [100, 95], setVal: [500, 480] }), true);   // −5% / −4%
});

test('buySignal stays quiet on a small dip or an eroding set value', () => {
  assert.equal(buySignal({ price: [100, 97], setVal: [500, 500] }), false);  // −3%: not a real drop
  assert.equal(buySignal({ price: [100, 90], setVal: [500, 450] }), false);  // SV fell 10% too
  assert.equal(buySignal({ price: [100, 110], setVal: [500, 500] }), false); // price rose
});

test('buySignal needs two tracked points on both series', () => {
  assert.equal(buySignal(null), false);
  assert.equal(buySignal({ price: [100, 90], setVal: [500] }), false);
  assert.equal(buySignal({ price: [90], setVal: [500, 500] }), false);
});

test('BUY_SIGNAL thresholds are the documented −5% / −5%', () => {
  assert.equal(BUY_SIGNAL_PRICE_DROP, -5);
  assert.equal(BUY_SIGNAL_SV_HOLD, -5);
});

// ── peerResiduals: actual SV/Booster vs the age-fit expectation ──
test('peerResiduals ranks by residual, best first', () => {
  // Fit line: expected = 10 + 2·age
  const fit = { a: 10, b: 2, r2: 1 };
  const rows = peerResiduals([
    { name: 'A', type: 'BOX', age: 5, svPerBooster: 15 },  // expected 20 → −5
    { name: 'B', type: 'ETB', age: 1, svPerBooster: 20 },  // expected 12 → +8
  ], fit);
  assert.deepEqual(rows.map(r => r.name), ['B', 'A']);
  assert.equal(rows[0].expected, 12);
  assert.equal(rows[0].residual, 8);
  assert.equal(rows[1].residual, -5);
});

test('peerResiduals floors a negative extrapolated expectation at 0', () => {
  // Steeply falling fit: expected would be negative for an old product.
  const fit = { a: 10, b: -3, r2: 1 };
  const [row] = peerResiduals([{ name: 'Old', type: 'BOX', age: 6, svPerBooster: 4 }], fit);
  assert.equal(row.expected, 0);
  assert.equal(row.residual, 4);
});

test('peerResiduals without a fit defaults every expectation to the product itself', () => {
  const rows = peerResiduals([{ name: 'A', type: 'BOX', age: 2, svPerBooster: 50 }], null);
  assert.equal(rows[0].expected, 50);
  assert.equal(rows[0].residual, 0);
});

// ── scenarioOutcome: the §09 what-if recomputation ───────────────
test('scenarioOutcome applies the deriveProducts formulas to slider values', () => {
  const p = { type: 'BOX', boosters: 36, ageWeight: 0.5, svPerBooster: 100, price: 360, setVal: 1000 };
  // priceVal 720, svVal 1000: ppb = 20, svb = 50, score = 25
  const out = scenarioOutcome(p, 1000, 720);
  assert.equal(out.svPerBooster, 50);
  assert.equal(out.score, 25);
  assert.equal(out.svbDelta, -50);
});

test('scenarioOutcome falls back to the type constant when boosters is unset', () => {
  // The hardcoded fallback products carry no `boosters` field.
  const p = { type: 'ETB', ageWeight: 1, svPerBooster: 10, score: 10 };
  const out = scenarioOutcome(p, 90, 9);          // ppb = 1, svb = 90
  assert.equal(out.svPerBooster, 90);
});

test('scenarioOutcome buckets the score into the four signals', () => {
  const p = { type: 'BOX', boosters: 36, ageWeight: 1, svPerBooster: 0, score: 0 };
  const at = score => scenarioOutcome(p, score, 36).signal; // ppb=1 → svb=svVal=score
  assert.equal(at(SCENARIO_SIGNAL.STRONG_BUY), 'strong-buy');
  assert.equal(at(SCENARIO_SIGNAL.WATCH), 'watch');
  assert.equal(at(SCENARIO_SIGNAL.NEUTRAL), 'neutral');
  assert.equal(at(SCENARIO_SIGNAL.NEUTRAL - 1), 'avoid');
});

test('scenarioOutcome at price 0 has no signal and zero value density', () => {
  const p = { type: 'BOX', boosters: 36, ageWeight: 1, svPerBooster: 100, score: 100 };
  const out = scenarioOutcome(p, 1000, 0);
  assert.equal(out.signal, null);
  assert.equal(out.svPerBooster, 0);
  assert.equal(out.score, 0);
});

// ── fairAlertTarget: the % below fair alert threshold ────────────
test('fairAlertTarget is pct% below the fair price', () => {
  assert.equal(fairAlertTarget(100, 10), 90);
  assert.equal(fairAlertTarget(200, 0), 200);
});

test('fairAlertTarget is null when either input is missing', () => {
  assert.equal(fairAlertTarget(null, 10), null);
  assert.equal(fairAlertTarget(100, null), null);
});

// ── snapshotGaps: silently skipped months in the cadence ─────────
test('snapshotGaps flags consecutive dates further apart than the limit', () => {
  const gaps = snapshotGaps(['2026-01-15', '2026-02-14', '2026-04-20'], 45);
  assert.equal(gaps.length, 1);
  assert.deepEqual(gaps[0], { from: '2026-02-14', to: '2026-04-20', days: 65 });
});

test('snapshotGaps is empty when the monthly cadence held', () => {
  assert.deepEqual(snapshotGaps(['2026-01-18', '2026-02-23', '2026-03-20', '2026-04-20'], 45), []);
});

test('snapshotGaps sorts unordered input and ignores blanks', () => {
  const gaps = snapshotGaps(['2026-04-20', null, '2026-01-15', '2026-02-14'], 45);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].from, '2026-02-14');
});

test('snapshotGaps handles empty and single-date inputs', () => {
  assert.deepEqual(snapshotGaps([], 45), []);
  assert.deepEqual(snapshotGaps(['2026-01-01'], 45), []);
  assert.deepEqual(snapshotGaps(null, 45), []);
});

test('SNAPSHOT_GAP_DAYS allows a monthly cadence with slack', () => {
  assert.ok(SNAPSHOT_GAP_DAYS > 31 && SNAPSHOT_GAP_DAYS < 62);
});

// ── typeOutliers: same-set SV/Booster consistency ────────────────
// Products of one release share the same singles market, so a member whose
// SV/Booster is far off its siblings likely carries the wrong Type.
const setOf = (release, ...members) =>
  members.map(([name, type, svb]) => ({ name, type, release, svPerBooster: svb }));

test('typeOutliers flags a member far from its set siblings', () => {
  // An ETB mistyped as BOX reads 4× too low vs its two siblings.
  const products = setOf('2025-01-17',
    ['S ETB', 'ETB', 150], ['S Bundle', 'BUNDLE', 160], ['S Box', 'BOX', 38]);
  const out = typeOutliers(products, 2.5);
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'S Box');
  assert.equal(out[0].peerMedian, 155);
  assert.ok(out[0].factor < 1 / 2.5);
});

test('typeOutliers flags both sides of an inconsistent pair', () => {
  // With two members it cannot tell which is wrong — flag the pair.
  const out = typeOutliers(setOf('2025-01-17', ['A', 'ETB', 150], ['B', 'BOX', 37.5]), 2.5);
  assert.deepEqual(out.map(o => o.name).sort(), ['A', 'B']);
});

test('typeOutliers stays quiet on a consistent set and across sets', () => {
  // Within-set spread under the ratio; large *between*-set differences are fine.
  const products = [
    ...setOf('2025-01-17', ['P ETB', 'ETB', 132], ['P Bundle', 'BUNDLE', 185]),
    ...setOf('2019-02-01', ['Old Box', 'BOX', 32]),   // single-member set: no check
  ];
  assert.deepEqual(typeOutliers(products, 2.5), []);
});

test('typeOutliers ignores unscored members and sorts most extreme first', () => {
  const products = [
    ...setOf('2025-01-17', ['A', 'ETB', 100], ['B', 'BOX', 10], ['C', 'BUNDLE', 105]),
    ...setOf('2024-08-02', ['D', 'ETB', 100], ['E', 'BOX', 30], ['F', 'BUNDLE', 95]),
    { name: 'G', type: 'BOX', release: '2024-08-02', svPerBooster: null },
  ];
  const out = typeOutliers(products, 2.5);
  // B is 10× off its peers, E ~3.2× — B first.
  assert.deepEqual(out.map(o => o.name), ['B', 'E']);
});

test('typeOutliers does not flag the live catalogue pattern', () => {
  // Regression guard: the real multi-product sets (ETB vs Bundle in one
  // release) sit well inside the ratio and must never be flagged.
  const products = [
    ...setOf('2025-01-17', ['Prismatic ETB', 'ETB', 132.3], ['Prismatic Bundle', 'BUNDLE', 185.2]),
    ...setOf('2025-07-18', ['WF ETB', 'ETB', 168.5], ['WF Bundle', 'BUNDLE', 173.6],
                           ['BB ETB', 'ETB', 162.6], ['BB Bundle', 'BUNDLE', 158.4]),
    ...setOf('2026-01-30', ['AH ETB', 'ETB', 311.3], ['AH Bundle', 'BUNDLE', 337.2]),
  ];
  assert.deepEqual(typeOutliers(products, 2.5), []);
});
