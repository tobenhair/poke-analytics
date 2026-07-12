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
