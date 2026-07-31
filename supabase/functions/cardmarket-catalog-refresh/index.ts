// ============================================================
// Cardmarket catalog refresh — Supabase Edge Function
// ============================================================
// The PRECOMPUTE half of the ingestion, now living inside Supabase (no GitHub
// Action). Triggered on demand — the admin enters a product's Cardmarket
// expansion id in Data Entry, saves, then hits "Sync catalog", which invokes
// this function. It caches, per expansion, the single-card idProducts that make
// up Set Value into public.cardmarket_expansion_singles, so the daily
// `cardmarket-daily` function can sum over them without ever loading the huge
// singles file.
//
// Memory: it never JSON.parses the whole bulk file. `streamArray` reads the HTTP
// body chunk by chunk and hands over one top-level object at a time, so memory
// stays bounded to a single record + the (small) result — safe inside the Edge
// runtime's ~256 MB limit regardless of how big the file is.
//
// Only single cards can enter the sum: sealed products (boxes/ETBs/bundles) live
// in the *nonsingles* file, which this never reads — a box's idProduct is not in
// the singles list. As a belt-and-suspenders check the response reports each
// set's card count and its max single price (`avg30`), so a mis-categorised
// sealed item would show up as a box-sized figure instead of silently padding.
//
// Auth: admin-only. The caller's JWT is checked against public.is_admin() (the
// single source of truth for who the admin is). An INGEST_SECRET header is also
// accepted for CLI/cron invocation. Env (auto-injected): SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SINGLES_URL =
  'https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json';
const PRICE_GUIDE_URL =
  'https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json';

// Stream a JSON file shaped like {"...":[ {..}, {..} ]} and call onRecord for
// each top-level array element, holding only one element in memory at a time.
// Assumes array elements are objects (Cardmarket's format) and that no string
// before the array contains a '['.
async function streamArray(url: string, onRecord: (rec: Record<string, unknown>) => void): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let inArray = false, depth = 0, inStr = false, esc = false, obj = '';
  const flush = () => { try { onRecord(JSON.parse(obj)); } catch { /* skip malformed */ } obj = ''; };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    for (let i = 0; i < chunk.length; i++) {
      const c = chunk[i];
      if (!inArray) { if (c === '[') inArray = true; continue; }
      if (depth === 0) {
        if (c === '{') { depth = 1; obj = '{'; }
        else if (c === ']') { inArray = false; }
        continue; // skip commas / whitespace between elements
      }
      obj += c;
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
      } else {
        if (c === '"') inStr = true;
        else if (c === '{') depth++;
        else if (c === '}') { depth--; if (depth === 0) flush(); }
      }
    }
  }
}

const num = (v: unknown): number | null =>
  v != null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null;

Deno.serve(async (req) => {
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!url || !serviceKey) return json({ error: 'missing service credentials' }, 500);

    // Admin gate — is_admin() is the single source of truth (also used by RLS).
    const secret = Deno.env.get('INGEST_SECRET');
    const bySecret = secret && req.headers.get('x-ingest-secret') === secret;
    if (!bySecret) {
      if (!anonKey) return json({ error: 'missing anon key for auth' }, 500);
      const caller = createClient(url, anonKey, {
        global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
        auth: { persistSession: false },
      });
      const { data: isAdmin, error } = await caller.rpc('is_admin');
      if (error || !isAdmin) return json({ error: 'forbidden' }, 403);
    }

    const sb = createClient(url, serviceKey, { auth: { persistSession: false } });

    // Which expansions to cache: an explicit list, else every distinct expansion
    // id on the products table.
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    let wanted: Set<string>;
    if (Array.isArray((body as { expansionIds?: unknown[] }).expansionIds)) {
      wanted = new Set((body as { expansionIds: unknown[] }).expansionIds.map((x) => String(x)));
    } else {
      const { data: prods, error } = await sb.from('products').select('cardmarket_expansion_id');
      if (error) return json({ error: `reading products: ${error.message}` }, 500);
      wanted = new Set(
        (prods ?? []).map((p) => p.cardmarket_expansion_id).filter((x): x is number => x != null).map(String),
      );
    }
    if (!wanted.size) return json({ expansions: 0, cards: 0, note: 'no expansion ids set on products' });

    // 1. Stream the singles file → members per wanted expansion.
    const members = new Map<string, number[]>();
    for (const w of wanted) members.set(w, []);
    await streamArray(SINGLES_URL, (r) => {
      const exp = r.idExpansion ?? r.expansionId ?? r.idExpansionLocalized;
      const id = r.idProduct ?? r.productId ?? r.id;
      if (exp != null && id != null && members.has(String(exp))) members.get(String(exp))!.push(Number(id));
    });

    // 2. Guardrail: max single price per expansion (a box-sized figure here would
    //    reveal a mis-categorised sealed item). Stream the price guide, filtered
    //    to the ids we just collected.
    const idToExp = new Map<string, string>();
    for (const [exp, ids] of members) for (const id of ids) idToExp.set(String(id), exp);
    const maxPrice = new Map<string, number>();
    if (idToExp.size) {
      await streamArray(PRICE_GUIDE_URL, (r) => {
        const id = r.idProduct ?? r.productId ?? r.id;
        if (id == null) return;
        const exp = idToExp.get(String(id));
        if (!exp) return;
        const v = num(r.avg30) ?? num(r.avg) ?? num(r.trend);
        if (v != null) maxPrice.set(exp, Math.max(maxPrice.get(exp) ?? 0, v));
      });
    }

    // 3. Upsert the cache (only expansions we actually found members for).
    const rows = [...members].map(([exp, ids]) => ({
      id_expansion: Number(exp),
      single_product_ids: ids,
      updated_at: new Date().toISOString(),
    }));
    const nonEmpty = rows.filter((r) => r.single_product_ids.length);
    if (nonEmpty.length) {
      const { error } = await sb.from('cardmarket_expansion_singles').upsert(nonEmpty, { onConflict: 'id_expansion' });
      if (error) return json({ error: `upserting catalog: ${error.message}` }, 500);
    }

    const emptyExpansions = rows.filter((r) => !r.single_product_ids.length).map((r) => r.id_expansion);
    return json({
      expansions: nonEmpty.length,
      cards: rows.reduce((n, r) => n + r.single_product_ids.length, 0),
      perSet: nonEmpty.map((r) => ({
        expansion: r.id_expansion,
        cards: r.single_product_ids.length,
        maxSinglePrice: maxPrice.get(String(r.id_expansion)) ?? null,
      })),
      emptyExpansions: emptyExpansions.length ? emptyExpansions : undefined,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
