// ============================================================
// Cardmarket resolve ids — Supabase Edge Function
// ============================================================
// Fills each product's Cardmarket ids automatically, so the admin never has to
// hand-source idProduct / idExpansion. Triggered from Data Entry's "Resolve ids"
// button (admin-only). For every product that is MISSING a CM ID and/or Exp ID
// it name-matches against Cardmarket's nonsingles catalogue and writes the ids
// back. It only fills NULLs — a manually entered id is never overwritten (edit
// those by hand in Data Entry).
//
// The nonsingles catalogue is small (~5k records), so this one reads it whole;
// the big singles file is only touched by cardmarket-catalog-refresh.
//
// Matching mirrors scripts/cardmarket-lib.mjs (norm / score / the 0.6 threshold),
// which tests/unit/cardmarket-lib.test.mjs pins — keep them in step.
//
// Auth: admin-only, checked against public.is_admin() (the single source of
// truth). Env (auto-injected): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// SUPABASE_ANON_KEY.
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

const NONSINGLES_URL =
  'https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json';
const CONFIDENT = 0.6; // Jaccard threshold — mirrors cardmarket-lib.mjs

const ID_KEYS = ['idProduct', 'idProductLocalized', 'productId', 'id'];
const NAME_KEYS = ['name', 'enName', 'productName', 'locName'];
const EXP_KEYS = ['idExpansion', 'expansionId', 'idExpansionLocalized'];

type Rec = Record<string, unknown>;
const pick = (obj: Rec, keys: string[]): unknown => {
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return null;
};
const toRecords = (json: unknown): Rec[] => {
  if (Array.isArray(json)) return json as Rec[];
  if (json && typeof json === 'object') {
    for (const v of Object.values(json as Rec)) if (Array.isArray(v)) return v as Rec[];
  }
  return [];
};

// Normalise for matching: lowercase, expand abbreviations, drop punctuation,
// singularise, collapse whitespace. (Mirror of cardmarket-lib.mjs `norm`.)
const norm = (s: unknown): string =>
  String(s)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\betb\b/g, 'elite trainer box')
    .replace(/\bbooster display\b/g, 'booster box')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b([a-z]{3,}?)s\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
const tokens = (s: unknown): Set<string> => new Set(norm(s).split(' ').filter(Boolean));
const score = (a: unknown, b: unknown): number => {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  return inter / (A.size + B.size - inter);
};

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

    const { data: products, error: pErr } = await sb
      .from('products')
      .select('id, name, cardmarket_product_id, cardmarket_expansion_id');
    if (pErr) return json({ error: `reading products: ${pErr.message}` }, 500);

    // Only work needed if something is missing.
    const todo = (products ?? []).filter(
      (p) => p.cardmarket_product_id == null || p.cardmarket_expansion_id == null,
    );
    if (!todo.length) return json({ filled: 0, alreadySet: (products ?? []).length, resolved: [] });

    // Fetch + index the (small) nonsingles catalogue.
    const res = await fetch(NONSINGLES_URL);
    if (!res.ok) return json({ error: `nonsingles: HTTP ${res.status}` }, 502);
    const cat = toRecords(JSON.parse(await res.text())).map((r) => ({
      id: pick(r, ID_KEYS),
      name: pick(r, NAME_KEYS),
      expansion: pick(r, EXP_KEYS),
    }));
    const byId = new Map(cat.filter((c) => c.id != null).map((c) => [String(c.id), c]));

    const resolved: Array<Record<string, unknown>> = [];
    const unresolved: Array<Record<string, unknown>> = [];
    let filled = 0;

    for (const p of todo) {
      let idP = p.cardmarket_product_id as number | null;
      let idE = p.cardmarket_expansion_id as number | null;
      let matchScore: number | null = null;

      if (idP == null) {
        // No pin → name-match against the catalogue.
        let best: typeof cat[number] | null = null;
        let bestScore = 0;
        for (const c of cat) {
          if (!c.name) continue;
          const sc = score(p.name, c.name);
          if (sc > bestScore) { bestScore = sc; best = c; }
        }
        if (best && bestScore >= CONFIDENT) {
          idP = Number(best.id);
          if (idE == null && best.expansion != null) idE = Number(best.expansion);
          matchScore = +bestScore.toFixed(2);
        } else {
          unresolved.push({ name: p.name, bestScore: +bestScore.toFixed(2) });
          continue;
        }
      } else if (idE == null) {
        // Pinned product id, missing expansion → look it up in the catalogue.
        const rec = byId.get(String(idP));
        if (rec && rec.expansion != null) idE = Number(rec.expansion);
      }

      // Only write fields that were NULL — never clobber a manual pin.
      const patch: Rec = {};
      if (p.cardmarket_product_id == null && idP != null) patch.cardmarket_product_id = idP;
      if (p.cardmarket_expansion_id == null && idE != null) patch.cardmarket_expansion_id = idE;
      if (!Object.keys(patch).length) continue;

      const { error } = await sb.from('products').update(patch).eq('id', p.id);
      if (error) return json({ error: `updating ${p.name}: ${error.message}` }, 500);
      filled += 1;
      resolved.push({ name: p.name, idProduct: idP, idExpansion: idE, score: matchScore });
    }

    return json({
      filled,
      alreadySet: (products ?? []).length - todo.length,
      resolved,
      unresolved: unresolved.length ? unresolved : undefined,
    });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
