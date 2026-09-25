-- Runs the job sweep every minute. Vercel's free plan only allows daily cron jobs, so the
-- database schedules it instead: pg_cron fires the timer and pg_net makes the HTTP call.
--
-- Run this once in the Supabase SQL editor after the first deploy. Fill in the two values
-- below: the FULL sweep URL (including /api/jobs/sweep) and the same CRON_SECRET as in Vercel.
-- Both are stored in Supabase Vault, so the job definition itself holds no secrets.

create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('https://your-app.vercel.app/api/jobs/sweep', 'slashbot_sweep_url');
select vault.create_secret('your-cron-secret', 'slashbot_cron_secret');

select cron.schedule(
  'slashbot-sweep',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'slashbot_sweep_url'),
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'slashbot_cron_secret')
    ),
    timeout_milliseconds := 55000
  );
  $$
);

-- Check it: a healthy sweep answers with JSON like {"succeeded":0,"retrying":0,"failed":0}.
-- An HTML body means the URL points at a page, not the sweep endpoint.
--   select status_code, left(content, 80), created from net._http_response order by created desc limit 5;
-- The app also tracks it: /api/health reports "sweep": {"stale": true} after 3 missed minutes.
--
-- To change the URL later:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'slashbot_sweep_url'),
--     'https://your-app.vercel.app/api/jobs/sweep'
--   );
-- To remove the job:
--   select cron.unschedule('slashbot-sweep');
