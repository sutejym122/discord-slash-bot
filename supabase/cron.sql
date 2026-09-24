-- Runs the job sweep every minute. Vercel's free plan only allows daily cron jobs, so the
-- database schedules it instead: pg_cron fires the timer and pg_net makes the HTTP call.
--
-- Run this once in the Supabase SQL editor after the first deploy. Replace the two
-- placeholders; the secret goes into Supabase Vault, not into the job definition.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('REPLACE_WITH_CRON_SECRET', 'slashbot_cron_secret');

select cron.schedule(
  'slashbot-sweep',
  '* * * * *',
  $$
  select net.http_post(
    url := 'https://REPLACE_WITH_APP_DOMAIN/api/jobs/sweep',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'slashbot_cron_secret')
    ),
    timeout_milliseconds := 55000
  );
  $$
);

-- To check it's firing:
--   select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
--   select status_code, created from net._http_response order by created desc limit 5;
-- To remove it:
--   select cron.unschedule('slashbot-sweep');
