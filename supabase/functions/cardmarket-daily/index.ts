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
//   • Box Price = midpoint of trend and avg, (trend + avg) / 2  (UNLESS locked)
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
// When trend is more than this fraction below avg, use avg instead of the blend
// (mirror of cardmarket-lib.mjs `trendFallbackGap`).
const TREND_FALLBACK_GAP = 0.30;

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

// Day-over-day Set Value guardrail — mirror of scripts/cardmarket-lib.mjs
// guardSetValue (pinned by cardmarket-lib.test.mjs). A Set Value is a sum of
// ~250 singles, so a >50% single-day RISE is almost always a data artefact (one
// mis-tagged high-value card entering the expansion's singles list — the €2.5k
// promo Gengar that 5×'d Sword & Shield). Hold the previous value instead of
// writing the spike; let a FALL through so a fixed artefact self-corrects.
const SV_MAX_DAILY_JUMP = 0.5;
function guardSetValue(newSv: number | null, prevSv: number | null):
  { value: number | null; held: boolean; ratio: number | null } {
  const val = newSv != null && Number.isFinite(Number(newSv)) ? Number(newSv) : null;
  const prev = prevSv != null && Number.isFinite(Number(prevSv)) ? Number(prevSv) : null;
  if (val == null || prev == null || prev <= 0) return { value: val, held: false, ratio: null };
  const ratio = val / prev;
  const held = ratio > 1 + SV_MAX_DAILY_JUMP;
  return { value: held ? prev : val, held, ratio: +ratio.toFixed(4) };
}

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
      .select('id, user_id, name, cardmarket_product_id, cardmarket_expansion_id, cardmarket_promo_product_id, price_locked');
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
      // The bundled promo single is one more id to keep — its price is in the
      // same price_guide file (singles carry avg30), so no extra fetch.
      if (p.cardmarket_promo_product_id != null) needed.add(String(p.cardmarket_promo_product_id));
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

    // 3b. Each product's most recent PRIOR Set Value, for the day-over-day guard.
    //     A short window (daily cadence) reduced to the latest per product;
    //     paginated under a stable total order so a >1000-row window is safe.
    const prevSv = new Map<string, number>();
    {
      const since = new Date(new Date(date).getTime() - 7 * 864e5).toISOString().slice(0, 10);
      const PAGE = 1000;
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb
          .from('snapshots')
          .select('product_id, set_value, snapshot_date')
          .lt('snapshot_date', date).gte('snapshot_date', since)
          .not('set_value', 'is', null)
          .order('snapshot_date', { ascending: false }).order('product_id', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) return json({ error: `reading prior snapshots: ${error.message}` }, 500);
        for (const r of data ?? []) {
          const k = String(r.product_id);
          if (!prevSv.has(k)) prevSv.set(k, Number(r.set_value)); // first seen (desc) = most recent
        }
        if (!data || data.length < PAGE) break;
      }
    }

    // 4. Derive per product.
    const withPrice: Rec[] = [];
    const withoutPrice: Rec[] = [];
    const skipped: string[] = [];
    const held: string[] = [];
    for (const p of products ?? []) {
      const idP = p.cardmarket_product_id;
      if (idP == null) { skipped.push(`${p.name} (no CM id)`); continue; }
      const pgRec = pgById.get(String(idP));

      // Reference prices (avg / low) — stored for review, and (with trend) the
      // basis for the blended Box Price.
      const round2 = (v: number | null) => (v != null && Number.isFinite(v) ? +v.toFixed(2) : null);
      const t = pgRec ? numOrNull(pgRec.trend) : null;
      const a = pgRec ? numOrNull(pgRec.avg) : null;
      const priceAvg = round2(a);
      const priceLow = pgRec ? round2(numOrNull(pgRec.low)) : null;

      // Box Price = midpoint of trend and avg (50/50 blend) — mirror of
      // scripts/cardmarket-lib.mjs. When trend runs far below avg (> TREND_FALLBACK_GAP
      // under it) it's a stale/thin artefact dragging the midpoint down, so use avg
      // instead of the blend. Left null when locked (admin's manual value).
      let price: number | null = null;
      if (!p.price_locked) {
        if (t != null && a != null) {
          price = round2(a > 0 && t < a * (1 - TREND_FALLBACK_GAP) ? a : (t + a) / 2);
        } else if (t != null) price = round2(t);
        else if (a != null) price = round2(a);
      }

      // low_liquidity: trend and avg disagree by ≥20%.
      let lowLiquidity = false;
      if (t != null && a != null) {
        const hi = Math.max(a, t);
        if (hi > 0 && Math.abs(a - t) / hi >= 0.2) lowLiquidity = true;
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

      // Day-over-day guard: a >50% single-day rise is a mis-tagged-card artefact,
      // not a market move — hold the previous value and flag it for review.
      const g = guardSetValue(setValue, prevSv.get(String(p.id)) ?? null);
      if (g.held) {
        held.push(`${p.name} (${Math.round((g.ratio ?? 0) * 100)}% of prev — held at ${g.value})`);
        setValue = g.value;
      }

      // Promo value: the bundled promo single's avg30 (same basis as Set Value),
      // subtracted client-side from Price for the ex-promo pack economics.
      let promoValue: number | null = null;
      if (p.cardmarket_promo_product_id != null) {
        const promoRec = pgById.get(String(p.cardmarket_promo_product_id));
        if (promoRec) {
          const v = valueOf(promoRec, 'avg30');
          if (v != null && Number.isFinite(v)) promoValue = round2(v);
        }
      }

      if (price == null && setValue == null) { skipped.push(`${p.name} (no price or set value)`); continue; }
      const base: Rec = {
        user_id: p.user_id, product_id: p.id, snapshot_date: date,
        set_value: setValue, low_liquidity: lowLiquidity,
        price_avg: priceAvg, price_low: priceLow, promo_value: promoValue,
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
      setValueHeld: held.length ? held : undefined,
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
