// ============================================================
// Cardmarket → Supabase ingestion job (scheduled + manual)
// ============================================================
// Fetches Cardmarket's daily bulk files, derives each tracked product's Price
// (trend) and Set Value (avg30 all-cards singles sum) via the shared, tested
// core in cardmarket-lib.mjs, and upserts today's snapshot into Supabase using
// the SERVICE-ROLE key (bypasses RLS). Never touches the browser app.
//
// Rules baked in (see ROADMAP "Automated ingestion"):
//   • Set Value always auto-updates.
//   • Box Price is written UNLESS the product is `price_locked` in Supabase —
//     the manual override for thin-liquidity products, set by the admin in Data
//     Entry. Locked products keep the admin's hand-entered price.
//   • Each snapshot carries the `low_liquidity` advisory flag.
//   • Products are NOT created here — the maintainer seeds them (Data Entry /
//     workbook). A tracked product missing from Supabase is warned and skipped.
//
// Env (set as GitHub Action secrets for the real run):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Usage:
//   node scripts/cardmarket-ingest.mjs            # write today's snapshot
//   node scripts/cardmarket-ingest.mjs --dry-run  # derive + print, write nothing (no creds needed)
//   node scripts/cardmarket-ingest.mjs --date 2026-07-30 --refresh
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { loadFile, toRecords, readMap, resolveIds, deriveProducts } from './cardmarket-lib.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const opt = (f, dflt) => {
  const i = argv.indexOf(`--${f}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const DRY_RUN = has('dry-run');
const REFRESH = has('refresh');
const DATE = opt('date', new Date().toISOString().slice(0, 10));
const log = (s) => process.stderr.write(s);

async function main() {
  const map = readMap();

  // 1. Fetch + derive (the same core the spike validated).
  const [nonsingles, priceGuide, singles] = await Promise.all([
    loadFile('nonsingles', { refresh: REFRESH, log }),
    loadFile('priceGuide', { refresh: REFRESH, log }),
    loadFile('singles', { refresh: REFRESH, log }),
  ]);
  const resolved = resolveIds(map, toRecords(nonsingles).records);
  const derived = deriveProducts(map, resolved, toRecords(priceGuide).records, toRecords(singles).records);

  // Only products with a confident id match and at least one usable value.
  const usable = [];
  const skipped = [];
  for (const [name, d] of Object.entries(derived)) {
    const info = resolved[name] || {};
    if (!info.confident || d.idProduct == null) { skipped.push({ name, why: `unconfident match (score ${info.score})` }); continue; }
    if (d.price == null && d.setValue == null) { skipped.push({ name, why: 'no price or set value' }); continue; }
    usable.push({ name, ...d });
  }

  console.log(`\nCardmarket ingest — ${DATE}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`Derived ${usable.length}/${Object.keys(derived).length} products; ${skipped.length} skipped.`);

  if (DRY_RUN) {
    console.table(
      usable.map((p) => ({
        product: p.name,
        price: p.price ?? '—',
        priceSrc: p.priceSrc,
        setValue: p.setValue ?? '—',
        lowLiq: p.lowLiquidity ? 'yes' : '',
        idProduct: p.idProduct,
      })),
    );
    if (skipped.length) console.log('Skipped:', skipped.map((s) => `${s.name} (${s.why})`).join('; '));
    console.log('\nDry run — nothing written to Supabase.');
    return;
  }

  // 2. Connect (service role) and map product name → { id, user_id, price_locked }.
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (or use --dry-run).');
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: products, error: pErr } = await sb.from('products').select('id, name, user_id, price_locked');
  if (pErr) throw new Error(`reading products: ${pErr.message}`);
  const byName = new Map(products.map((p) => [p.name, p]));

  // 3. Build snapshot rows. Locked products omit `price` (kept as the admin's
  // manual value); everyone gets set_value + low_liquidity.
  const withPrice = [];
  const withoutPrice = [];
  const missing = [];
  for (const p of usable) {
    const row = byName.get(p.name);
    if (!row) { missing.push(p.name); continue; }
    const base = { user_id: row.user_id, product_id: row.id, snapshot_date: DATE, set_value: p.setValue, low_liquidity: p.lowLiquidity };
    if (row.price_locked || p.price == null) withoutPrice.push(base);
    else withPrice.push({ ...base, price: p.price });
  }

  // 4. Upsert on (product_id, snapshot_date). Two batches so locked rows don't
  // carry a `price` column at all (leaving any existing/admin price untouched).
  let written = 0;
  for (const [rows, label] of [[withPrice, 'with price'], [withoutPrice, 'set-value only (locked/no-price)']]) {
    if (!rows.length) continue;
    const { error } = await sb.from('snapshots').upsert(rows, { onConflict: 'product_id,snapshot_date' });
    if (error) throw new Error(`upserting snapshots (${label}): ${error.message}`);
    written += rows.length;
    console.log(`  upserted ${rows.length} snapshot(s) — ${label}`);
  }

  const locked = withoutPrice.length;
  console.log(`\nWrote ${written} snapshot(s) for ${DATE} (${locked} price-locked/no-price).`);
  if (missing.length) console.warn(`Not in Supabase (seed via Data Entry) — skipped: ${missing.join(', ')}`);
}

main().catch((err) => {
  console.error(`\ningest failed: ${err.message}`);
  if (/fetch|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|403|407/.test(err.message)) {
    console.error('The Cardmarket host must be reachable (CI / a dev machine).');
  }
  process.exit(1);
});
