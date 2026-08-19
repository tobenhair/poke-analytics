// ============================================================
// Cardmarket ingestion — shared pure core
// ============================================================
// The canonical fetch / name-match / derive logic, with NO Supabase, NO
// workbook, NO CLI. Callers (the scheduled ingest job, and — to be migrated —
// the read-only spike) pass data in and format output themselves, so the
// numbers can never drift between "what the spike showed" and "what the job
// writes". The math here is pinned by tests/unit/cardmarket-lib.test.mjs.
//
// Sources (idGame 6 = Pokémon), Cardmarket's published bulk catalogue files:
//   products_nonsingles_6.json  sealed products (name, category, ids)
//   products_singles_6.json     singles, grouped by expansion (for Set Value)
//   price_guide_6.json          daily EUR price per idProduct
// ============================================================

import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const MAP_PATH = join(ROOT, 'cardmarket-map.json');
const CACHE_DIR = join(ROOT, '.cardmarket-cache');
const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — the files refresh daily

export const ENDPOINTS = {
  nonsingles: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json',
  singles: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json',
  priceGuide: 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json',
};

// Field names are resolved through candidate lists so a spelling/localisation
// change is a one-line fix. Confirmed against the real files (Jul 2026):
// nonsingles → idProduct/name/categoryName/idExpansion; price guide →
// idProduct/avg/low/trend/avg1/avg7/avg30 (avg1/7/30 populated for SINGLES only).
export const FIELD_ALIASES = {
  id: ['idProduct', 'idProductLocalized', 'productId', 'id'],
  name: ['name', 'enName', 'productName', 'locName'],
  category: ['categoryName', 'category', 'idCategory'],
  expansion: ['idExpansion', 'expansionId', 'idExpansionLocalized'],
  price: ['trend', 'avg', 'avg7', 'avg30', 'low', 'll'], // fallback order when the chosen field is empty
};

export const readMap = () => JSON.parse(readFileSync(MAP_PATH, 'utf8'));

export const pick = (obj, aliases) => {
  for (const k of aliases) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  return null;
};

const numOrNull = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);

// Unwrap a bulk file into its array of records regardless of the wrapper key.
export const toRecords = (json) => {
  if (Array.isArray(json)) return { key: '(root array)', records: json };
  for (const [k, v] of Object.entries(json)) if (Array.isArray(v)) return { key: k, records: v };
  return { key: null, records: [] };
};

// Fetch a bulk file (cached 12h under .cardmarket-cache). `log` is stderr-style
// progress; pass a no-op to silence.
export async function loadFile(which, { refresh = false, log = () => {} } = {}) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, `${which}.json`);
  const fresh = existsSync(cachePath) && Date.now() - statSync(cachePath).mtimeMs < CACHE_TTL_MS;
  if (fresh && !refresh) return JSON.parse(readFileSync(cachePath, 'utf8'));
  log(`fetching ${which} … `);
  const res = await fetch(ENDPOINTS[which]);
  if (!res.ok) throw new Error(`${which}: HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  writeFileSync(cachePath, text);
  log(`${(text.length / 1e6).toFixed(1)} MB (cached)\n`);
  return JSON.parse(text);
}

// Normalise a product name for matching: lowercase, expand abbreviations, drop
// punctuation, singularise (so "Mega Evolutions" ↔ "Mega Evolution"), collapse
// whitespace. Applied to both sides, so exact names still score 1.0.
export const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\betb\b/g, 'elite trainer box')
    .replace(/\bbooster display\b/g, 'booster box')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b([a-z]{3,}?)s\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

const tokens = (s) => new Set(norm(s).split(' ').filter(Boolean));

// Jaccard token overlap — cheap, good enough to rank an obvious best match.
export const score = (a, b) => {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
};

// Resolve each tracked product to a Cardmarket idProduct/idExpansion by name.
// A map entry may pin the match with an explicit `idProduct` (exact) or a
// `nameHint` (match against a given string). Returns name → { idProduct,
// idExpansion, catalogueName, score, source, confident }.
export function resolveIds(map, nonsinglesRecords) {
  const cat = nonsinglesRecords.map((r) => ({
    id: pick(r, FIELD_ALIASES.id),
    name: pick(r, FIELD_ALIASES.name),
    category: pick(r, FIELD_ALIASES.category),
    expansion: pick(r, FIELD_ALIASES.expansion),
  }));
  const byId = new Map(cat.filter((c) => c.id != null).map((c) => [String(c.id), c]));
  const out = {};
  for (const [name, entry] of Object.entries(map.products)) {
    const query = entry.nameHint || name;
    let best = null;
    let bestScore = 0;
    for (const c of cat) {
      if (!c.name) continue;
      const sc = score(query, c.name);
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    let chosen;
    let chosenScore;
    let source;
    if (entry.idProduct != null && byId.has(String(entry.idProduct))) {
      chosen = byId.get(String(entry.idProduct));
      chosenScore = 1;
      source = 'pinned';
    } else {
      chosen = best;
      chosenScore = bestScore;
      source = 'match';
    }
    out[name] = {
      idProduct: chosen ? chosen.id : null,
      idExpansion: chosen ? chosen.expansion : null,
      catalogueName: chosen ? chosen.name : null,
      score: +chosenScore.toFixed(2),
      source,
      confident: source === 'pinned' || chosenScore >= 0.6,
    };
  }
  return out;
}

// Group single-card idProducts by their expansion id. This is the data the
// occasional catalog-sync precomputes and stores in Supabase
// (cardmarket_expansion_singles), so the daily Edge Function can sum Set Value
// without ever loading this large singles file itself. Returns
// Map(String(idExpansion) → number[] of single idProducts).
//
// `excludeIds` (a Set/array of idProducts, compared as strings) drops cards that
// Cardmarket tags to an expansion but that must never enter a Set Value — the
// promo Gengar (~€2,500) mis-tagged into Sword & Shield's base set that 5×'d it.
// Dropping them here (at cache-build time) is the durable cause-fix: a re-sync
// can't re-add them. The live list lives in public.cardmarket_excluded_singles;
// the offline path uses cardmarket-map.json's `excludeSingles`.
export function singlesByExpansion(singlesRecords, excludeIds = []) {
  const exclude = new Set([...(excludeIds || [])].map(String));
  const byExp = new Map();
  for (const r of singlesRecords) {
    const exp = pick(r, FIELD_ALIASES.expansion);
    const id = pick(r, FIELD_ALIASES.id);
    if (exp == null || id == null) continue;
    if (exclude.has(String(id))) continue;   // excluded single — never cached or summed
    const key = String(exp);
    if (!byExp.has(key)) byExp.set(key, []);
    byExp.get(key).push(Number(id));
  }
  return byExp;
}

// Derive the values to store, per tracked product. Decisions baked in:
//   • Set Value  = sum of `svField` (avg30) over every single in the expansion
//                  — the all-cards EU singles sum.
//   • Box Price  = the midpoint of `trend` and `avg` (50/50 blend). Thin boxes'
//                  true price sits between Cardmarket's smoothed trend and the
//                  sales avg; liquid boxes have trend ≈ avg so the blend ≈ trend.
//                  EXCEPT when trend runs far below avg (> `trendFallbackGap`
//                  under it) — a stale/thin artefact — in which case it uses avg,
//                  not the dragged-down blend. Falls back to whichever single
//                  value exists; a map `priceOverride` still wins (the manual
//                  lever). priceSrc is 'blend' | 'trend' | 'avg' | 'override'.
//   • lowLiquidity = the box's own trend and avg disagree by ≥ thinGap — the
//                  sales-based price is unreliable (advisory flag for review).
// Returns name → { idProduct, idExpansion, type, release, cardmarket_url,
//                  price, priceSrc, avgPrice, lowPrice, setValue, nSingles,
//                  lowLiquidity }. avgPrice/lowPrice are the guide's avg/low,
//                  stored for the Data Entry low-liquidity review.
export function deriveProducts(map, resolved, priceGuideRecords, singlesRecords, opts = {}) {
  const { boxPriceField = 'trend', svField = 'avg30', thinGap = 0.2, trendFallbackGap = 0.30, excludeIds } = opts;
  const pgById = new Map();
  for (const r of priceGuideRecords) {
    const id = pick(r, FIELD_ALIASES.id);
    if (id != null) pgById.set(String(id), r);
  }
  const singlesByExp = singlesByExpansion(singlesRecords, excludeIds);
  // Value of a record for a chosen field, falling back through the price aliases
  // when that field is empty (e.g. sealed products have no avg30).
  const valueOf = (rec, field) => {
    const chosen = rec[field];
    if (chosen != null && chosen !== '') return Number(chosen);
    return numOrNull(pick(rec, FIELD_ALIASES.price));
  };

  const out = {};
  for (const [name, entry] of Object.entries(map.products)) {
    const info = resolved[name] || {};
    const idP = info.idProduct ?? null;
    const idE = info.idExpansion ?? null;
    const pgRec = idP != null ? pgById.get(String(idP)) : null;

    // Reference prices (avg / low from the same guide row) — stored for the
    // Data Entry review UI, the low-liquidity flag, and (with trend) the blended
    // Box Price below.
    const round2 = (v) => (v != null && Number.isFinite(v) ? +v.toFixed(2) : null);
    const t = pgRec ? numOrNull(pgRec.trend) : null;
    const a = pgRec ? numOrNull(pgRec.avg) : null;
    const avgPrice = round2(a);
    const lowPrice = pgRec ? round2(numOrNull(pgRec.low)) : null;

    // Box Price = the midpoint of trend and avg (50/50 blend). For thin-liquidity
    // boxes the true price sits between Cardmarket's smoothed `trend` and the
    // sales `avg` — confirmed against hand-tracked history (pure trend ran too low
    // on grail boxes); for liquid boxes trend ≈ avg so the blend ≈ trend. Falls
    // back to whichever single value exists; a map `priceOverride` still wins.
    //
    // BUT a `trend` far BELOW `avg` is usually a stale/thin-volume artefact that
    // drags the midpoint down to a wrong (too-low) price — the case that was
    // producing bad daily prices and needing manual fixes. When trend is more than
    // `trendFallbackGap` below avg, trust the sales `avg` instead of the blend.
    // (A high trend still blends — only the low-side anomaly falls back.)
    let basePrice, baseSrc;
    if (t != null && a != null) {
      if (a > 0 && t < a * (1 - trendFallbackGap)) { basePrice = a; baseSrc = 'avg'; }
      else { basePrice = (t + a) / 2; baseSrc = 'blend'; }
    }
    else if (t != null) { basePrice = t; baseSrc = 'trend'; }
    else if (a != null) { basePrice = a; baseSrc = 'avg'; }
    else { basePrice = pgRec ? valueOf(pgRec, boxPriceField) : null; baseSrc = boxPriceField; }
    const override = entry.priceOverride != null && entry.priceOverride !== '' ? Number(entry.priceOverride) : null;
    const rawPrice = override != null ? override : basePrice;
    const price = rawPrice != null && Number.isFinite(rawPrice) ? +rawPrice.toFixed(2) : null;
    const priceSrc = override != null ? 'override' : baseSrc;

    let lowLiquidity = false;
    if (t != null && a != null) {
      const hi = Math.max(a, t);
      if (hi > 0 && Math.abs(a - t) / hi >= thinGap) lowLiquidity = true;
    }

    let setValue = null;
    let nSingles = null;
    if (idE != null) {
      const ids = singlesByExp.get(String(idE)) || [];
      nSingles = ids.length;
      let sum = 0;
      let counted = 0;
      for (const id of ids) {
        const rec = pgById.get(String(id));
        if (!rec) continue;
        const v = valueOf(rec, svField);
        if (Number.isFinite(v)) { sum += v; counted += 1; }
      }
      setValue = counted ? +sum.toFixed(2) : null;
    }

    // Promo value = the avg30 of the bundled promo single (same basis as Set
    // Value), fetched daily so it tracks the card's moving market price instead
    // of a stale hand-typed number. The offline map pins the promo id in
    // `promoIdProduct`; the DB path uses products.cardmarket_promo_product_id.
    let promoValue = null;
    const promoId = entry.promoIdProduct ?? null;
    if (promoId != null) {
      const promoRec = pgById.get(String(promoId));
      if (promoRec) {
        const v = valueOf(promoRec, svField);
        if (Number.isFinite(v)) promoValue = +Number(v).toFixed(2);
      }
    }

    out[name] = {
      idProduct: idP,
      idExpansion: idE,
      promoIdProduct: promoId,
      type: entry.type,
      release: entry.release,
      cardmarket_url: entry.cardmarket_url ?? null,
      price,
      priceSrc,
      avgPrice,
      lowPrice,
      setValue,
      promoValue,
      nSingles,
      lowLiquidity,
    };
  }
  return out;
}

// Day-over-day Set Value guardrail.
//
// A Set Value is the sum of ~250 singles' avg30, so it is *very* stable day to
// day — a real market shift moves it a few percent, never multiples. A large
// single-day RISE is therefore almost always a data artefact: one mis-tagged
// high-value card entering the expansion's singles list. The real case this
// exists for: a promo Gengar (~€2,500) tagged into Cardmarket's Sword & Shield
// base expansion 5×'d that set's value overnight (€635 → €3,132) with no price
// move, and stuck there until fixed by hand.
//
// So when today's computed Set Value is more than `maxJump` (default 50%) ABOVE
// the previous tracked value, HOLD the previous value instead of writing the
// spike, and report it (`held`) for review. Deliberately one-directional — a
// *fall* is let through, because that is how a fixed artefact self-corrects
// (once the bad card is removed the recomputed value drops back to normal, and a
// down-guard would trap the set at the inflated value forever). With no usable
// previous value it is a no-op. Pure; mirrored in cardmarket-daily/index.ts and
// scripts/cardmarket-ingest.mjs, pinned by cardmarket-lib.test.mjs.
export const SV_MAX_DAILY_JUMP = 0.5;
export function guardSetValue(newSetValue, prevSetValue, { maxJump = SV_MAX_DAILY_JUMP } = {}) {
  const val = newSetValue != null && Number.isFinite(Number(newSetValue)) ? Number(newSetValue) : null;
  const prev = prevSetValue != null && Number.isFinite(Number(prevSetValue)) ? Number(prevSetValue) : null;
  if (val == null || prev == null || prev <= 0) return { value: val, held: false, ratio: null };
  const ratio = val / prev;
  const held = ratio > 1 + maxJump;
  return { value: held ? prev : val, held, ratio: +ratio.toFixed(4) };
}
