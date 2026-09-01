// ============================================================
// Delete account — Supabase Edge Function
// ============================================================
// Self-service account deletion (GDPR erasure). Invoked from the app's account
// menu (Delete account → confirm). Deleting an auth user needs the service role
// — a client can't remove its own auth.users row — so this function does it,
// scoped strictly to the CALLER's own account:
//
//   1. It reads the caller's identity from THEIR bearer token (never a user id
//      from the request body), so a user can only ever delete themselves.
//   2. It REFUSES the admin. products/snapshots are admin-owned and every
//      per-user table is `references auth.users(id) on delete cascade`, so
//      deleting the admin would cascade-wipe the whole shared dataset. is_admin()
//      is the single source of truth (same function RLS uses).
//   3. Otherwise it calls auth.admin.deleteUser(uid). The on-delete cascades
//      remove all of that user's private rows (holdings/alerts/sales/purchases/
//      user_settings) automatically; client_errors.user_id is set null.
//
// Env (auto-injected): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY.
// ============================================================

import { createClient } from 'jsr:@supabase/supabase-js@2';

// Browser-invoked → cross-origin, so answer the CORS preflight and echo the
// headers on every response, or the browser blocks the call before it's sent.
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-api-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    const url = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    if (!url || !serviceKey || !anonKey) return json({ error: 'missing service credentials' }, 500);

    // Identify the caller from THEIR token — never from the request body.
    const caller = createClient(url, anonKey, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await caller.auth.getUser();
    const uid = userData?.user?.id;
    if (userErr || !uid) return json({ error: 'not signed in' }, 401);

    // Refuse the admin — deleting them would cascade-delete the shared dataset.
    const { data: isAdmin, error: adminErr } = await caller.rpc('is_admin');
    if (adminErr) return json({ error: 'auth check failed' }, 500);
    if (isAdmin) return json({ error: 'the admin account cannot be deleted from here' }, 403);

    // Delete the caller's own auth user; the FK cascades remove their data.
    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { error: delErr } = await admin.auth.admin.deleteUser(uid);
    if (delErr) return json({ error: delErr.message }, 500);

    return json({ ok: true });
  } catch (e) {
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });
}
