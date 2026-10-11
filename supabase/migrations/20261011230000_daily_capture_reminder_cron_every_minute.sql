-- Smoke TF : rappel à la minute près → cron chaque minute.
-- Revenir à */15 en prod stabilisée si besoin.

do $$
begin
  perform cron.unschedule(j.jobid)
  from cron.job j
  where j.jobname = 'daily-capture-reminder-15m';
exception
  when others then null;
end $$;

select cron.schedule(
  'daily-capture-reminder-1m',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/daily-capture-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) as request_id;
  $$
);
