// ============================================================
// metrics.js — the analytical core, as pure functions
// ============================================================
// Booster constants and the scoring/derivation math live here as the single
// source of truth, shared by index.html (loaded as an ES module) and the unit
// tests (tests/metrics.test.mjs). Keeping them in one importable file is what
// stops the browser and the tests from drifting.
//
// Every function is pure: no DOM, no module-global app state (`products`,
// `ageThreshold`). Each dependency is a parameter, so a test can call them
// directly and index.html passes its live state in at the call site.
//
// The fixed definitions (see .claude/skills/metrics-review):
//   Boosters per type   BOX = 36, ETB = 9, BUNDLE = 6
//   Price / Booster     price ÷ boosters
//   SV / Booster        Set Value ÷ (Price / Booster) — threshold-independent
//   Age Weight          calcAgeWeight(age, threshold) — 0–1 youth penalty
//   Wtd. Score          SV / Booster × Age Weight — the primary ranking metric

export function boostersFromType(type) {
  if (type === 'BOX')    return 36;
  if (type === 'ETB')    return 9;
  if (type === 'BUNDLE') return 6;
  return null;
}

// 0–1 penalty for products younger than `ageThreshold` years:
//   age >= threshold → full weight (no penalty)
//   age <  threshold → linear scale from 0.10 to 1.0
export function calcAgeWeight(ageYears, ageThreshold) {
  if (ageYears >= ageThreshold) return 1.0;
  return parseFloat(Math.max(0.10, ageYears / ageThreshold).toFixed(2));
}

// Recompute each product's threshold-dependent ageWeight and score in place
// from the current ageThreshold. MUST run before the first render (see the
// ordering invariant in the metrics-review skill). svPerBooster is
// threshold-independent and is deliberately left untouched here.
export function recomputeScores(products, ageThreshold) {
  products.forEach(p => {
    p.ageWeight = calcAgeWeight(p.age, ageThreshold);
    p.score     = parseFloat((p.svPerBooster * p.ageWeight).toFixed(1));
  });
}

// ── Derive calculated product fields from raw inputs + latest snapshot ──
// Shared by the .xlsx parser and the Supabase loader so both paths compute
// price/age/pricePerBooster/svPerBooster/score identically. Mutates each
// product in place; returns an array of error strings for products missing a
// usable latest Price or Set Value (the caller decides whether to reject or
// skip them). The ageWeight/score written here are provisional — using a fixed
// 3-year threshold — because recomputeScores() overwrites them with the current
// ageThreshold before the first render.
// ── Age-fit line: least-squares SV/Booster as a function of age ──
// Ordinary least-squares regression of y (SV/Booster) on x (age in years).
// Returns { a, b, r2 } — intercept, slope, and coefficient of determination —
// or null when there are fewer than two points or the ages don't vary (a
// vertical fit is undefined). r2 (0–1, higher = tighter) is the honest
// confidence signal for how much to trust anything derived from the fit,
// including the fair price below.
export function linearFit(pts) {
  const n = pts.length;
  if (n < 2) return null;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  pts.forEach(p => { sx += p.x; sy += p.y; sxx += p.x * p.x; sxy += p.x * p.y; });
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return null;
  const b = (n * sxy - sx * sy) / denom;
  const a = (sy - b * sx) / n;
  // R² = 1 − SSres / SStot. SStot 0 (all y equal) → a flat line fits perfectly.
  const meanY = sy / n;
  let ssRes = 0, ssTot = 0;
  pts.forEach(p => {
    const yhat = a + b * p.x;
    ssRes += (p.y - yhat) ** 2;
    ssTot += (p.y - meanY) ** 2;
  });
  const r2 = ssTot < 1e-9 ? 1 : Math.max(0, 1 - ssRes / ssTot);
  return { a, b, r2 };
}

// Below this fit quality (R²) the fair price is too speculative to lean on —
// the UI still shows it, but greyed, and flags the low confidence.
export const FAIR_PRICE_MIN_R2 = 0.25;

// Expected SV/Booster for a product of a given age, read off the age-fit line.
// Floored at 0: a linear fit extrapolates below zero for the oldest products,
// which is not a meaningful expectation. Returns null without a fit.
export function expectedSvPerBooster(fit, age) {
  if (!fit) return null;
  return Math.max(0, fit.a + fit.b * age);
}

// ── Fair price in euros, by inverting the age-fit line ──
// The fit predicts the SV/Booster a product of this age "should" trade at.
// Since  svPerBooster = setVal × boosters ÷ price, that expected value implies
// a concrete fair price:  fairPrice = setVal × boosters ÷ expectedSvPerBooster.
// A live price above fair is expensive for the product's age; below fair, cheap.
// Returns { fair, expected, gapPct } — gapPct is the signed gap of the live
// price vs fair (negative = under fair = a better deal) — or null when it can't
// be computed (no fit, missing inputs, or a non-positive expectation that would
// divide to a meaningless/Infinite price).
export function fairPrice(product, fit) {
  const expected = expectedSvPerBooster(fit, product.age);
  if (expected == null || expected <= 0) return null;
  if (product.setVal == null || !product.boosters) return null;
  const fair = (product.setVal * product.boosters) / expected;
  if (!isFinite(fair) || fair <= 0) return null;
  const gapPct = product.price != null && product.price > 0
    ? ((product.price - fair) / fair) * 100
    : null;
  return { fair, expected, gapPct };
}

// ── The Board verdict: one plain-language state per product ──
// Synthesises the three signals a buyer cross-references by hand into a single
// text-first verdict: the gap to fair price (primary), the drawdown vs the
// tracked peak, and the set-value trend. Pure — the caller gathers the signals
// (fair gap from fairPrice(), drawdown/svTrend from the tracked history) and
// passes them in. Returns { label, tone, rank } where tone ∈ good|bad|neutral
// (a non-colour cue lives in the label itself) and rank orders best deal → worst
// for sorting (lower = better). fairTrusted gates the fair-price claim: when the
// age fit is weak the verdict leans on drawdown/trend only and stays neutral.
//
// Signal thresholds (percentages):
export const VERDICT = {
  UNDER_STRONG: -10, // ≤ this % vs fair → clearly under fair (a deal)
  UNDER_SOFT:    -3, // ≤ this → slightly under fair
  OVER_SOFT:      3, // ≥ this → over fair
  OVER_STRONG:   10, // ≥ this → overpriced
  NEAR_LOW:     -15, // drawdown ≤ this (≥15% off peak) → near tracked low
  SV_MOVE:        5, // |set-value trend| ≥ this → rising / falling
};

export function verdict({ fairGap, drawdown, svTrend, fairTrusted }) {
  const nearLow  = drawdown != null && drawdown <= VERDICT.NEAR_LOW;
  const svRising = svTrend  != null && svTrend  >=  VERDICT.SV_MOVE;
  const svFalling= svTrend  != null && svTrend  <= -VERDICT.SV_MOVE;

  // Without a trustworthy fair-price anchor, don't assert cheap/expensive —
  // fall back to the momentum signals and stay neutral.
  if (!fairTrusted || fairGap == null) {
    if (nearLow)   return { label: 'Near tracked low', tone: 'neutral', rank: 2.3 };
    if (svFalling) return { label: 'Set value slipping', tone: 'neutral', rank: 2.7 };
    if (svRising)  return { label: 'Set value climbing', tone: 'neutral', rank: 2.4 };
    return { label: 'No clear edge', tone: 'neutral', rank: 2.5 };
  }

  // Primary state from the gap to fair price.
  let label, tone, rank;
  if (fairGap <= VERDICT.UNDER_STRONG)      { label = 'Under fair price';    tone = 'good';    rank = 0; }
  else if (fairGap <= VERDICT.UNDER_SOFT)   { label = 'Slightly under fair'; tone = 'good';    rank = 1; }
  else if (fairGap <  VERDICT.OVER_SOFT)    { label = 'Fair — no edge';      tone = 'neutral'; rank = 2; }
  else if (fairGap <  VERDICT.OVER_STRONG)  { label = 'Over fair price';     tone = 'bad';     rank = 3; }
  else                                      { label = 'Overpriced for age';  tone = 'bad';     rank = 4; }

  // One reinforcing clause: for a deal, flag when it's also near its low; for an
  // overpriced product, flag a falling set value (the value is eroding too).
  let clause = '';
  if (tone === 'good' && nearLow)       clause = 'near tracked low';
  else if (tone === 'bad' && svFalling) clause = 'set value falling';
  else if (tone === 'neutral' && nearLow) clause = 'near tracked low';

  return { label: clause ? `${label} · ${clause}` : label, tone, rank };
}

// ── Set identity & roll-up helpers (the expanded comparison views) ──
// A "set" is every product sharing a release date; there is no explicit set
// field. These pure helpers let the §06/§08 comparison charts roll products up
// to set level, and are the single source of truth for set naming (index.html's
// demoSetName delegates here) so the demo grouping and the comparison views can
// never disagree.

// The display name for a set: the longest common prefix of its members' names
// with a trailing product-type suffix stripped, e.g.
// ["Surging Sparks Booster Box", "Surging Sparks ETB"] → "Surging Sparks".
// Falls back to the first name when the members share too little to name a set.
export function setLabel(names) {
  if (!names.length) return 'New release';
  let pfx = names[0];
  for (const n of names.slice(1)) {
    let i = 0;
    while (i < pfx.length && i < n.length && pfx[i] === n[i]) i++;
    pfx = pfx.slice(0, i);
  }
  pfx = pfx.replace(/\s*[-–—]\s*$/, '').trim();
  const stripped = pfx.replace(/\s+(Elite Trainer Box|Booster Box|Booster Bundle|Bundle|ETB)$/i, '').trim();
  if (stripped.length >= 3) return stripped;
  if (pfx.length >= 3) return pfx;
  return names[0] || 'New release';
}

// Group products into sets by shared release date. Returns
// [{ release, label, members: [name…] }, …] sorted newest release first.
// Call it on the *already type-filtered* product pool so "ETB only" rolls a set
// up from its ETB members alone (and drops sets with no member in scope).
export function groupSets(products) {
  const byRelease = new Map();
  products.forEach(p => {
    if (!byRelease.has(p.release)) byRelease.set(p.release, []);
    byRelease.get(p.release).push(p.name);
  });
  const sets = [];
  for (const [release, members] of byRelease) {
    sets.push({ release, label: setLabel(members), members });
  }
  sets.sort((a, b) => (a.release < b.release ? 1 : a.release > b.release ? -1 : 0));
  return sets;
}

// Aggregate several snapshot-aligned series (same shared date axis) into one
// mean series: at each index the mean of the non-null values across inputs, or
// null when every input is null there (a genuine gap the chart should span).
// Rolls a set's member products up into one comparison line. Rounded to 2dp to
// match the per-product series the charts already plot.
export function meanSeries(seriesList) {
  const len = seriesList.reduce((m, s) => Math.max(m, s.length), 0);
  const out = [];
  for (let i = 0; i < len; i++) {
    let sum = 0, n = 0;
    for (const s of seriesList) {
      const v = s[i];
      if (v != null && isFinite(v)) { sum += v; n++; }
    }
    out.push(n ? parseFloat((sum / n).toFixed(2)) : null);
  }
  return out;
}

export function deriveProducts(newProducts, newHistoricalData) {
  const derivationErrors = [];
  const today = new Date();
  newProducts.forEach(p => {
    const hist     = newHistoricalData[p.name];
    const boosters = boostersFromType(p.type);

    // Latest non-null price and setVal from historical data
    const latestPrice  = hist ? [...hist.price].reverse().find(v => v != null)  : null;
    const latestSetVal = hist ? [...hist.setVal].reverse().find(v => v != null) : null;

    if (latestPrice  == null) derivationErrors.push(`"${p.name}": no valid Price found in Historical Data`);
    if (latestSetVal == null) derivationErrors.push(`"${p.name}": no valid Set Value found in Historical Data`);

    if (latestPrice != null && latestSetVal != null && boosters) {
      const releaseDate = new Date(p.release);
      const ageYears    = parseFloat(((today - releaseDate) / (1000 * 60 * 60 * 24 * 365.25)).toFixed(2));
      const ageWeight   = parseFloat((ageYears >= 3 ? 1.0 : Math.max(0.10, ageYears / 3)).toFixed(2));
      const pricePerBooster = latestPrice / boosters;
      const svPerBooster    = latestSetVal / pricePerBooster;
      const score           = parseFloat((svPerBooster * ageWeight).toFixed(1));

      p.boosters        = boosters;
      p.age             = ageYears;
      p.price           = latestPrice;
      p.setVal          = latestSetVal;
      p.pricePerBooster = parseFloat(pricePerBooster.toFixed(1));
      p.svPerBooster    = parseFloat(svPerBooster.toFixed(1));
      p.ageWeight       = ageWeight;
      p.score           = score;
    }
  });
  return derivationErrors;
}

// ── Portfolio balancer: concentration & fair-price-aware rebalancing ──
// Pure helpers for the signed-in Portfolio tab. The caller enriches its holdings
// with each product's set/era/type and fair-price gap and passes plain rows in;
// nothing here touches the DOM or app globals.

// ≥ this share of portfolio value sitting in a single bucket → a concentration
// flag ("X% of your value rides on one set"). 40% is deliberately conservative:
// below it a single set's crash can't sink the whole position.
export const OVER_EXPOSED_SHARE = 0.4;

// Sum value & cost per bucket and each bucket's share of the totals.
// rows: [{ bucket, value, cost }] (one per holding). Returns
// { totalValue, totalCost, buckets: [{ bucket, value, cost, valueShare, costShare, over }] }
// sorted by value desc; `over` flags buckets at/above OVER_EXPOSED_SHARE of value.
// Shares are 0 (not NaN) for an empty or zero-value portfolio.
export function concentrationShares(rows) {
  const map = new Map();
  let totalValue = 0, totalCost = 0;
  for (const r of rows) {
    const v = Number(r.value) || 0, c = Number(r.cost) || 0;
    totalValue += v; totalCost += c;
    const b = map.get(r.bucket) || { bucket: r.bucket, value: 0, cost: 0 };
    b.value += v; b.cost += c;
    map.set(r.bucket, b);
  }
  const buckets = [...map.values()].map(b => ({
    bucket: b.bucket,
    value: b.value,
    cost: b.cost,
    valueShare: totalValue > 0 ? b.value / totalValue : 0,
    costShare:  totalCost  > 0 ? b.cost  / totalCost  : 0,
    over: totalValue > 0 && b.value / totalValue >= OVER_EXPOSED_SHARE,
  }));
  buckets.sort((a, b) => b.value - a.value);
  return { totalValue, totalCost, buckets };
}

// Rank rebalance buys: products under fair price that diversify the position.
// products: [{ name, type, setKey, fairGap, fairTrusted }]. `opts`:
//   overSets/overTypes — Sets of bucket keys flagged over-exposed (excluded, as
//     buying into them wouldn't rebalance);
//   heldSets — Set of set keys already held (unheld sets rank first);
//   limit — max suggestions (default 5).
// Only trusted, under-fair-price (gap ≤ VERDICT.UNDER_SOFT) products qualify;
// results are sorted new-set-first, then best deal (most negative gap).
export function rebalanceSuggestions(products, opts = {}) {
  const overSets  = opts.overSets  || new Set();
  const overTypes = opts.overTypes || new Set();
  const heldSets  = opts.heldSets  || new Set();
  const limit     = opts.limit != null ? opts.limit : 5;
  return products
    .filter(p => p.fairTrusted && p.fairGap != null && p.fairGap <= VERDICT.UNDER_SOFT)
    .filter(p => !overSets.has(p.setKey) && !overTypes.has(p.type))
    .map(p => ({ ...p, newSet: !heldSets.has(p.setKey) }))
    .sort((a, b) => (a.newSet !== b.newSet ? (a.newSet ? -1 : 1) : a.fairGap - b.fairGap))
    .slice(0, limit);
}

// ── Portfolio value over time (the change chart) ──
// Total € value of the given holdings at each snapshot date: each holding valued
// at qty × its tracked price, with gaps carry-filled from the nearest known
// price (forward, then backward for leading gaps) so the line is continuous
// rather than dropping to zero on a missing snapshot. Values the *current*
// basket back across history (acquisition dates aren't tracked). holdings:
// { name: { quantity } }; historicalData: { name: { price: [...] } } aligned to
// the shared date axis. Returns number[] of length dateCount, or [] when nothing
// is valuable. Display-only currency conversion happens in the caller; € here.
function carryFill(arr, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(arr && arr[i] != null ? arr[i] : null);
  let last = null;
  for (let i = 0; i < n; i++) { if (out[i] != null) last = out[i]; else if (last != null) out[i] = last; }
  let next = null;
  for (let i = n - 1; i >= 0; i--) { if (out[i] != null) next = out[i]; else if (next != null) out[i] = next; }
  return out;
}

export function portfolioValueSeries(holdings, historicalData, dateCount) {
  const totals = new Array(dateCount).fill(0);
  let any = false;
  for (const [name, h] of Object.entries(holdings || {})) {
    const qty  = Number(h && h.quantity) || 0;
    const hist = historicalData ? historicalData[name] : null;
    if (!qty || !hist || !hist.price) continue;
    const filled = carryFill(hist.price, dateCount);
    for (let i = 0; i < dateCount; i++) {
      if (filled[i] != null) { totals[i] += filled[i] * qty; any = true; }
    }
  }
  return any ? totals : [];
}
