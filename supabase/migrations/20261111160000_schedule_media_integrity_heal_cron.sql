-- Cron quotidien : audit + heal R2 (médias) + mirror + meta textes + QR + purge trash 90j.
-- Prérequis Vault (ops) :
--   vault secret `project_url` = https://<ref>.supabase.co
--   vault secret `media_integrity_cron_secret` = même valeur que Edge MEDIA_INTEGRITY_CRON_SECRET
--     (ou MEDIA_WORKER_SECRET si c’est le secret utiliséé par l’Edge)

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  perform cron.unschedule(j.jobid)
  from cron.job j
  where j.jobname = 'petitmo-media-integrity-heal';
exception
  when undefined_table then null;
  when others then null;
end $$;

select cron.schedule(
  'petitmo-media-integrity-heal',
  '15 4 * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/media-integrity-audit',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (
        select decrypted_secret from vault.decrypted_secrets
        where name = 'media_integrity_cron_secret' limit 1
      )
    ),
    body := jsonb_build_object(
      'limit', 100,
      'heal', true,
      'mirror', true,
      'mirrorLimit', 40,
      'meta', true,
      'metaLimit', 100,
      'qr', true,
      'qrLimit', 40,
      'purgeTrash', true,
      'trashDays', 90
    ),
    timeout_milliseconds := 120000
  ) as request_id;
  $$
);
