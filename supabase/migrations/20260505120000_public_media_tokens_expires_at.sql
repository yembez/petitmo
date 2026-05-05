-- Expiration lecture QR `/m/{token}` (spec livre : 10 ans après création du token).
alter table public.public_media_tokens
  add column if not exists expires_at timestamptz;

comment on column public.public_media_tokens.expires_at is
  'Si non null, GET /m/{token} retourne 410 après cette date. Null = tokens historiques sans limite.';
