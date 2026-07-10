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

-- ============================================================
-- Row-Level Security — the real security boundary
-- ============================================================
alter table public.products      enable row level security;
alter table public.snapshots     enable row level security;
alter table public.user_settings enable row level security;

-- Each authenticated user may read and write only their own rows. The USING
-- clause filters reads/updates/deletes; WITH CHECK guards inserts/updates so a
-- user cannot write rows attributed to someone else.
drop policy if exists "own products" on public.products;
create policy "own products" on public.products
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own snapshots" on public.snapshots;
create policy "own snapshots" on public.snapshots
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "own settings" on public.user_settings;
create policy "own settings" on public.user_settings
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
