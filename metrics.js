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
