// ============================================================
// One-time migration: pokemon_data.xlsx  →  your Supabase account
// ============================================================
// Seeds the products + snapshots tables for a single signed-in user from the
// existing workbook, so you don't have to re-enter history by hand. Safe to
// re-run: products upsert on (user_id, name) and snapshots on
// (product_id, snapshot_date), so repeats update rather than duplicate.
//
// Usage:
//   npm install @supabase/supabase-js xlsx
//   SUPABASE_URL="https://xxxx.supabase.co" \
//   SUPABASE_ANON_KEY="your-anon-key" \
//   MIGRATE_EMAIL="you@example.com" \
//   MIGRATE_PASSWORD="your-password" \
//   node supabase/migrate-xlsx.mjs [path/to/pokemon_data.xlsx]
//
// The account must already exist (sign up once in the app or the Supabase
// dashboard) and the schema in supabase/schema.sql must have been applied.
// ============================================================

import { createClient } from '@supabase/supabase-js';
import * as XLSX from 'xlsx';
import { readFileSync } from 'node:fs';

const { SUPABASE_URL, SUPABASE_ANON_KEY, MIGRATE_EMAIL, MIGRATE_PASSWORD } = process.env;
const XLSX_PATH = process.argv[2] || 'pokemon_data.xlsx';

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_ANON_KEY, MIGRATE_EMAIL, MIGRATE_PASSWORD })) {
  if (!v) { console.error(`Missing env var ${k}`); process.exit(1); }
}

// Read the same first-match-wins column helper the app uses.
const col = (row, ...names) => {
  for (const n of names) if (row[n] != null) return row[n];
  return null;
};
const toISO = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

const wb = XLSX.read(readFileSync(XLSX_PATH), { type: 'buffer', cellDates: true });
const summary = XLSX.utils.sheet_to_json(wb.Sheets['Summary'], { defval: null });
const history = XLSX.utils.sheet_to_json(wb.Sheets['Historical Data'], { defval: null });
const links   = wb.Sheets['Links'] ? XLSX.utils.sheet_to_json(wb.Sheets['Links'], { defval: null }) : [];

const linkByName = {};
for (const r of links) {
  const name = col(r, 'Product');
  const url  = col(r, 'URL', 'Cardmarket URL', 'Link');
  if (name && url && String(url).startsWith('http')) linkByName[String(name).trim()] = String(url).trim();
}

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const { error: authErr } = await sb.auth.signInWithPassword({ email: MIGRATE_EMAIL, password: MIGRATE_PASSWORD });
if (authErr) { console.error('Sign-in failed:', authErr.message); process.exit(1); }
const { data: { user } } = await sb.auth.getUser();
console.log(`Signed in as ${user.email} (${user.id})`);

// 1. Upsert products, capturing name → id.
const productRows = summary
  .filter((r) => col(r, 'Product'))
  .map((r) => ({
    name: String(col(r, 'Product')).trim(),
    type: String(col(r, 'Type')).toUpperCase(),
    release: toISO(col(r, 'Release Date')),
    cardmarket_url: linkByName[String(col(r, 'Product')).trim()] || null,
    user_id: user.id,
  }));

const { data: upserted, error: prodErr } = await sb
  .from('products')
  .upsert(productRows, { onConflict: 'user_id,name' })
  .select('id,name');
if (prodErr) { console.error('Product upsert failed:', prodErr.message); process.exit(1); }
const idByName = Object.fromEntries(upserted.map((p) => [p.name, p.id]));
console.log(`Upserted ${upserted.length} products`);

// 2. Upsert snapshots.
const snapshotRows = [];
for (const r of history) {
  const name = col(r, 'Product');
  const date = col(r, 'Snapshot Date');
  if (!name || !date) continue;
  const id = idByName[String(name).trim()];
  if (!id) continue;
  const price = col(r, 'Price (€)', 'Price');
  const sv    = col(r, 'Set Value (€)', 'Set Value');
  snapshotRows.push({
    product_id: id,
    snapshot_date: toISO(date),
    price: price != null ? Number(price) : null,
    set_value: sv != null ? Number(sv) : null,
    user_id: user.id,
  });
}

const { error: snapErr } = await sb
  .from('snapshots')
  .upsert(snapshotRows, { onConflict: 'product_id,snapshot_date' });
if (snapErr) { console.error('Snapshot upsert failed:', snapErr.message); process.exit(1); }
console.log(`Upserted ${snapshotRows.length} snapshot rows`);

console.log('✓ Migration complete. Reload the dashboard and sign in to see your data.');
