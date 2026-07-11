-- ============================================================
-- Sealed TCG Analytics — data-staleness email reminder (optional)
-- ============================================================
-- Emails you when the newest price snapshot is older than a threshold, so a
-- forgotten monthly update doesn't quietly go stale. This mirrors the in-app
-- staleness flag (STALE_DAYS = 30 in index.html) but runs server-side on a
-- schedule, independent of anyone having the page open.
--
-- Pieces: pg_cron (schedule) + pg_net (outbound HTTP) + Resend (email) +
-- Supabase Vault (stores the Resend API key — never hard-code it here).
--
-- ── One-time setup (do these first; see SUPABASE.md for the walkthrough) ──
--   1. Dashboard → Database → Extensions: enable `pg_cron` and `pg_net`.
--   2. Create a free Resend account, verify a sending domain, get an API key.
--   3. Store the key in Vault (Dashboard → Project Settings → Vault, or SQL):
--        select vault.create_secret('re_your_key_here', 'resend_api_key');
--   4. Edit the three settings in the function below (recipient, sender,
--      threshold), then run this whole file in the SQL Editor.
--
-- Re-running is safe: the function is CREATE OR REPLACE and the schedule is
-- unscheduled-then-rescheduled. To remove it entirely:
--        select cron.unschedule('staleness-reminder');
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── The check + send ──
-- SECURITY DEFINER so it can read Vault and see all snapshot rows (bypassing
-- RLS as the owner). It is NOT exposed to app users — only pg_cron calls it.
create or replace function public.check_data_staleness()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  -- ── settings — edit these three ──
  recipient text := 'tobias.grundstrom@outlook.com';   -- who gets reminded
  sender    text := 'Sealed TCG Analytics <reminders@yourdomain.com>'; -- a Resend-verified sender
  threshold int  := 30;                                -- days; matches the app's STALE_DAYS

  latest    date;
  days_old  int;
  api_key   text;
begin
  select max(snapshot_date) into latest from public.snapshots;

  -- No data yet, or still fresh → nothing to do.
  if latest is null then
    return;
  end if;

  days_old := current_date - latest;
  if days_old <= threshold then
    return;
  end if;

  select decrypted_secret into api_key
  from vault.decrypted_secrets
  where name = 'resend_api_key';

  if api_key is null then
    raise warning 'staleness reminder: no "resend_api_key" in Vault — skipping';
    return;
  end if;

  perform net.http_post(
    url     := 'https://api.resend.com/emails',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || api_key,
      'Content-Type',  'application/json'
    ),
    body := jsonb_build_object(
      'from',    sender,
      'to',      recipient,
      'subject', format('Sealed TCG Analytics — prices are %s days old', days_old),
      'html',    format(
        '<p>Your latest price snapshot is from <b>%s</b>, which is <b>%s days ago</b>.</p>'
        || '<p>Time to open the dashboard, enter this month''s prices &amp; set values, '
        || 'and hit <b>Save to cloud</b>.</p>',
        to_char(latest, 'FMMonth FMDD, YYYY'), days_old
      )
    )
  );
end;
$$;

-- App users must never be able to trigger emails; only the scheduler runs this.
revoke execute on function public.check_data_staleness() from public, anon, authenticated;

-- ── Schedule: every Monday at 09:00 UTC ──
-- Weekly (not daily) so an overdue dataset nudges you a few times rather than
-- spamming every morning. Change the cron expression to taste.
select cron.unschedule('staleness-reminder')
where exists (select 1 from cron.job where jobname = 'staleness-reminder');

select cron.schedule(
  'staleness-reminder',
  '0 9 * * 1',
  $$select public.check_data_staleness();$$
);

-- ── Handy for testing ──
-- Run the check immediately (sends a real email if currently stale):
--   select public.check_data_staleness();
-- Inspect recent outbound HTTP calls made by pg_net:
--   select * from net._http_response order by created desc limit 5;
-- See scheduled jobs and their last runs:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 5;
