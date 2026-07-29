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
//             best-guess idProduct/idExpansion for each. HUMAN reviews it, copies
//             confirmed ids into cardmarket-map.json.
//   compare   Using the ids already in cardmarket-map.json, derive today's Price
//             (price guide) and Set Value (sum of the expansion's singles) and
//             print them beside the latest values in pokemon_data.xlsx, so you can
//             see coverage and calibrate the Set Value definition before trusting it.
//
// This is deliberately OUTSIDE `npm test` (it needs network + the ids filled in).
// Run it where downloads.s3.cardmarket.com is reachable (CI or a dev machine).
//
// Usage:
//   node scripts/cardmarket-spike.mjs discover [--refresh]
//   node scripts/cardmarket-spike.mjs compare  [--refresh] [--price-field trend]
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

  const draft = structuredClone(map);
  let matched = 0;
  const rows = [];
  for (const [name, entry] of Object.entries(map.products)) {
    let best = null;
    let bestScore = 0;
    for (const c of cat) {
      if (!c.name) continue;
      const sc = score(name, c.name);
      if (sc > bestScore) {
        bestScore = sc;
        best = c;
      }
    }
    const ok = best && bestScore >= 0.6;
    if (ok) matched += 1;
    draft.products[name].idProduct = best ? best.id : null;
    draft.products[name].idExpansion = best ? best.expansion : null;
    draft.products[name]._match = best
      ? { catalogueName: best.name, category: best.category, score: +bestScore.toFixed(2), confident: ok }
      : { catalogueName: null, score: 0, confident: false };
    rows.push({
      product: name,
      score: +bestScore.toFixed(2),
      idProduct: best ? best.id : '—',
      catalogueName: best ? best.name : '(no match)',
    });
  }

  writeFileSync(DRAFT_PATH, JSON.stringify(draft, null, 2) + '\n');
  console.table(rows);
  console.log(
    `\n${matched}/${Object.keys(map.products).length} confident matches (score ≥ 0.6). ` +
      `Draft written to cardmarket-map.draft.json.`,
  );
  console.log('Review low-score / wrong rows by hand, then copy confirmed idProduct + idExpansion into cardmarket-map.json.');
}

// ── compare ───────────────────────────────────────────────
async function compare() {
  const map = readMap();
  const priceField = opt('price-field', map.priceField || 'trend');
  const [pg, singles] = await Promise.all([loadFile('priceGuide'), loadFile('singles')]);

  const pgu = toRecords(pg);
  const su = toRecords(singles);
  console.log('\nSCHEMA (verify these before trusting the numbers):');
  printSchema('priceGuide', pgu.key, pgu.records);
  printSchema('singles', su.key, su.records);

  // idProduct -> chosen price (respecting the configured field, then fallbacks).
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
    if (entry.idProduct == null) {
      rows.push({ product: name, note: 'no idProduct in map — run discover' });
      continue;
    }
    const pgRec = pgById.get(String(entry.idProduct));
    const price = pgRec ? priceOf(pgRec) : null;

    let setValue = null;
    let nSingles = null;
    if (entry.idExpansion != null) {
      const ids = singlesByExp.get(String(entry.idExpansion)) || [];
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
  const priced = rows.filter((r) => typeof r.cmPrice === 'number').length;
  console.log(
    `\nPrice coverage: ${priced}/${Object.keys(map.products).length}. ` +
      `priceField="${priceField}".`,
  );
  console.log(
    'svRatio ≈ (Cardmarket singles-sum) ÷ (your hand Set Value). If it clusters around a\n' +
      'constant, a single subset/scale reproduces your definition — pin it and it becomes canonical.\n' +
      'If it is all over the place, Set Value likely needs a card subset (holos/rares), not the full sum.',
  );
}

// Latest snapshot Price/Set Value per product from the workbook.
function latestFromWorkbook() {
  const wb = XLSX.readFile(XLSX_PATH, { cellDates: true });
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

// ── main ──
(async () => {
  try {
    if (cmd === 'discover') await discover();
    else if (cmd === 'compare') await compare();
    else {
      console.log('Usage: node scripts/cardmarket-spike.mjs <discover|compare> [--refresh] [--price-field trend]');
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
