// ============================================================
// Cardmarket daily snapshot — Supabase Edge Function
// ============================================================
// The DAILY half of the "precompute + Edge Function" ingestion split. It runs
// inside Supabase (scheduled by pg_cron → pg_net, see supabase/cardmarket-cron.sql)
// and writes today's Price + Set Value snapshot for every tracked product.
//
// Why it stays inside the Edge runtime's ~256 MB memory limit: it does NOT load
// Cardmarket's huge products_singles bulk file. The occasional catalog-sync step
// (scripts/cardmarket-ingest.mjs --refresh-catalog, run where memory is plentiful)
// has already stored, per expansion, the list of single-card idProducts in
// public.cardmarket_expansion_singles, and each product's cardmarket_expansion_id.
// So the daily job only fetches the smaller price_guide file and, as it parses,
// keeps ONLY the rows whose idProduct we actually need (the products + their
// singles) — bounding memory to the tracked set, not the whole catalogue.
//
// Derivation (identical to scripts/cardmarket-lib.mjs, pinned by its unit test):
//   • Box Price = price_guide[idProduct].trend  (UNLESS products.price_locked)
//   • Set Value = Σ price_guide[single].avg30 over the expansion's singles
//   • low_liquidity = |avg − trend| / max(avg, trend) ≥ 0.2  (thin-volume flag)
//
// Env (auto-injected by Supabase): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Optional INGEST_SECRET — when set, the caller must send it as x-ingest-secret.
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const PRICE_GUIDE_URL =
  'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json';

// Field-name candidates (mirror scripts/cardmarket-lib.mjs FIELD_ALIASES).
const ID_KEYS = ['idProduct', 'idProductLocalized', 'productId', 'id'];
const PRICE_FALLBACK = ['trend', 'avg', 'avg7', 'avg30', 'low', 'll'];

type Rec = Record<string, unknown>;

const pick = (obj: Rec, keys: string[]): unknown => {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
};
const numOrNull = (v: unknown): number | null =>
  v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;
// Value of a record for a chosen field, falling back through the price aliases
// when that field is empty (e.g. sealed products have no avg30).
const valueOf = (rec: Rec, field: string): number | null => {
  const chosen = rec[field];
  if (chosen != null && chosen !== '') return Number(chosen);
  return numOrNull(pick(rec, PRICE_FALLBACK));
};

// Unwrap the bulk file into its records array regardless of the wrapper key.
const toRecords = (json: unknown): Rec[] => {
  if (Array.isArray(json)) return json as Rec[];
  if (json && typeof json === 'object') {
    for (const v of Object.values(json as Rec)) if (Array.isArray(v)) return v as Rec[];
  }
  return [];
};

// Invoked server-side by pg_cron (no CORS needed there), but answer the preflight
// and echo CORS headers anyway so a manual browser/dashboard invoke also works.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ingest-secret, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const secret = Deno.env.get('INGEST_SECRET');
    if (secret && req.headers.get('x-ingest-secret') !== secret) {
      return json({ error: 'forbidden' }, 403);
    }

    const url = Deno.env.get('SUPABASE_URL');
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) return json({ error: 'missing service credentials' }, 500);
    const sb = createClient(url, key, { auth: { persistSession: false } });

    // Today's date (UTC) unless overridden (?date=YYYY-MM-DD, for backfills).
    const date = new URL(req.url).searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

    // 1. The tracked set + precomputed catalog (both tiny — from the DB).
    const { data: products, error: pErr } = await sb
      .from('products')
      .select('id, user_id, name, cardmarket_product_id, cardmarket_expansion_id, price_locked');
    if (pErr) return json({ error: `reading products: ${pErr.message}` }, 500);

    const expIds = [...new Set(
      (products ?? []).map((p) => p.cardmarket_expansion_id).filter((x): x is number => x != null),
    )];
    const singlesByExp = new Map<string, number[]>();
    if (expIds.length) {
      const { data: cat, error: cErr } = await sb
        .from('cardmarket_expansion_singles')
        .select('id_expansion, single_product_ids')
        .in('id_expansion', expIds);
      if (cErr) return json({ error: `reading catalog: ${cErr.message}` }, 500);
      for (const row of cat ?? []) singlesByExp.set(String(row.id_expansion), row.single_product_ids ?? []);
    }

    // 2. The set of price-guide ids we actually need: every product id + every
    //    single id across the tracked expansions. Everything else is discarded
    //    as we parse, so memory stays bounded to this set.
    const needed = new Set<string>();
    for (const p of products ?? []) {
      if (p.cardmarket_product_id != null) needed.add(String(p.cardmarket_product_id));
    }
    for (const ids of singlesByExp.values()) for (const id of ids) needed.add(String(id));

    // 3. Fetch + parse the price guide, keeping only needed rows. (JSON.parse
    //    peaks at the file size briefly; the retained map is only the tracked
    //    set. If a future catalogue outgrows the limit, switch to a streaming
    //    JSON parser here — the rest of the function is already id-filtered.)
    const res = await fetch(PRICE_GUIDE_URL);
    if (!res.ok) return json({ error: `price guide: HTTP ${res.status}` }, 502);
    const pgById = new Map<string, Rec>();
    for (const r of toRecords(JSON.parse(await res.text()))) {
      const id = pick(r, ID_KEYS);
      if (id != null && needed.has(String(id))) pgById.set(String(id), r);
    }

    // 4. Derive per product.
    const withPrice: Rec[] = [];
    const withoutPrice: Rec[] = [];
    const skipped: string[] = [];
    for (const p of products ?? []) {
      const idP = p.cardmarket_product_id;
      if (idP == null) { skipped.push(`${p.name} (no CM id)`); continue; }
      const pgRec = pgById.get(String(idP));

      // Box Price (trend), left null when locked (admin keeps the manual value).
      let price: number | null = null;
      if (!p.price_locked && pgRec) {
        const v = valueOf(pgRec, 'trend');
        price = v != null && Number.isFinite(v) ? +v.toFixed(2) : null;
      }

      // Reference prices (avg / low from the same guide row) — stored for the
      // Data Entry low-liquidity review UI (display only).
      const round2 = (v: number | null) => (v != null && Number.isFinite(v) ? +v.toFixed(2) : null);
      const priceAvg = pgRec ? round2(numOrNull(pgRec.avg)) : null;
      const priceLow = pgRec ? round2(numOrNull(pgRec.low)) : null;

      // low_liquidity: trend and avg disagree by ≥20%.
      let lowLiquidity = false;
      if (pgRec) {
        const t = numOrNull(pgRec.trend);
        const a = numOrNull(pgRec.avg);
        if (t != null && a != null) {
          const hi = Math.max(a, t);
          if (hi > 0 && Math.abs(a - t) / hi >= 0.2) lowLiquidity = true;
        }
      }

      // Set Value: Σ avg30 over the expansion's singles.
      let setValue: number | null = null;
      const singles = p.cardmarket_expansion_id != null
        ? singlesByExp.get(String(p.cardmarket_expansion_id)) ?? []
        : [];
      if (singles.length) {
        let sum = 0, counted = 0;
        for (const sid of singles) {
          const rec = pgById.get(String(sid));
          if (!rec) continue;
          const v = valueOf(rec, 'avg30');
          if (v != null && Number.isFinite(v)) { sum += v; counted += 1; }
        }
        if (counted) setValue = +sum.toFixed(2);
      }

      if (price == null && setValue == null) { skipped.push(`${p.name} (no price or set value)`); continue; }
      const base: Rec = {
        user_id: p.user_id, product_id: p.id, snapshot_date: date,
        set_value: setValue, low_liquidity: lowLiquidity,
        price_avg: priceAvg, price_low: priceLow,
      };
      if (price == null) withoutPrice.push(base);
      else withPrice.push({ ...base, price });
    }

    // 5. Upsert (locked/no-price rows omit price so the manual value stands).
    let written = 0;
    for (const rows of [withPrice, withoutPrice]) {
      if (!rows.length) continue;
      const { error } = await sb.from('snapshots').upsert(rows, { onConflict: 'product_id,snapshot_date' });
      if (error) return json({ error: `upserting snapshots: ${error.message}` }, 500);
      written += rows.length;
    }

    return json({
      date, written,
      priceLockedOrNoPrice: withoutPrice.length,
      skipped: skipped.length ? skipped : undefined,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json', ...CORS },
  });
}
