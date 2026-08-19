// ============================================================
// Cardmarket → Supabase ingestion job (scheduled + manual)
// ============================================================
// Fetches Cardmarket's daily bulk files, derives each tracked product's Price
// (trend) and Set Value (avg30 all-cards singles sum) via the shared, tested
// core in cardmarket-lib.mjs, and upserts today's snapshot into Supabase with
// the SERVICE-ROLE key (bypasses RLS). Never touches the browser app.
//
// DB-DRIVEN: the tracked set is the Supabase `products` table (seed products in
// Data Entry). Each product's `cardmarket_product_id` (entered in Data Entry)
// pins the catalogue match exactly; products without one fall back to matching
// by name. `cardmarket-map.json` is now just OVERRIDES (nameHint / priceOverride)
// plus the offline allowlist used by --dry-run when there are no DB creds.
//
// LOCAL / MANUAL FALLBACK. In production BOTH halves now run inside Supabase:
// the DAILY snapshot is the `cardmarket-daily` Edge Function (scheduled by
// pg_cron), and the occasional CATALOG SYNC is the `cardmarket-catalog-refresh`
// Edge Function (triggered from Data Entry). This script mirrors that work for
// the command line — handy for a dry-run preview, a one-time --backfill-ids, or
// running --refresh-catalog / a snapshot by hand if you'd rather not use the
// functions. Its derive math is the same shared, tested core.
//
// Rules (shared with the Edge Function):
//   • Set Value always auto-updates (avg30 all-cards singles sum).
//   • Box Price = trend, UNLESS the product is `price_locked` (admin's manual
//     value stands) — Set Value still updates.
//   • Each snapshot carries the `low_liquidity` advisory flag.
//   • Products are not created here; a tracked-but-absent product is skipped.
//
// Env (Action / local secrets): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Usage:
//   node scripts/cardmarket-ingest.mjs --refresh-catalog  # PRECOMPUTE: resolve
//        # expansion ids + cache each expansion's single-card ids into Supabase
//        # (run occasionally / when you add sets; the memory-heavy step)
//   node scripts/cardmarket-ingest.mjs --backfill-ids  # write resolved product
//        # ids onto every DB product that lacks one (one-time)
//   node scripts/cardmarket-ingest.mjs               # write today's snapshot
//        # (manual fallback; the daily write normally runs in the Edge Function)
//   node scripts/cardmarket-ingest.mjs --dry-run     # derive + print, no write
//   node scripts/cardmarket-ingest.mjs --date 2026-07-30 --refresh
// ============================================================

import { createClient } from '@supabase/supabase-js';
import { loadFile, toRecords, readMap, resolveIds, deriveProducts, singlesByExpansion, guardSetValue } from './cardmarket-lib.mjs';

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const opt = (f, dflt) => {
  const i = argv.indexOf(`--${f}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const DRY_RUN = has('dry-run');
const BACKFILL_IDS = has('backfill-ids');
const REFRESH_CATALOG = has('refresh-catalog');
const REFRESH = has('refresh');
const DATE = opt('date', new Date().toISOString().slice(0, 10));
const log = (s) => process.stderr.write(s);

const supa = () => {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
};

async function main() {
  const overrides = readMap(); // cardmarket-map.json → overrides + offline allowlist
  const sb = supa();
  if ((BACKFILL_IDS || REFRESH_CATALOG || !DRY_RUN) && !sb) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (or use --dry-run).');
  }

  // The tracked set: the DB `products` (source of truth) when connected, else
  // the map allowlist (dry-run without creds). DB `cardmarket_product_id` pins
  // the match; map entries supply nameHint / priceOverride overrides.
  let dbByName = null;
  let workingMap;
  if (sb) {
    const { data: products, error } = await sb
      .from('products')
      .select('id, name, type, release, cardmarket_url, price_locked, cardmarket_product_id, cardmarket_promo_product_id');
    if (error) throw new Error(`reading products: ${error.message}`);
    dbByName = new Map(products.map((p) => [p.name, p]));
    workingMap = { products: {} };
    for (const p of products) {
      const ov = overrides.products?.[p.name] || {};
      workingMap.products[p.name] = {
        type: p.type ?? ov.type,
        release: p.release ?? ov.release,
        cardmarket_url: p.cardmarket_url ?? ov.cardmarket_url,
        idProduct: p.cardmarket_product_id ?? ov.idProduct ?? null, // DB id pins; else a map pin
        promoIdProduct: p.cardmarket_promo_product_id ?? ov.promoIdProduct ?? null,
        nameHint: ov.nameHint,
        priceOverride: ov.priceOverride,
      };
    }
  } else {
    workingMap = overrides; // offline preview
  }

  // Fetch + derive (the shared, unit-tested core).
  const [nonsingles, priceGuide, singles] = await Promise.all([
    loadFile('nonsingles', { refresh: REFRESH, log }),
    loadFile('priceGuide', { refresh: REFRESH, log }),
    loadFile('singles', { refresh: REFRESH, log }),
  ]);
  const nsRecords = toRecords(nonsingles).records;
  const singleRecs = toRecords(singles).records;
  const resolved = resolveIds(workingMap, nsRecords);

  // Singles Cardmarket mis-tags into a tracked expansion that must never enter a
  // Set Value (a €2,500 promo Gengar 5×'d Sword & Shield). The DB table is the
  // source of truth; the offline map copy is the fallback with no DB creds.
  let excludeIds = [];
  if (sb) {
    const { data, error } = await sb.from('cardmarket_excluded_singles').select('id_product');
    if (error) throw new Error(`reading excluded singles: ${error.message}`);
    excludeIds = (data ?? []).map((r) => r.id_product);
  } else {
    excludeIds = overrides.excludeSingles ?? [];
  }

  // ── Catalog sync (precompute): resolve each product's expansion id and cache
  //    the expansion's single-card ids in Supabase, so the daily Edge Function
  //    never loads the huge singles file. Also fills a missing product id. This
  //    is the memory-heavy step (it reads the whole singles file) — run it here,
  //    in a memory-rich environment, not in the ~256 MB Edge runtime.
  if (REFRESH_CATALOG) {
    const byExp = singlesByExpansion(singleRecs, excludeIds);
    const expansionsInUse = new Set();
    const unresolved = [];
    let prodUpdates = 0;
    for (const [name, info] of Object.entries(resolved)) {
      const row = dbByName.get(name);
      if (!row) continue;
      if (!info.confident || info.idExpansion == null) { unresolved.push(`${name} (score ${info.score})`); continue; }
      expansionsInUse.add(String(info.idExpansion));
      const patch = { cardmarket_expansion_id: Number(info.idExpansion) };
      if (row.cardmarket_product_id == null && info.idProduct != null) patch.cardmarket_product_id = Number(info.idProduct);
      if (DRY_RUN) { prodUpdates += 1; console.log(`would set ${name} → expansion ${info.idExpansion}${patch.cardmarket_product_id ? `, product ${patch.cardmarket_product_id}` : ''}`); continue; }
      const { error } = await sb.from('products').update(patch).eq('id', row.id);
      if (error) throw new Error(`updating ${name}: ${error.message}`);
      prodUpdates += 1;
    }
    const catalogRows = [...expansionsInUse].map((exp) => ({
      id_expansion: Number(exp),
      single_product_ids: byExp.get(exp) || [],
      updated_at: new Date().toISOString(),
    }));
    if (!DRY_RUN && catalogRows.length) {
      const { error } = await sb.from('cardmarket_expansion_singles').upsert(catalogRows, { onConflict: 'id_expansion' });
      if (error) throw new Error(`upserting catalog: ${error.message}`);
    }
    const totalSingles = catalogRows.reduce((n, r) => n + r.single_product_ids.length, 0);
    console.log(`\nCatalog sync${DRY_RUN ? ' (dry run)' : ''}: ${prodUpdates} product(s) updated, ${catalogRows.length} expansion(s) cached (${totalSingles} single ids).`);
    if (unresolved.length) console.warn(`Could not resolve (enter a CM ID by hand): ${unresolved.join(', ')}`);
    return;
  }

  const derived = deriveProducts(workingMap, resolved, toRecords(priceGuide).records, singleRecs, { excludeIds });

  // ── Backfill: write each confidently-resolved idProduct onto the DB product
  //    that lacks one, so the DB becomes self-sufficient (no name-matching after).
  if (BACKFILL_IDS) {
    let filled = 0;
    const unresolved = [];
    for (const [name, info] of Object.entries(resolved)) {
      const row = dbByName.get(name);
      if (!row) continue;
      if (row.cardmarket_product_id != null) continue; // already set — leave it
      if (!info.confident || info.idProduct == null) { unresolved.push(`${name} (score ${info.score})`); continue; }
      if (DRY_RUN) { filled += 1; console.log(`would set ${name} → ${info.idProduct}`); continue; }
      const { error } = await sb.from('products').update({ cardmarket_product_id: info.idProduct }).eq('id', row.id);
      if (error) throw new Error(`backfill ${name}: ${error.message}`);
      filled += 1;
    }
    console.log(`\nBackfill${DRY_RUN ? ' (dry run)' : ''}: ${filled} product id(s) set.`);
    if (unresolved.length) console.warn(`Could not resolve (add a nameHint/idProduct override or enter by hand): ${unresolved.join(', ')}`);
    return;
  }

  // Keep confident matches with at least one usable value.
  const usable = [];
  const skipped = [];
  for (const [name, d] of Object.entries(derived)) {
    const info = resolved[name] || {};
    if (!info.confident || d.idProduct == null) { skipped.push(`${name} (unconfident: score ${info.score})`); continue; }
    if (d.price == null && d.setValue == null) { skipped.push(`${name} (no price or set value)`); continue; }
    usable.push({ name, ...d });
  }

  console.log(`\nCardmarket ingest — ${DATE}${DRY_RUN ? ' (dry run)' : ''}`);
  console.log(`Derived ${usable.length}/${Object.keys(derived).length} products; ${skipped.length} skipped.`);

  if (DRY_RUN) {
    console.table(
      usable.map((p) => ({
        product: p.name,
        idSrc: (sb ? (dbByName.get(p.name)?.cardmarket_product_id != null ? 'db' : (resolved[p.name].source)) : resolved[p.name].source),
        price: p.price ?? '—',
        priceSrc: p.priceSrc,
        setValue: p.setValue ?? '—',
        lowLiq: p.lowLiquidity ? 'yes' : '',
        idProduct: p.idProduct,
      })),
    );
    if (skipped.length) console.log('Skipped:', skipped.join('; '));
    console.log('\nDry run — nothing written to Supabase.');
    return;
  }

  // Each product's most recent PRIOR Set Value, for the day-over-day guard
  // (mirror of the daily Edge Function): a short window reduced to the latest
  // per product, paginated under a stable order.
  const prevSv = new Map();
  {
    const ids = usable.map((p) => dbByName.get(p.name)?.id).filter(Boolean);
    const since = new Date(new Date(DATE).getTime() - 7 * 864e5).toISOString().slice(0, 10);
    const PAGE = 1000;
    for (let from = 0; ids.length; from += PAGE) {
      const { data, error } = await sb.from('snapshots')
        .select('product_id, set_value, snapshot_date')
        .in('product_id', ids).lt('snapshot_date', DATE).gte('snapshot_date', since)
        .not('set_value', 'is', null)
        .order('snapshot_date', { ascending: false }).order('product_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`reading prior snapshots: ${error.message}`);
      for (const r of data ?? []) { const k = String(r.product_id); if (!prevSv.has(k)) prevSv.set(k, Number(r.set_value)); }
      if (!data || data.length < PAGE) break;
    }
  }

  // Build snapshot rows. Locked products omit `price` (kept as the admin's manual
  // value); everyone gets set_value + low_liquidity.
  const withPrice = [];
  const withoutPrice = [];
  const missing = [];
  const held = [];
  for (const p of usable) {
    const row = dbByName.get(p.name);
    if (!row) { missing.push(p.name); continue; }
    // Day-over-day guard: hold a >50% one-day rise (a mis-tagged-card artefact).
    const g = guardSetValue(p.setValue, prevSv.get(String(row.id)) ?? null);
    if (g.held) held.push(`${p.name} (${Math.round((g.ratio ?? 0) * 100)}% of prev — held at ${g.value})`);
    const base = { user_id: row.user_id, product_id: row.id, snapshot_date: DATE, set_value: g.value, low_liquidity: p.lowLiquidity, price_avg: p.avgPrice, price_low: p.lowPrice, promo_value: p.promoValue };
    if (row.price_locked || p.price == null) withoutPrice.push(base);
    else withPrice.push({ ...base, price: p.price });
  }

  let written = 0;
  for (const [rows, label] of [[withPrice, 'with price'], [withoutPrice, 'set-value only (locked/no-price)']]) {
    if (!rows.length) continue;
    const { error } = await sb.from('snapshots').upsert(rows, { onConflict: 'product_id,snapshot_date' });
    if (error) throw new Error(`upserting snapshots (${label}): ${error.message}`);
    written += rows.length;
    console.log(`  upserted ${rows.length} snapshot(s) — ${label}`);
  }

  console.log(`\nWrote ${written} snapshot(s) for ${DATE} (${withoutPrice.length} price-locked/no-price).`);
  if (held.length) console.warn(`Set Value held (>50% one-day jump — review): ${held.join(', ')}`);
  if (missing.length) console.warn(`Not in Supabase (seed via Data Entry) — skipped: ${missing.join(', ')}`);
}

main().catch((err) => {
  console.error(`\ningest failed: ${err.message}`);
  if (/fetch|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|403|407/.test(err.message)) {
    console.error('The Cardmarket host must be reachable (CI / a dev machine).');
  }
  process.exit(1);
});
