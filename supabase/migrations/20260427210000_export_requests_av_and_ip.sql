-- Quota cumulé free (pages A/V) + rate limit IP côté init-export.

alter table public.export_requests
  add column if not exists audio_video_page_count integer,
  add column if not exists client_ip_hash text;

comment on column public.export_requests.audio_video_page_count is 'Nombre de pages audio+vidéo du livre (quota cumulé free, statut done).';
comment on column public.export_requests.client_ip_hash is 'SHA-256 hex (IP normalisée + secret) pour rate limit init.';
