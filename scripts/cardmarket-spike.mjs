// ============================================================
// Cardmarket ingestion spike (tool, NOT a CI check)
// ============================================================
// Validates the "source product prices + Set Value from Cardmarket's official
// bulk catalogue files" route BEFORE any scheduled job depends on it. These are
// the published productCatalog downloads (idGame 6 = Pokémon), not the website:
//
//   products_nonsingles_6.json  -> the sealed products (name, category, ids)
//   products_singles_6.json     -> single cards, grouped by expansion (for Set Value)
//   price_guide_6.json          -> daily EUR price per idProduct (trend/avg/low/…)
//
// Two subcommands:
//   discover  Name-match the tracked products (cardmarket-map.json) against the
//             nonsingles catalogue and write cardmarket-map.draft.json with the
//             best-guess idProduct/idExpansion for each; print the top candidates
//             for any non-exact match so a human can pin the right id. A product
//             may be pinned in the map by `idProduct` (exact) or `nameHint` (match
//             against a given string, e.g. a "Version 1" bundle variant).
//   compare   Using the map's ids, derive today's Price (price guide) and Set Value
//             (sum of the expansion's singles) and print them beside the latest
//             pokemon_data.xlsx values, so coverage and the Set Value definition
//             can be calibrated before trusting it.
//   both      discover then compare in one pass, chaining the discovered ids in
//             memory — no hand-copy into the map needed for a quick end-to-end look.
//   kpi       discover then compare the sealed-price candidate fields
//             (trend / avg / low) against the currently stored price, to choose
//             the best box-price KPI. (avg1/7/30 are singles-only; not for sealed.)
//
// This is deliberately OUTSIDE `npm test` (it needs network). Run it where
// downloads.s3.cardmarket.com is reachable (CI or a dev machine).
//
// Usage:
//   node scripts/cardmarket-spike.mjs discover [--refresh]
//   node scripts/cardmarket-spike.mjs compare  [--refresh] [--price-field trend]
//   node scripts/cardmarket-spike.mjs both      [--refresh] [--price-field trend]
//
// Nothing here writes to Supabase or the workbook — it only reads and reports.
// The exact JSON field names are confirmed by the FIRST run: --schema prints the
// detected wrapper key and the keys of the first record of each file. If a field
// differs from the assumptions below, adjust the FIELD_ALIASES lists.
// ============================================================

import * as XLSX from 'xlsx';
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE_DIR = join(ROOT, '.cardmarket-cache');
const MAP_PATH = join(ROOT, 'cardmarket-map.json');
const DRAFT_PATH = join(ROOT, 'cardmarket-map.draft.json');
const XLSX_PATH = join(ROOT, 'pokemon_data.xlsx');

const ENDPOINTS = {
  nonsingles: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json',
  singles: 'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json',
  priceGuide: 'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json',
};

// The catalogue/price-guide field names are assumptions until the first run
// confirms them; each is resolved through a candidate list so a spelling change
// (or a localized variant) is a one-line fix, not a rewrite.
const FIELD_ALIASES = {
  id: ['idProduct', 'idProductLocalized', 'productId', 'id'],
  name: ['name', 'enName', 'productName', 'locName'],
  category: ['categoryName', 'category', 'idCategory'],
  expansion: ['idExpansion', 'expansionId', 'idExpansionLocalized'],
  price: ['trend', 'avg', 'avg7', 'avg30', 'low', 'll'], // default preference order
};

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12h — these files refresh daily

// ── args ──
const argv = process.argv.slice(2);
const cmd = argv.find((a) => !a.startsWith('--'));
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const REFRESH = flag('refresh');

// ── helpers ──
const pick = (obj, aliases) => {
  for (const k of aliases) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  return null;
};

// Unwrap a bulk file into its array of records regardless of the wrapper key.
const toRecords = (json) => {
  if (Array.isArray(json)) return { key: '(root array)', records: json };
  for (const [k, v] of Object.entries(json)) {
    if (Array.isArray(v)) return { key: k, records: v };
  }
  return { key: null, records: [] };
};

async function loadFile(which) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const cachePath = join(CACHE_DIR, `${which}.json`);
  const fresh = existsSync(cachePath) && Date.now() - statSync(cachePath).mtimeMs < CACHE_TTL_MS;
  if (fresh && !REFRESH) {
    return JSON.parse(readFileSync(cachePath, 'utf8'));
  }
  process.stderr.write(`fetching ${which} … `);
  const res = await fetch(ENDPOINTS[which]);
  if (!res.ok) throw new Error(`${which}: HTTP ${res.status} ${res.statusText}`);
  const text = await res.text();
  writeFileSync(cachePath, text);
  process.stderr.write(`${(text.length / 1e6).toFixed(1)} MB (cached)\n`);
  return JSON.parse(text);
}

const readMap = () => JSON.parse(readFileSync(MAP_PATH, 'utf8'));

// Normalise a product name for matching: lowercase, expand our abbreviations,
// drop punctuation, collapse whitespace. "Prismatic Evolutions ETB" and
// "Prismatic Evolutions Elite Trainer Box" must collide.
const norm = (s) =>
  String(s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\betb\b/g, 'elite trainer box')
    .replace(/\bbooster display\b/g, 'booster box') // EU sometimes says "Display"
    .replace(/[^a-z0-9 ]+/g, ' ')
    // crude singularise so plural/singular spellings match symmetrically
    // ("Mega Evolutions" ↔ catalogue's "Mega Evolution", "Skies" ↔ "Skie"…);
    // applied to both sides, so exact names still score 1.0.
    .replace(/\b([a-z]{3,}?)s\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

const tokens = (s) => new Set(norm(s).split(' ').filter(Boolean));
// Jaccard token overlap — cheap, good enough to rank an obvious best match.
const score = (a, b) => {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
};

function printSchema(label, wrapperKey, records) {
  const first = records[0] || {};
  console.log(`  ${label}: wrapper "${wrapperKey}", ${records.length} records`);
  console.log(`    first record keys: ${Object.keys(first).join(', ') || '(none)'}`);
}

// ── discover ──────────────────────────────────────────────
async function discover() {
  const map = readMap();
  const nonsingles = await loadFile('nonsingles');
  const { key, records } = toRecords(nonsingles);
  console.log('\nSCHEMA (verify these before trusting the ids):');
  printSchema('nonsingles', key, records);

  // Precompute normalised catalogue rows once.
  const cat = records.map((r) => ({
    id: pick(r, FIELD_ALIASES.id),
    name: pick(r, FIELD_ALIASES.name),
    category: pick(r, FIELD_ALIASES.category),
    expansion: pick(r, FIELD_ALIASES.expansion),
    raw: r,
  }));

  const byId = new Map(cat.filter((c) => c.id != null).map((c) => [String(c.id), c]));
  const draft = structuredClone(map);
  const resolved = {}; // name -> { idProduct, idExpansion } for `both` to chain into compare
  let matched = 0;
  const rows = [];
  const ambiguous = []; // rows worth showing alternatives for
  for (const [name, entry] of Object.entries(map.products)) {
    // A human can override matching two ways in cardmarket-map.json:
    //   idProduct: <n>   pin the exact product (wins outright)
    //   nameHint: "…"    match against this string instead of the product name
    //                    (e.g. "Shrouded Fable Booster Bundle Version 1")
    const query = entry.nameHint || name;
    const scored = [];
    for (const c of cat) {
      if (!c.name) continue;
      scored.push({ c, sc: score(query, c.name) });
    }
    scored.sort((a, b) => b.sc - a.sc);

    let chosen;
    let chosenScore;
    let source;
    if (entry.idProduct != null && byId.has(String(entry.idProduct))) {
      chosen = byId.get(String(entry.idProduct));
      chosenScore = 1;
      source = 'pinned';
    } else {
      chosen = scored[0]?.c || null;
      chosenScore = scored[0]?.sc || 0;
      source = 'match';
    }

    const ok = source === 'pinned' || chosenScore >= 0.6;
    if (ok) matched += 1;
    resolved[name] = { idProduct: chosen ? chosen.id : null, idExpansion: chosen ? chosen.expansion : null };
    draft.products[name].idProduct = chosen ? chosen.id : null;
    draft.products[name].idExpansion = chosen ? chosen.expansion : null;
    draft.products[name]._match = chosen
      ? { catalogueName: chosen.name, category: chosen.category, score: +chosenScore.toFixed(2), source, confident: ok }
      : { catalogueName: null, score: 0, source, confident: false };
    rows.push({
      product: name,
      score: source === 'pinned' ? 'pinned' : +chosenScore.toFixed(2),
      idProduct: chosen ? chosen.id : '—',
      catalogueName: chosen ? chosen.name : '(no match)',
    });
    // Anything not a clean 1.0 auto-match: show the top few so a human can pin the right id.
    if (source === 'match' && chosenScore < 1) {
      ambiguous.push({ name, alts: scored.slice(0, 3) });
    }
  }

  writeFileSync(DRAFT_PATH, JSON.stringify(draft, null, 2) + '\n');
  console.table(rows);
  if (ambiguous.length) {
    console.log('\nAmbiguous matches (score < 1.00) — top candidates, pin the right id in cardmarket-map.json:');
    for (const { name, alts } of ambiguous) {
      console.log(`  ${name}:`);
      for (const { c, sc } of alts) console.log(`      ${sc.toFixed(2)}  id=${c.id}  exp=${c.expansion}  ${c.name}`);
    }
  }
  console.log(
    `\n${matched}/${Object.keys(map.products).length} confident matches (score ≥ 0.6). ` +
      `Draft written to cardmarket-map.draft.json.`,
  );
  console.log('Pin any wrong/low-score row via idProduct or nameHint in cardmarket-map.json, then re-run.');
  return resolved;
}

// ── compare ───────────────────────────────────────────────
// `resolvedIds` (from discover, when run as `both`) supplies ids in-memory so no
// hand-copy into cardmarket-map.json is needed; otherwise the map's ids are used.
async function compare(resolvedIds = null) {
  const map = readMap();
  const idsFor = (name, entry) => resolvedIds?.[name] || entry;
  const priceField = opt('price-field', map.priceField || 'trend');
  const [pg, singles] = await Promise.all([loadFile('priceGuide'), loadFile('singles')]);

  const pgu = toRecords(pg);
  const su = toRecords(singles);
  console.log('\nSCHEMA (verify these before trusting the numbers):');
  printSchema('priceGuide', pgu.key, pgu.records);
  printSchema('singles', su.key, su.records);

  // idProduct -> chosen price (respecting the configured field, then fallbacks).
  // NOTE: Cardmarket populates the rolling averages (avg1/avg7/avg30) only for
  // SINGLES. Sealed products (BOX/ETB/BUNDLE) carry just avg/low/trend, so with
  // priceField=avg30 a sealed record falls back to `trend` here — there is no
  // 30-day average to read for sealed. A true 30-day sealed average has to be
  // computed from our own daily snapshots once ingestion is running.
  const priceOf = (rec) => {
    const chosen = rec[priceField];
    if (chosen != null && chosen !== '') return Number(chosen);
    return Number(pick(rec, FIELD_ALIASES.price));
  };
  const pgById = new Map();
  for (const r of pgu.records) {
    const id = pick(r, FIELD_ALIASES.id);
    if (id != null) pgById.set(String(id), r);
  }

  // idExpansion -> [single idProduct] for the Set Value sum.
  const singlesByExp = new Map();
  for (const r of su.records) {
    const exp = pick(r, FIELD_ALIASES.expansion);
    const id = pick(r, FIELD_ALIASES.id);
    if (exp == null || id == null) continue;
    if (!singlesByExp.has(String(exp))) singlesByExp.set(String(exp), []);
    singlesByExp.get(String(exp)).push(String(id));
  }

  // Latest hand-entered Price / Set Value per product, for the diff.
  const hand = latestFromWorkbook();

  const rows = [];
  for (const [name, entry] of Object.entries(map.products)) {
    const idInfo = idsFor(name, entry);
    if (idInfo.idProduct == null) {
      rows.push({ product: name, note: 'no idProduct — run discover' });
      continue;
    }
    const pgRec = pgById.get(String(idInfo.idProduct));
    const price = pgRec ? priceOf(pgRec) : null;

    let setValue = null;
    let nSingles = null;
    if (idInfo.idExpansion != null) {
      const ids = singlesByExp.get(String(idInfo.idExpansion)) || [];
      nSingles = ids.length;
      let sum = 0;
      let counted = 0;
      for (const id of ids) {
        const rec = pgById.get(id);
        if (!rec) continue;
        const v = priceOf(rec);
        if (Number.isFinite(v)) {
          sum += v;
          counted += 1;
        }
      }
      setValue = counted ? +sum.toFixed(2) : null;
    }

    const h = hand[name] || {};
    rows.push({
      product: name,
      cmPrice: price != null ? +price.toFixed(2) : '—',
      handPrice: h.price ?? '—',
      priceRatio: price != null && h.price ? +(price / h.price).toFixed(2) : '—',
      cmSetValue: setValue ?? '—',
      handSetValue: h.setVal ?? '—',
      svRatio: setValue != null && h.setVal ? +(setValue / h.setVal).toFixed(2) : '—',
      nSingles: nSingles ?? '—',
    });
  }

  console.table(rows);
  const median = (xs) => {
    const s = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
    if (!s.length) return null;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const priced = rows.filter((r) => typeof r.cmPrice === 'number').length;
  const medPrice = median(rows.map((r) => r.priceRatio));
  const medSv = median(rows.map((r) => r.svRatio));
  console.log(
    `\nPrice coverage: ${priced}/${Object.keys(map.products).length}. priceField="${priceField}".`,
  );
  console.log(
    `Median priceRatio (Cardmarket ÷ hand): ${medPrice != null ? medPrice.toFixed(2) : 'n/a'}  ` +
      `·  Median svRatio: ${medSv != null ? medSv.toFixed(2) : 'n/a'}`,
  );
  console.log(
    'svRatio ≈ (Cardmarket singles-sum) ÷ (your hand Set Value). If it clusters around a\n' +
      'constant, a single subset/scale reproduces your definition — pin it and it becomes canonical.\n' +
      'If it is all over the place, Set Value likely needs a card subset (holos/rares), not the full sum.',
  );
}

// Latest snapshot Price/Set Value per product from the workbook.
function latestFromWorkbook() {
  // Use read(buffer) not readFile(path): the ESM xlsx build has no fs-bound
  // readFile (same reason scripts/validate-workbook.mjs reads bytes first).
  const wb = XLSX.read(readFileSync(XLSX_PATH), { type: 'buffer', cellDates: true });
  const hist = XLSX.utils.sheet_to_json(wb.Sheets['Historical Data'], { defval: null });
  const toISO = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));
  const byName = {};
  for (const r of hist) {
    const name = r.Product;
    const date = toISO(r['Snapshot Date'] ?? r.Date);
    const price = r['Price (€)'] ?? r.Price;
    const setVal = r['Set Value (€)'] ?? r['Set Value'];
    if (!name || !date) continue;
    if (!byName[name] || date > byName[name].date) byName[name] = { date, price, setVal };
  }
  return byName;
}

// Read the resolved ids back from the draft discover wrote to disk.
function resolvedFromDraft() {
  const draft = JSON.parse(readFileSync(DRAFT_PATH, 'utf8'));
  const resolved = {};
  for (const [n, e] of Object.entries(draft.products)) {
    resolved[n] = { idProduct: e.idProduct ?? null, idExpansion: e.idExpansion ?? null };
  }
  return resolved;
}

// ── kpi ───────────────────────────────────────────────────
// Compares the sealed-price candidate fields (trend / avg / low) against the
// currently stored (hand-entered) price, so the maintainer can judge which KPI
// best represents the box price before committing to it. (Only these three
// exist for sealed products; avg1/7/30 are singles-only.) Note: this measures
// closeness to the stored values on ONE day — a stability/outlier test needs
// several days of snapshots, which the scheduled job will provide.
async function priceKpi(resolvedIds) {
  const map = readMap();
  const pg = await loadFile('priceGuide');
  const pgu = toRecords(pg);
  console.log('\nSCHEMA:');
  printSchema('priceGuide', pgu.key, pgu.records);
  const pgById = new Map();
  for (const r of pgu.records) {
    const id = pick(r, FIELD_ALIASES.id);
    if (id != null) pgById.set(String(id), r);
  }
  const hand = latestFromWorkbook();
  const num = (v) => (v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
  const acc = { trend: [], avg: [], low: [] };
  const rows = [];
  const thin = []; // low-liquidity: trend and avg disagree, so the number is unreliable
  const THIN_GAP = 0.2; // |avg − trend| ≥ 20% of the higher of the two
  for (const [name] of Object.entries(map.products)) {
    const id = resolvedIds[name]?.idProduct;
    const rec = id != null ? pgById.get(String(id)) : null;
    const h = num(hand[name]?.price);
    const t = rec ? num(rec.trend) : null;
    const a = rec ? num(rec.avg) : null;
    const l = rec ? num(rec.low) : null;
    const ratio = (x) => (x != null && h ? +(x / h).toFixed(2) : '—');
    if (h) {
      if (t != null) acc.trend.push(t / h);
      if (a != null) acc.avg.push(a / h);
      if (l != null) acc.low.push(l / h);
    }
    if (t != null && a != null) {
      const hi = Math.max(a, t);
      const gap = hi > 0 ? Math.abs(a - t) / hi : 0;
      if (gap >= THIN_GAP) {
        thin.push({ product: name, trend: t, avg: a, low: l ?? '—', 'gap%': Math.round(gap * 100), stored: h ?? '—' });
      }
    }
    rows.push({
      product: name,
      hand: h ?? '—',
      trend: t ?? '—',
      'trend/hand': ratio(t),
      avg: a ?? '—',
      'avg/hand': ratio(a),
      low: l ?? '—',
      'low/hand': ratio(l),
    });
  }
  console.table(rows);
  const median = (xs) => {
    const s = xs.slice().sort((a, b) => a - b);
    if (!s.length) return null;
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  // Spread = mean |ratio − median|; smaller = the KPI tracks the stored values
  // more consistently (a rough proxy; a real stability test wants a time series).
  const spread = (xs, med) => (xs.length ? xs.reduce((s, x) => s + Math.abs(x - med), 0) / xs.length : null);
  console.log('\nCandidate box-price KPI vs your stored price (ratio = Cardmarket ÷ stored):');
  for (const k of ['trend', 'avg', 'low']) {
    const med = median(acc[k]);
    const sp = med != null ? spread(acc[k], med) : null;
    console.log(
      `  ${k.padEnd(6)} median ratio ${med != null ? med.toFixed(2) : 'n/a'}  ·  ` +
        `spread ±${sp != null ? sp.toFixed(2) : 'n/a'}  (n=${acc[k].length})`,
    );
  }
  console.log(
    'Closest median to 1.00 = least biased vs your values; smallest spread = most\n' +
      'consistent. A true short-term-outlier test needs several daily snapshots.',
  );

  // Low-liquidity flag: when trend and avg disagree by ≥20%, few sales are moving
  // the sales-based fields, so the value is unreliable (and usually well below the
  // current listings/asking prices). These are the products to flag/override, not
  // auto-trust — a single field can't be right for all of them (trend is stale-low
  // on some, avg is stale-high on others).
  console.log(
    `\nLow-liquidity flags (|avg − trend| ≥ ${Math.round(THIN_GAP * 100)}% — thin sales, ` +
      `number unreliable, likely under current listings): ${thin.length}/${acc.trend.length}`,
  );
  if (thin.length) console.table(thin);
}

// ── main ──
(async () => {
  try {
    if (cmd === 'discover') await discover();
    else if (cmd === 'compare') await compare();
    else if (cmd === 'both') {
      await discover(); // writes the draft with resolved ids
      console.log('\n========================================\n');
      await compare(resolvedFromDraft());
    } else if (cmd === 'kpi') {
      await discover();
      console.log('\n========================================\n');
      await priceKpi(resolvedFromDraft());
    } else {
      console.log('Usage: node scripts/cardmarket-spike.mjs <discover|compare|both|kpi> [--refresh] [--price-field trend]');
      process.exit(2);
    }
  } catch (err) {
    console.error(`\nspike failed: ${err.message}`);
    if (/fetch|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|403|407/.test(err.message)) {
      console.error('This host must be reachable from where you run the spike (CI or a dev machine);');
      console.error('some sandboxes block downloads.s3.cardmarket.com by egress policy.');
    }
    process.exit(1);
  }
})();
