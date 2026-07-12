-- ============================================================
-- Sealed TCG Analytics — price-alert email delivery (optional)
-- ============================================================
-- Emails each user whose FIXED (€ buy-below) price alerts are currently
-- triggered — the latest tracked price has fallen to or below their target —
-- so the 🔔 in the app reaches them even with the page closed. Mirrors the
-- in-app alert flag but runs server-side on a schedule.
--
-- Scope: FIXED alerts only. FAIR (% below fair price) alerts are evaluated in
-- the browser — the fair price depends on the age-fit across all products, a
-- computation that doesn't live in the database — so they stay in-app (the tab
-- and the 🔔 board flag). If fair-price maths is ever moved server-side, extend
-- the WHERE clauses here.
--
-- Reuses the exact pattern proven by staleness-reminder.sql:
--   pg_cron (schedule) + pg_net (outbound HTTP) + Resend (email) + Vault (key).
--
-- ── One-time setup (see SUPABASE.md; same prerequisites as the staleness job) ──
--   1. Dashboard → Database → Extensions: enable `pg_cron` and `pg_net`.
--   2. A verified Resend sending domain + API key.
--   3. Store the key in Vault (once; shared with the staleness job):
--        select vault.create_secret('re_your_key_here', 'resend_api_key');
--   4. Edit `sender` below to a Resend-verified address, then run this file.
--
-- Re-running is safe: CREATE OR REPLACE + unschedule-then-reschedule. Remove with:
--        select cron.unschedule('price-alerts');
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── The check + send ──
-- SECURITY DEFINER so it can read Vault, every user's private alerts, and their
-- auth.users email (bypassing RLS as the owner). NOT exposed to app users —
-- only pg_cron calls it. Each user is emailed only their own triggered alerts.
create or replace function public.check_price_alerts()
returns void
language plpgsql
security definer
set search_path = public, vault, net, auth
as $$
declare
  -- ── settings — edit the sender ──
  sender  text := 'onboarding@resend.dev';  -- a Resend-verified sender

  api_key   text;
  usr       record;
  items     text;
  sent      int := 0;
begin
  select decrypted_secret into api_key
  from vault.decrypted_secrets
  where name = 'resend_api_key';

  if api_key is null then
    raise warning 'price alerts: no "resend_api_key" in Vault — skipping';
    return;
  end if;

  -- The latest non-null price per product, computed once.
  create temporary table if not exists _latest_price on commit drop as
  select distinct on (s.product_id)
         s.product_id, s.price
  from public.snapshots s
  where s.price is not null
  order by s.product_id, s.snapshot_date desc;

  -- One digest email per user who has at least one triggered FIXED alert.
  for usr in
    select distinct a.user_id, u.email
    from public.alerts a
    join auth.users u        on u.id = a.user_id
    join _latest_price lp    on lp.product_id = a.product_id
    where a.alert_type = 'fixed'
      and a.target_price is not null
      and u.email is not null
      and lp.price <= a.target_price
  loop
    select string_agg(
             format('<li><b>%s</b> — now €%s (target €%s)</li>',
                    p.name, round(lp.price), round(a.target_price)),
             '' order by p.name)
      into items
    from public.alerts a
    join public.products p on p.id = a.product_id
    join _latest_price lp  on lp.product_id = a.product_id
    where a.user_id = usr.user_id
      and a.alert_type = 'fixed'
      and a.target_price is not null
      and lp.price <= a.target_price;

    perform net.http_post(
      url     := 'https://api.resend.com/emails',
      headers := jsonb_build_object(
        'Authorization', 'Bearer ' || api_key,
        'Content-Type',  'application/json'
      ),
      body := jsonb_build_object(
        'from',    sender,
        'to',      usr.email,
        'subject', 'Sealed TCG Analytics — a price alert triggered',
        'html',    '<p>These products you''re watching have hit your buy-below target:</p>'
                   || '<ul>' || items || '</ul>'
                   || '<p>Open the dashboard to review before you buy.</p>'
      )
    );
    sent := sent + 1;
  end loop;

  raise notice 'price alerts: sent % email(s)', sent;
end;
$$;

-- App users must never trigger emails; only the scheduler runs this.
revoke execute on function public.check_price_alerts() from public, anon, authenticated;

-- ── Schedule: every Monday at 10:00 UTC (an hour after the staleness nudge) ──
-- Weekly, matching the staleness job's cadence, so a standing bargain reminds a
-- few times rather than every day. A currently-triggered alert re-sends weekly
-- until the price recovers or the alert is removed.
select cron.unschedule('price-alerts')
where exists (select 1 from cron.job where jobname = 'price-alerts');

select cron.schedule(
  'price-alerts',
  '0 10 * * 1',
  $$select public.check_price_alerts();$$
);

-- ── Handy for testing ──
-- Run the check immediately (sends real emails if any alert is triggered now):
--   select public.check_price_alerts();
-- Inspect recent outbound HTTP calls made by pg_net:
--   select * from net._http_response order by created desc limit 5;
