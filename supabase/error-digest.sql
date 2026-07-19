-- ============================================================
-- Sealed TCG Analytics — client-error email digest (optional)
-- ============================================================
-- Emails you a summary of new rows in client_errors (the error-monitoring
-- beacon), so a broken deploy or a scoring-path failure surfaces in your inbox
-- instead of waiting to be noticed in the dashboard. Silent when there are no
-- new errors — the email itself is the signal — so a daily schedule can't spam.
--
-- Reuses the exact pattern proven by staleness-reminder.sql and
-- alert-emails.sql: pg_cron (schedule) + pg_net (outbound HTTP) + Resend
-- (email) + Vault (key).
--
-- ── One-time setup (same prerequisites as the staleness job; see SUPABASE.md) ──
--   1. Dashboard → Database → Extensions: enable `pg_cron` and `pg_net`.
--   2. A verified Resend sending domain + API key.
--   3. Store the key in Vault (once; shared with the other jobs):
--        select vault.create_secret('re_your_key_here', 'resend_api_key');
--   4. Edit `recipient`/`sender` below, then run this file in the SQL Editor.
--
-- Re-running is safe: CREATE OR REPLACE + unschedule-then-reschedule. Remove with:
--        select cron.unschedule('error-digest');
-- ============================================================

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- ── The digest ──
-- SECURITY DEFINER so it can read Vault and every client_errors row (bypassing
-- RLS as the owner). NOT exposed to app users — only pg_cron calls it.
create or replace function public.send_error_digest()
returns void
language plpgsql
security definer
set search_path = public, vault, net
as $$
declare
  -- ── settings — edit these two ──
  recipient text := 'tobias.grundstrom@outlook.com';   -- who gets the digest
  sender    text := 'onboarding@resend.dev.recipient'; -- a Resend-verified sender

  -- The job runs daily; the window is 25h so an error landing exactly on the
  -- boundary is mentioned twice rather than missed. Harmless for a digest.
  lookback interval := interval '25 hours';

  total   int;
  summary text;
  api_key text;
begin
  select count(*) into total
  from public.client_errors
  where created_at > now() - lookback;

  -- The steady state: no new errors, no email.
  if total = 0 then
    return;
  end if;

  -- Group repeats by message, worst first, capped at 10 distinct errors.
  select string_agg(
    format(
      '<li><b>%s×</b> %s <span style="color:#888">(last %s%s)</span></li>',
      hits, msg_html, last_seen, ctx
    ),
    '' order by hits desc
  )
  into summary
  from (
    select count(*) as hits,
           -- minimal HTML escaping of the (user-agent-supplied) message
           replace(replace(replace(left(message, 200), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') as msg_html,
           to_char(max(created_at), 'YYYY-MM-DD HH24:MI') as last_seen,
           coalesce(' · tab: ' || max(context), '') as ctx
    from public.client_errors
    where created_at > now() - lookback
    group by message
    order by count(*) desc
    limit 10
  ) g;

  select decrypted_secret into api_key
  from vault.decrypted_secrets
  where name = 'resend_api_key';

  if api_key is null then
    raise warning 'error digest: no "resend_api_key" in Vault — skipping';
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
      'subject', format('Sealed TCG Analytics — %s new client error%s',
                        total, case when total = 1 then '' else 's' end),
      'html',    format(
        '<p><b>%s</b> client error%s reported in the last day:</p><ul>%s</ul>'
        || '<p>Full detail (including stack traces) in the SQL Editor:<br>'
        || '<code>select * from client_errors order by created_at desc;</code></p>',
        total, case when total = 1 then '' else 's' end, summary
      )
    )
  );
end;
$$;

-- App users must never be able to trigger emails; only the scheduler runs this.
revoke execute on function public.send_error_digest() from public, anon, authenticated;

-- ── Schedule: daily at 07:30 UTC ──
-- Daily is safe because the function is silent when nothing broke; an error
-- from yesterday's deploy or data update reaches you the next morning.
select cron.unschedule('error-digest')
where exists (select 1 from cron.job where jobname = 'error-digest');

select cron.schedule(
  'error-digest',
  '30 7 * * *',
  $$select public.send_error_digest();$$
);

-- ── Handy for testing ──
-- Insert a fake error, run the digest, then clean up:
--   insert into public.client_errors (message) values ('digest test error');
--   select public.send_error_digest();   -- sends a real email
--   delete from public.client_errors where message = 'digest test error';
-- Inspect recent outbound HTTP calls made by pg_net:
--   select * from net._http_response order by created desc limit 5;
-- See scheduled jobs and their last runs:
--   select * from cron.job;
--   select * from cron.job_run_details order by start_time desc limit 5;
