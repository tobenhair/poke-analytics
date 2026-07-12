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
--   user_settings  per-user preferences      (age threshold slider)
-- Derived metrics (age, price/booster, SV/booster, score) are NOT stored — the
-- client recomputes them, exactly as it does for the .xlsx path.
-- ============================================================

-- ── Products: raw facts only ──
create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade default auth.uid(),
  name           text not null,
  type           text not null check (type in ('BOX','ETB','BUNDLE')),
  release        date not null,
  cardmarket_url text,
  created_at     timestamptz not null default now(),
  -- product names are unique per user (matches the app's duplicate-name rule)
  unique (user_id, name)
);

-- ── Snapshots: one Price / Set Value reading per product per date ──
create table if not exists public.snapshots (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade default auth.uid(),
  product_id    uuid not null references public.products(id) on delete cascade,
  snapshot_date date not null,
  price         numeric check (price is null or price >= 0),
  set_value     numeric check (set_value is null or set_value >= 0),
  -- the app upserts on this pair (onConflict: 'product_id,snapshot_date')
  unique (product_id, snapshot_date)
);

create index if not exists snapshots_product_idx on public.snapshots (product_id);

-- ── Per-user settings ──
create table if not exists public.user_settings (
  user_id       uuid primary key references auth.users(id) on delete cascade default auth.uid(),
  age_threshold numeric not null default 1
);

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
-- A signed-in user's buy-target price per product. The dashboard flags a
-- product when its latest tracked price falls to or below target_price; nothing
-- about the "triggered" state is stored — it's derived client-side each load.
create table if not exists public.alerts (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade default auth.uid(),
  product_id   uuid not null references public.products(id) on delete cascade,
  target_price numeric not null check (target_price >= 0),
  created_at   timestamptz not null default now(),
  unique (user_id, product_id)
);
create index if not exists alerts_user_idx on public.alerts (user_id);

-- ============================================================
-- Row-Level Security — the real security boundary
-- ============================================================
alter table public.products      enable row level security;
alter table public.snapshots     enable row level security;
alter table public.user_settings enable row level security;
alter table public.holdings      enable row level security;
alter table public.alerts        enable row level security;

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
