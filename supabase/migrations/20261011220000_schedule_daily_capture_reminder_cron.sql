-- Cron rappel capture : toutes les 15 min → Edge daily-capture-reminder.
-- Prérequis Vault (ops, hors migration) :
--   vault secret `project_url` = https://<ref>.supabase.co
--   vault secret `push_cron_secret` = même valeur que Edge secret PUSH_CRON_SECRET
-- Extensions : pg_cron + pg_net (activées si absentes).

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  perform cron.unschedule(j.jobid)
  from cron.job j
  where j.jobname = 'daily-capture-reminder-15m';
exception
  when undefined_table then null;
  when others then null;
end $$;

select cron.schedule(
  'daily-capture-reminder-15m',
  '*/15 * * * *',
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
