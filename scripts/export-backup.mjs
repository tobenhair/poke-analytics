// ============================================================
// Automated database backup: Supabase → a portable .xlsx snapshot
// ============================================================
// The inverse of supabase/migrate-xlsx.mjs. Reads the shared product data
// (products + snapshots) with the SERVICE-ROLE key and writes a workbook in the
// exact contract parseXlsx() / scripts/validate-workbook.mjs enforce, so the
// file round-trips back into the app (and re-imports via migrate-xlsx.mjs).
//
// This is the *portable, vendor-independent* backup of the tracked dataset. It
// is NOT a full-database backup: the .xlsx format carries only products +
// snapshots. Per-user data (holdings, alerts, sales, purchases, user_settings)
// and the Cardmarket singles caches are NOT in it — Supabase's managed daily
// backup / PITR is the complete net (see SUPABASE.md → Backup & restore). To
// keep a restore able to rebuild ingestion state, the Summary sheet also carries
// the restore-critical product columns (CM ID / Exp ID / Promo IDs / Price
// Locked / Cardmarket URL) as *additional* columns — the validator and the app
// read only the columns they know, so extras are harmless.
//
// Usage:
//   npm ci
//   SUPABASE_URL="https://xxxx.supabase.co" \
//   SUPABASE_SERVICE_ROLE_KEY="service-role-key" \
//   node scripts/export-backup.mjs [--out path/to/backup.xlsx]
//
// The service-role key bypasses RLS and must ONLY ever live in CI secrets —
// never in the repo or the client. Reads are SELECT-only: this script never
// writes to the database.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const PAGE = 1000; // PostgREST default max rows per response

const toISO = (v) => (v == null ? '' : String(v).slice(0, 10));

// Build the workbook from already-fetched rows. Pure and side-effect-free so it
// can be unit-tested / verified against real rows without network or a key.
//   products:  [{ name, type, release, packs, cardmarket_product_id,
//                 cardmarket_expansion_id, cardmarket_promo_product_ids,
//                 price_locked, cardmarket_url }]
//   snapshots: [{ product_name, snapshot_date, price, set_value, promo_value,
//                 low_liquidity, price_avg, price_low }]
export function buildWorkbook(products, snapshots) {
  // Summary — one row per product. First four columns are the contract
  // (Product / Type / Release Date / Packs); the rest are additive
  // restore-state columns the validator/app ignore but a restore can read.
  const summary = products.map((p) => {
    const row = {
      'Product': p.name,
      'Type': String(p.type || '').toUpperCase(),
      'Release Date': toISO(p.release),
    };
    if (p.packs != null) row['Packs'] = Number(p.packs);
    if (p.cardmarket_product_id != null) row['CM ID'] = Number(p.cardmarket_product_id);
    if (p.cardmarket_expansion_id != null) row['Exp ID'] = Number(p.cardmarket_expansion_id);
    if (Array.isArray(p.cardmarket_promo_product_ids) && p.cardmarket_promo_product_ids.length)
      row['Promo IDs'] = p.cardmarket_promo_product_ids.map(Number).join(',');
    if (p.price_locked) row['Price Locked'] = 'TRUE';
    if (p.cardmarket_url) row['Cardmarket URL'] = p.cardmarket_url;
    return row;
  });

  // Historical Data — one row per snapshot. Price (€) / Set Value (€) / Promo
  // Value (€) are the contract; low-liquidity + reference prices are additive
  // fidelity columns.
  const history = snapshots.map((s) => {
    const row = {
      'Product': s.product_name,
      'Snapshot Date': toISO(s.snapshot_date),
    };
    if (s.price != null) row['Price (€)'] = Number(s.price);
    if (s.set_value != null) row['Set Value (€)'] = Number(s.set_value);
    if (s.promo_value != null) row['Promo Value (€)'] = Number(s.promo_value);
    if (s.low_liquidity) row['Low Liquidity'] = 'TRUE';
    if (s.price_avg != null) row['Price Avg (€)'] = Number(s.price_avg);
    if (s.price_low != null) row['Price Low (€)'] = Number(s.price_low);
    return row;
  });

  // Links — Product + URL for every product that has one.
  const links = products
    .filter((p) => p.cardmarket_url)
    .map((p) => ({ 'Product': p.name, 'URL': p.cardmarket_url }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(history), 'Historical Data');
  if (links.length) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(links), 'Links');
  return wb;
}

// Re-read the written workbook and assert it is complete and re-readable. This
// is the HARD gate: a backup that lost rows or can't be parsed back is not a
// backup. (The app-renderability contract in validate-workbook.mjs is stricter
// than a faithful backup needs — a product that is temporarily price-only is
// legitimate data we still want captured — so that runs as an advisory below,
// never as the gate.)
function roundTripCheck(path, products, snapshots) {
  const wb = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: true });
  const problems = [];
  if (!wb.Sheets['Summary']) problems.push('written file has no "Summary" sheet');
  if (!wb.Sheets['Historical Data']) problems.push('written file has no "Historical Data" sheet');
  if (problems.length) return problems;

  const s = XLSX.utils.sheet_to_json(wb.Sheets['Summary'], { defval: null });
  const h = XLSX.utils.sheet_to_json(wb.Sheets['Historical Data'], { defval: null });
  if (s.length !== products.length)
    problems.push(`Summary row count ${s.length} != ${products.length} products fetched`);
  if (h.length !== snapshots.length)
    problems.push(`Historical Data row count ${h.length} != ${snapshots.length} snapshots fetched`);

  const names = s.map((r) => r['Product']);
  if (names.some((n) => !n || String(n).trim() === ''))
    problems.push('a Summary row is missing a Product name');
  if (new Set(names).size !== names.length)
    problems.push('duplicate Product names in Summary');
  return problems;
}

async function fetchAll(sb, table, columns, orderCols) {
  const all = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(columns);
    for (const [c, asc] of orderCols) q = q.order(c, { ascending: asc });
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    all.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return all;
}

async function main() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY })) {
    if (!v) { console.error(`✕ Missing env var ${k}`); process.exit(1); }
  }
  const outIdx = process.argv.indexOf('--out');
  const outFile = outIdx >= 0 && process.argv[outIdx + 1]
    ? process.argv[outIdx + 1]
    : `pokemon_data-backup-${new Date().toISOString().slice(0, 10)}.xlsx`;

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  console.log('Fetching products + snapshots (service-role, read-only)…');
  const products = await fetchAll(sb, 'products',
    'name,type,release,packs,cardmarket_product_id,cardmarket_expansion_id,cardmarket_promo_product_ids,price_locked,cardmarket_url',
    [['release', true], ['name', true]]);
  const snapRows = await fetchAll(sb, 'snapshots',
    'product_id,snapshot_date,price,set_value,promo_value,low_liquidity,price_avg,price_low',
    [['snapshot_date', true], ['product_id', true]]);

  // Fetch ids alongside names to map snapshot.product_id → product name.
  const idRows = await fetchAll(sb, 'products', 'id,name', [['name', true]]);
  const nameById = Object.fromEntries(idRows.map((p) => [p.id, p.name]));
  const snapshots = snapRows
    .map((s) => ({ ...s, product_name: nameById[s.product_id] }))
    .filter((s) => s.product_name); // drop orphans (should be none — FK enforces it)

  const dropped = snapRows.length - snapshots.length;
  if (dropped) console.warn(`⚠ ${dropped} snapshot rows had no matching product and were skipped`);

  console.log(`  ${products.length} products · ${snapshots.length} snapshots`);

  const wb = buildWorkbook(products, snapshots);
  // Write via a buffer + fs (the ESM xlsx build doesn't wire fs into
  // XLSX.writeFile — the same reason validate-workbook.mjs reads via a buffer).
  writeFileSync(outFile, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  console.log(`✓ Wrote ${outFile}`);

  // Hard gate: completeness + re-readability.
  const problems = roundTripCheck(outFile, products, snapshots);
  if (problems.length) {
    console.error(`✕ Backup failed its integrity check:`);
    problems.forEach((p) => console.error(`  • ${p}`));
    process.exit(1);
  }
  console.log('✓ Round-trip integrity check passed (all rows present, re-readable).');

  // Advisory: run the app's stricter renderability contract. A failure here does
  // NOT fail the backup (the file is still a faithful, restorable capture) but is
  // surfaced loudly so a real contract drift is visible in the run log.
  const here = dirname(fileURLToPath(import.meta.url));
  const res = spawnSync('node', [resolve(here, 'validate-workbook.mjs'), outFile], { encoding: 'utf8' });
  process.stdout.write(res.stdout || '');
  if (res.status !== 0) {
    process.stderr.write(res.stderr || '');
    console.warn('\n⚠ Workbook validation reported issues (see above). The backup was still ' +
      'written and is restorable — the app-render contract is stricter than a backup needs. ' +
      'Investigate if this is unexpected.');
  }
  process.exit(0);
}

// Only run main() when invoked directly, so buildWorkbook can be imported for tests.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(`✕ Backup failed: ${e.message}`); process.exit(1); });
}
