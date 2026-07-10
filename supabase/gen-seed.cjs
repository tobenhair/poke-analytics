// Regenerate supabase/seed.sql from a workbook.
//   npm install xlsx
//   node supabase/gen-seed.cjs [path/to/pokemon_data.xlsx]
// Produces a phone-friendly SQL seed (see supabase/seed.sql header) that
// imports every product + snapshot for one account via the Supabase SQL Editor.
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const xlsxPath = process.argv[2] || path.join(__dirname, '..', 'pokemon_data.xlsx');
const outPath = path.join(__dirname, 'seed.sql');

const wb = XLSX.read(fs.readFileSync(xlsxPath), { type: 'buffer', cellDates: true });
const col = (r, ...n) => { for (const k of n) if (r[k] != null) return r[k]; return null; };
const iso = (v) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const num = (v) => (v == null || v === '' ? 'null' : Number(v));

const summary = XLSX.utils.sheet_to_json(wb.Sheets['Summary'], { defval: null });
const hist = XLSX.utils.sheet_to_json(wb.Sheets['Historical Data'], { defval: null });
const links = wb.Sheets['Links'] ? XLSX.utils.sheet_to_json(wb.Sheets['Links'], { defval: null }) : [];

const linkBy = {};
for (const r of links) {
  const n = col(r, 'Product');
  const u = col(r, 'URL', 'Cardmarket URL', 'Link');
  if (n && u && String(u).startsWith('http')) linkBy[String(n).trim()] = String(u).trim();
}

const prodVals = summary.filter((r) => col(r, 'Product')).map((r) => {
  const name = String(col(r, 'Product')).trim();
  const type = String(col(r, 'Type')).toUpperCase();
  const rel = iso(col(r, 'Release Date'));
  const url = linkBy[name] ? q(linkBy[name]) : 'null';
  return `    (uid, ${q(name)}, ${q(type)}, ${q(rel)}, ${url})`;
});

const snapVals = hist.filter((r) => col(r, 'Product') && col(r, 'Snapshot Date')).map((r) => {
  const name = String(col(r, 'Product')).trim();
  const d = iso(col(r, 'Snapshot Date'));
  const p = num(col(r, 'Price (€)', 'Price'));
  const sv = num(col(r, 'Set Value (€)', 'Set Value'));
  return `    (${q(name)}, ${q(d)}, ${p}, ${sv})`;
});

const sql = `-- ============================================================
-- Sealed TCG Analytics — data seed (phone-friendly, no terminal)
-- ------------------------------------------------------------
-- Generated from pokemon_data.xlsx by supabase/gen-seed.cjs. Imports every
-- product + price/value snapshot for ONE account, straight from the Supabase
-- SQL Editor. Safe to re-run: it upserts, so it never creates duplicates.
--
-- BEFORE RUNNING:
--   1. Apply supabase/schema.sql first (creates the tables + RLS).
--   2. Create your account (app sign-up, or Dashboard > Authentication > Add user).
--   3. Put YOUR account email on the marked line below.
-- Then paste this whole file into Dashboard > SQL Editor > New query > Run.
-- ============================================================
do $$
declare uid uuid;
begin
  -- vvv  SET YOUR ACCOUNT EMAIL HERE  vvv
  select id into uid from auth.users where email = 'REPLACE_WITH_YOUR_EMAIL';
  -- ^^^  SET YOUR ACCOUNT EMAIL HERE  ^^^
  if uid is null then
    raise exception 'No auth user found for that email. Create your account first, then set the email above.';
  end if;

  insert into public.products (user_id, name, type, release, cardmarket_url) values
${prodVals.join(',\n')}
  on conflict (user_id, name) do update
    set type = excluded.type,
        release = excluded.release,
        cardmarket_url = coalesce(excluded.cardmarket_url, public.products.cardmarket_url);

  insert into public.snapshots (user_id, product_id, snapshot_date, price, set_value)
  select uid, p.id, v.snapshot_date::date, v.price::numeric, v.set_value::numeric
  from (values
${snapVals.join(',\n')}
  ) as v(name, snapshot_date, price, set_value)
  join public.products p on p.user_id = uid and p.name = v.name
  on conflict (product_id, snapshot_date) do update
    set price = excluded.price, set_value = excluded.set_value;

  raise notice 'Seed complete for user %', uid;
end $$;
`;

fs.writeFileSync(outPath, sql);
console.log(`Wrote ${outPath} — ${prodVals.length} products, ${snapVals.length} snapshots`);
