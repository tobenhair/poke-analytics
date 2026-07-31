-- ============================================================
-- Cardmarket daily snapshot — pg_cron schedule
-- ============================================================
-- Makes the ingestion a Supabase-native daily job: pg_cron fires once a day and
-- pg_net (net.http_post) invokes the `cardmarket-daily` Edge Function, which
-- writes today's Price + Set Value snapshot. Run this ONCE in the Supabase SQL
-- editor AFTER deploying the function (`supabase functions deploy cardmarket-daily`)
-- and running the catalog sync at least once (see SUPABASE.md).
--
-- Replace the two placeholders below:
--   <PROJECT_REF>  — your project ref (Dashboard → Settings → General).
--   the Vault step — stores the service_role key so it isn't inlined here.
-- ============================================================

-- 1. Extensions (safe to re-run).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Store the service_role key in Vault so the schedule below can send it as a
--    Bearer token without hard-coding the secret in a cron definition. Run once
--    (Dashboard → Settings → API → service_role key). Re-running rotates it.
--    select vault.create_secret('<SERVICE_ROLE_KEY>', 'cardmarket_service_key');

-- 3. Schedule the daily call. 04:17 UTC — the bulk files refresh overnight.
--    Re-running: unschedule first so this file stays idempotent.
select cron.unschedule('cardmarket-daily')
  where exists (select 1 from cron.job where jobname = 'cardmarket-daily');

select cron.schedule(
  'cardmarket-daily',
  '17 4 * * *',
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/cardmarket-daily',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name = 'cardmarket_service_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $$
);

-- Inspect / manage:
--   select jobname, schedule, active from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 10;
--   select cron.unschedule('cardmarket-daily');   -- to stop it
