-- ============================================================
-- Sealed TCG Analytics — Supabase schema
-- ============================================================
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query)
-- for the project whose URL + anon key you put into window.SUPABASE_CONFIG in
-- index.html. This creates the per-user data model and the Row-Level Security
-- policies that are the ACTUAL access boundary — the anon key shipped in the
-- client grants nothing on its own; every row is scoped to auth.uid().
--
-- Data model (mirrors the app's in-memory structures):
--   products       raw product facts        (was the Summary sheet + Links sheet)
--   snapshots      one row per product/date  (was Historical Data; normalised)
--   user_settings  per-user preferences      (age threshold slider, portfolio currency)
-- Derived metrics (age, price/booster, SV/booster, score) are NOT stored — the
-- client recomputes them, exactly as it does for the .xlsx path.
-- ============================================================

-- ── Products: raw facts only ──
create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name           text not null,
  type           text not null check (type in ('BOX','ETB','ETB10','ETB8','BUNDLE','BUNDLEDISPLAY','PACK')),
  release        date not null,
  cardmarket_url text,
  -- Cardmarket catalogue product id (idProduct) for the automated ingestion job.
  -- When set, the job resolves this product's price/Set Value directly from it
  -- (no name matching); the expansion id for the singles sum is derived from the
  -- catalogue. Entered/edited by the admin in Data Entry. NULL → the job falls
  -- back to matching by name.
  cardmarket_product_id bigint,
  -- Cardmarket expansion id (idExpansion) for the Set Value singles sum.
  -- Precomputed by the occasional catalog-sync step (scripts/cardmarket-ingest
  -- --refresh-catalog) from cardmarket_product_id, so the daily Edge Function
  -- never has to load the huge singles bulk file to find it. NULL → Set Value is
  -- skipped until the catalog sync runs.
  cardmarket_expansion_id bigint,
  -- When true, the automated Cardmarket ingestion job leaves this product's
  -- Price alone (the admin sets it by hand in Data Entry) — the manual override
  -- for thin-liquidity products whose sales-based price is unreliable. Set Value
  -- is still auto-updated. Written by the admin only (see RLS below).
  price_locked   boolean not null default false,
  -- Cardmarket catalogue product id (idProduct) of a promo card bundled into the
  -- product (e.g. an ETB's stamped promo) that is NOT part of the set's singles.
  -- The daily ingestion job fetches this single card's own moving price (avg30,
  -- the same basis as Set Value) and writes it to snapshots.promo_value, which is
  -- then subtracted from Price for the pack economics (Price/Booster, SV/Booster,
  -- fair price) so an ETB is judged on its boosters, not the extras. Entered by
  -- the admin in Data Entry. NULL → no promo tracked. (Replaced the old static
  -- products.promo_value: a promo card's value moves over time, so a hand-typed
  -- number went stale — see snapshots.promo_value.)
  cardmarket_promo_product_id bigint,
  created_at     timestamptz not null default now(),
  -- product names are unique per user (matches the app's duplicate-name rule)
  unique (user_id, name)
);
-- Idempotent adds for deployments created before these columns existed.
alter table public.products add column if not exists cardmarket_product_id bigint;
alter table public.products add column if not exists cardmarket_expansion_id bigint;
alter table public.products add column if not exists price_locked boolean not null default false;
alter table public.products add column if not exists cardmarket_promo_product_id bigint;
-- The promo value is now a fetched per-snapshot figure (snapshots.promo_value),
-- not a static per-product number, so the old column is retired. Dropping it
-- discards any hand-entered promo €; re-enter each promo's Cardmarket id in Data
-- Entry so the daily job can price it live.
alter table public.products drop column if exists promo_value;
-- Widen the Type check to the pack-count variants (ETB10/ETB8/BUNDLEDISPLAY/PACK)
-- for deployments created before they existed. Drop + re-add so it's idempotent.
alter table public.products drop constraint if exists products_type_check;
alter table public.products add constraint products_type_check
  check (type in ('BOX','ETB','ETB10','ETB8','BUNDLE','BUNDLEDISPLAY','PACK'));

-- ── Snapshots: one Price / Set Value reading per product per date ──
create table if not exists public.snapshots (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade default auth.uid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  snapshot_date date not null,
  price         numeric check (price is null or price >= 0),
  set_value     numeric check (set_value is null or set_value >= 0),
  -- Advisory flag set by the ingestion job when the Cardmarket sales-based price
  -- is unreliable (thin liquidity: the guide's trend and avg disagree sharply).
  -- The client can badge it and the fair-price fit can down-weight it; never a
  -- hard gate.
  low_liquidity boolean not null default false,
  -- Reference prices from the same Cardmarket guide row the price (=trend) came
  -- from: `avg` and `low`. Stored so Data Entry can show the spread on a
  -- low-liquidity row (e.g. "auto €5,580 · avg €2,100 · low €1,850"), making the
  -- manual-review / price-lock decision data-driven. Not used in any derived
  -- metric — display only.
  price_avg     numeric check (price_avg is null or price_avg >= 0),
  price_low     numeric check (price_low is null or price_low >= 0),
  -- Fetched value (€) of the product's bundled promo card on this date — the
  -- avg30 of products.cardmarket_promo_product_id from the same Cardmarket guide.
  -- Subtracted from Price for the ex-promo pack economics. NULL when the product
  -- has no promo id or the card had no price that day.
  promo_value   numeric check (promo_value is null or promo_value >= 0),
  -- the app upserts on this pair (onConflict: 'product_id,snapshot_date')
  unique (product_id, snapshot_date)
);
-- Idempotent adds for deployments created before these columns existed.
alter table public.snapshots add column if not exists low_liquidity boolean not null default false;
alter table public.snapshots add column if not exists price_avg numeric check (price_avg is null or price_avg >= 0);
alter table public.snapshots add column if not exists price_low numeric check (price_low is null or price_low >= 0);
alter table public.snapshots add column if not exists promo_value numeric check (promo_value is null or promo_value >= 0);

create index if not exists snapshots_product_idx on public.snapshots (product_id);

-- ── Cardmarket catalog cache: expansion → its single-card ids ──
-- The precompute half of the "precompute + Edge Function" ingestion split. The
-- occasional catalog-sync step (scripts/cardmarket-ingest --refresh-catalog,
-- run in a memory-rich environment) reads Cardmarket's large products_singles
-- bulk file once and stores, per tracked expansion, the list of single-card
-- idProducts that make up its Set Value. The DAILY Supabase Edge Function then
-- only needs the much smaller price_guide file: it reads these id lists from the
-- DB and sums avg30 over them — so it never loads the huge singles file and
-- stays inside the Edge runtime's ~256 MB memory limit. Written by the
-- service-role catalog-sync job (bypasses RLS); the browser app never reads it.
create table if not exists public.cardmarket_expansion_singles (
  id_expansion       bigint primary key,
  single_product_ids bigint[] not null,
  updated_at         timestamptz not null default now()
);

-- ── Excluded singles ──
-- idProducts Cardmarket tags to a tracked expansion but that must NEVER be
-- summed into a Set Value (a mis-tagged high-value card — the real case: a promo
-- Gengar idProduct 895476, ~€2,500, wrongly tagged to the Sword & Shield base
-- expansion, which 5×'d that set's value). The catalog refresh drops these
-- before caching, so a re-sync can't re-add them (RLS below; the service-role
-- daily/refresh jobs bypass RLS).
create table if not exists public.cardmarket_excluded_singles (
  id_product bigint primary key,
  reason     text,
  created_at timestamptz not null default now()
);

-- ── Per-user settings ──
create table if not exists public.user_settings (
  user_id       uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  age_threshold numeric not null default 1,
  currency      text not null default 'EUR'   -- display currency for the Portfolio tab (€ is canonical)
);
-- Idempotent add for deployments created before the currency column existed
-- (create table if not exists above won't alter an existing table).
alter table public.user_settings add column if not exists currency text not null default 'EUR';

-- ── Per-user portfolio holdings (private) ──
-- What a signed-in user owns: quantity + per-unit cost basis (€ paid per box /
-- ETB / bundle). Current value and unrealised P&L are derived client-side from
-- the shared product's latest price — nothing derived is stored here.
create table if not exists public.holdings (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  quantity    numeric not null default 1 check (quantity >= 0),
  cost_basis  numeric not null check (cost_basis >= 0),
  created_at  timestamptz not null default now(),
  unique (user_id, product_id)
);
create index if not exists holdings_user_idx on public.holdings (user_id);

-- ── Per-user price alerts (private) ──
-- A signed-in user's buy target per product, of one of two kinds:
--   * FIXED — a euro price: trigger when the latest price ≤ target_price.
--   * FAIR  — a percentage: trigger when the latest price is ≥ below_pct% under
--             the product's fair price. Fair price is computed in-browser (it
--             depends on the age-fit across all products), so fair alerts are
--             evaluated client-side only — the 🔔 board flag and this tab. The
--             server-side email job (alert-emails.sql) covers FIXED alerts only,
--             for the same reason.
-- Nothing about the "triggered" state is stored — it's derived client-side.
create table if not exists public.alerts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade default auth.uid(),
  product_id   uuid not null references public.products(id) on delete cascade,
  alert_type   text not null default 'fixed' check (alert_type in ('fixed','fair')),
  target_price numeric check (target_price is null or target_price >= 0),   -- FIXED alerts
  below_pct    numeric check (below_pct is null or (below_pct > 0 and below_pct <= 90)), -- FAIR alerts
  created_at   timestamptz not null default now(),
  unique (user_id, product_id),
  -- each kind carries exactly the field it needs
  constraint alerts_type_fields_chk check (
    (alert_type = 'fixed' and target_price is not null) or
    (alert_type = 'fair'  and below_pct    is not null)
  )
);
create index if not exists alerts_user_idx on public.alerts (user_id);

-- Migrate an existing alerts table (pre-fair-price alerts) in place. Safe to
-- re-run: every step is guarded. `create table if not exists` above does NOT
-- alter an existing table, so these carry old installs forward.
alter table public.alerts add column if not exists alert_type text not null default 'fixed'
  check (alert_type in ('fixed','fair'));
alter table public.alerts add column if not exists below_pct numeric
  check (below_pct is null or (below_pct > 0 and below_pct <= 90));
alter table public.alerts alter column target_price drop not null;
alter table public.alerts drop constraint if exists alerts_type_fields_chk;
alter table public.alerts add constraint alerts_type_fields_chk check (
  (alert_type = 'fixed' and target_price is not null) or
  (alert_type = 'fair'  and below_pct    is not null)
);

-- ── Client error reports (error monitoring beacon) ──
-- Runtime errors reported by the page (window.onerror / unhandledrejection /
-- explicit catches) so a silent failure in a scoring or load path is visible
-- to the admin instead of dying in a toast. Write-only telemetry: anyone
-- (including logged-out demo visitors) may INSERT, only the admin may read,
-- nobody can update or delete via the API. The client hard-caps reports at 10
-- per session and dedupes messages; the length checks bound abuse.
create table if not exists public.client_errors (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  user_id    uuid references auth.users(id) on delete set null,
  message    text not null check (char_length(message) <= 500),
  stack      text check (char_length(stack) <= 2000),
  url        text check (char_length(url) <= 300),
  user_agent text check (char_length(user_agent) <= 300),
  context    text check (char_length(context) <= 100)
);
create index if not exists client_errors_created_idx on public.client_errors (created_at desc);

-- News feed (Pokémon TCG / investing / business). Written only by the
-- service-role `news-fetch` Edge Function (browsers can't fetch third-party RSS
-- — no CORS), read by everyone including logged-out demo visitors. Only
-- headline + link + source + timestamp is stored, never article bodies. `url`
-- is unique so the ingest upserts idempotently and dedupes across sources.
create table if not exists public.news (
  id           bigint generated always as identity primary key,
  source       text not null check (char_length(source) <= 80),
  category     text not null check (category in ('tcg', 'investing', 'business')),
  title        text not null check (char_length(title) <= 400),
  url          text not null unique check (char_length(url) <= 600),
  published_at timestamptz,
  fetched_at   timestamptz not null default now()
);
create index if not exists news_published_idx on public.news (published_at desc nulls last);

-- ============================================================
-- Row-Level Security — the real security boundary
-- ============================================================
alter table public.products      enable row level security;
alter table public.snapshots     enable row level security;
alter table public.user_settings enable row level security;
alter table public.holdings      enable row level security;
alter table public.alerts        enable row level security;
alter table public.client_errors enable row level security;
alter table public.cardmarket_expansion_singles enable row level security;
alter table public.cardmarket_excluded_singles enable row level security;
alter table public.news enable row level security;
-- No client policy on cardmarket_expansion_singles: the catalog cache is
-- ingestion infrastructure written by the service-role catalog-sync job (which
-- bypasses RLS) and read by the service-role daily Edge Function. With RLS on
-- and no policy, no anon/authenticated client can touch it — exactly what we
-- want. cardmarket_excluded_singles is admin-managed (policies below the
-- is_admin() definition), also read by the service-role jobs.

-- Shared-dataset model:
--   * Product data (products + snapshots) is READ by any signed-in user, but
--     WRITTEN only by the admin — the single account allowed to add/edit data.
--   * user_settings stays private per user (each viewer's own age threshold).
--
-- The admin is identified by user UUID. Set it once below (find it under
-- Dashboard > Authentication > Users > your user > "User UID"). Re-running this
-- whole file is safe — every policy is dropped first.
--
-- Re-running note: this replaces the earlier per-user "own products/snapshots"
-- policies, so existing product rows (all owned by the admin) become readable
-- by every signed-in user while writes stay locked to the admin.

-- 👇 SET YOUR ADMIN USER UUID HERE 👇
-- (used by the write policies below)
create or replace function public.is_admin() returns boolean
  language sql stable as $$
    select auth.uid() = 'bba57af1-bf76-4034-8aba-cc3884df373c'::uuid
  $$;

-- ── products: read = any signed-in user; write = admin only ──
drop policy if exists "own products" on public.products;
drop policy if exists "read products" on public.products;
drop policy if exists "admin writes products" on public.products;
create policy "read products" on public.products
  for select to authenticated using (true);
create policy "admin writes products" on public.products
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ── cardmarket_excluded_singles: admin-managed (service-role jobs bypass RLS) ──
drop policy if exists "excluded singles read (admin)" on public.cardmarket_excluded_singles;
create policy "excluded singles read (admin)" on public.cardmarket_excluded_singles
  for select using (public.is_admin());
drop policy if exists "excluded singles write (admin)" on public.cardmarket_excluded_singles;
create policy "excluded singles write (admin)" on public.cardmarket_excluded_singles
  for all using (public.is_admin()) with check (public.is_admin());

-- ── snapshots: read = any signed-in user; write = admin only ──
drop policy if exists "own snapshots" on public.snapshots;
drop policy if exists "read snapshots" on public.snapshots;
drop policy if exists "admin writes snapshots" on public.snapshots;
create policy "read snapshots" on public.snapshots
  for select to authenticated using (true);
create policy "admin writes snapshots" on public.snapshots
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());
-- Note: the automated Cardmarket ingestion job writes products/snapshots with
-- the SERVICE-ROLE key, which bypasses RLS — so it needs no policy here. It sets
-- user_id to the admin UUID to keep every product row owned by the admin (what
-- the shared-read policies above assume). `products.price_locked` is written by
-- the admin through Data Entry, covered by "admin writes products" above.

-- ── user_settings: each user reads/writes only their own row ──
drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── holdings: each user reads/writes only their own portfolio ──
drop policy if exists "own holdings" on public.holdings;
create policy "own holdings" on public.holdings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── alerts: each user reads/writes only their own price alerts ──
drop policy if exists "own alerts" on public.alerts;
create policy "own alerts" on public.alerts
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ── client_errors: anyone may report, only the admin may read ──
-- No update/delete policies: rows are immutable via the API. A reporter may
-- attach their own user_id or none — never someone else's.
drop policy if exists "report errors" on public.client_errors;
create policy "report errors" on public.client_errors
  for insert to anon, authenticated
  with check (user_id is null or user_id = auth.uid());
drop policy if exists "admin reads errors" on public.client_errors;
create policy "admin reads errors" on public.client_errors
  for select to authenticated using (public.is_admin());

-- ============================================================
-- Public demo — anonymous (logged-out) read of the latest sets only
-- ============================================================
-- The pre-login demo shows the 3 most recent release-date "sets". These policies
-- expose ONLY those rows to the anon role; everything else still requires login.
-- The set of demo product ids comes from a SECURITY DEFINER function so the
-- subquery bypasses RLS (no recursion) and anon can't widen it.

create or replace function public.demo_product_ids()
  returns setof uuid
  language sql stable security definer set search_path = public as $$
    select id from public.products
    where release in (
      select distinct release from public.products order by release desc limit 3
    )
  $$;

drop policy if exists "demo read products" on public.products;
create policy "demo read products" on public.products
  for select to anon
  using (id in (select public.demo_product_ids()));

drop policy if exists "demo read snapshots" on public.snapshots;
create policy "demo read snapshots" on public.snapshots
  for select to anon
  using (product_id in (select public.demo_product_ids()));

-- ── news: public read (anon + signed-in), writes only via service role ──
-- The whole feed is public (it's a companion to the demo/landing), so both the
-- anon and authenticated roles may SELECT everything. There is deliberately NO
-- insert/update/delete policy: the `news-fetch` Edge Function runs with the
-- service_role key, which bypasses RLS, so no client can write — and with RLS
-- on and no write policy, none can.
drop policy if exists "read news" on public.news;
create policy "read news" on public.news
  for select to anon, authenticated using (true);
