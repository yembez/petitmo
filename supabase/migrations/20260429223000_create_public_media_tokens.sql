-- Public tokens (URLs stables) pour médias audio/vidéo accessibles via /m/{token}
-- Objectif: PDF immédiat, upload/transcodage asynchrone, QR stable long terme.

create table if not exists public.public_media_tokens (
  token text primary key,
  media_id text not null,
  kind text not null check (kind in ('audio','video')),
  status text not null check (status in ('pending_upload','uploaded','processing','ready','failed')),
  -- Storage (Supabase) : source brut (optionnel) + sortie prête QR-friendly
  raw_bucket text null,
  raw_path text null,
  ready_bucket text null,
  ready_path text null,
  -- erreurs/debug
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Unicité: un token par (media_id, kind)
  constraint public_media_tokens_media_kind_unique unique (media_id, kind)
);

create index if not exists public_media_tokens_media_id_idx on public.public_media_tokens (media_id);
create index if not exists public_media_tokens_status_idx on public.public_media_tokens (status);

-- Updated_at auto
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_public_media_tokens_touch on public.public_media_tokens;
create trigger trg_public_media_tokens_touch
before update on public.public_media_tokens
for each row execute function public.touch_updated_at();

