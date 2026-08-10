-- ============================================================
-- News feed — pg_cron schedule
-- ============================================================
-- Browsers can't fetch third-party RSS (no CORS), so ingestion is a Supabase-
-- native job: pg_cron fires hourly and pg_net (net.http_post) invokes the
-- `news-fetch` Edge Function, which parses the feeds and upserts public.news.
-- The client only reads that table. Run this ONCE in the Supabase SQL editor
-- AFTER deploying the function (`supabase functions deploy news-fetch`).
--
-- Replace <PROJECT_REF> (Dashboard → Settings → General). The service_role key
-- is read from Vault (create it once, as for the Cardmarket job — reuse the same
-- secret name if you prefer). Hourly is plenty and stays well clear of Reddit /
-- Google News rate limits.
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store the service_role key in Vault (run once; re-running rotates it):
--   select vault.create_secret('<SERVICE_ROLE_KEY>', 'news_service_key');

-- Idempotent (unschedule first so this file can be re-run).
select cron.unschedule('news-fetch')
  where exists (select 1 from cron.job where jobname = 'news-fetch');

select cron.schedule(
  'news-fetch',
  '7 * * * *',   -- hourly, at :07
  $$
  select net.http_post(
    url := 'https://<PROJECT_REF>.supabase.co/functions/v1/news-fetch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' ||
        (select decrypted_secret from vault.decrypted_secrets where name = 'news_service_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $$
);
