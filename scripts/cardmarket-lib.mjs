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
export function singlesByExpansion(singlesRecords) {
  const byExp = new Map();
  for (const r of singlesRecords) {
    const exp = pick(r, FIELD_ALIASES.expansion);
    const id = pick(r, FIELD_ALIASES.id);
    if (exp == null || id == null) continue;
    const key = String(exp);
    if (!byExp.has(key)) byExp.set(key, []);
    byExp.get(key).push(Number(id));
  }
  return byExp;
}

// Derive the values to store, per tracked product. Decisions baked in:
//   • Set Value  = sum of `svField` (avg30) over every single in the expansion
//                  — the all-cards EU singles sum.
//   • Box Price  = `boxPriceField` (trend; sealed products carry no avg30, so
//                  avg30 would fall back to trend anyway), UNLESS the map pins a
//                  `priceOverride`, which wins (the thin-liquidity manual lever).
//   • lowLiquidity = the box's own trend and avg disagree by ≥ thinGap — the
//                  sales-based price is unreliable (advisory flag).
// Returns name → { idProduct, idExpansion, type, release, cardmarket_url,
//                  price, priceSrc, setValue, nSingles, lowLiquidity }.
export function deriveProducts(map, resolved, priceGuideRecords, singlesRecords, opts = {}) {
  const { boxPriceField = 'trend', svField = 'avg30', thinGap = 0.2 } = opts;
  const pgById = new Map();
  for (const r of priceGuideRecords) {
    const id = pick(r, FIELD_ALIASES.id);
    if (id != null) pgById.set(String(id), r);
  }
  const singlesByExp = singlesByExpansion(singlesRecords);
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

    const override = entry.priceOverride != null && entry.priceOverride !== '' ? Number(entry.priceOverride) : null;
    const rawPrice = override != null ? override : pgRec ? valueOf(pgRec, boxPriceField) : null;
    const price = rawPrice != null && Number.isFinite(rawPrice) ? +rawPrice.toFixed(2) : null;
    const priceSrc = override != null ? 'override' : boxPriceField;

    let lowLiquidity = false;
    if (pgRec) {
      const t = numOrNull(pgRec.trend);
      const a = numOrNull(pgRec.avg);
      if (t != null && a != null) {
        const hi = Math.max(a, t);
        if (hi > 0 && Math.abs(a - t) / hi >= thinGap) lowLiquidity = true;
      }
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

    out[name] = {
      idProduct: idP,
      idExpansion: idE,
      type: entry.type,
      release: entry.release,
      cardmarket_url: entry.cardmarket_url ?? null,
      price,
      priceSrc,
      setValue,
      nSingles,
      lowLiquidity,
    };
  }
  return out;
}
