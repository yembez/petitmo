-- Liens QR pour médias audio/vidéo dans les livres (accès via token, pas d’ID en clair dans l’URL).
-- Lecture/écriture côté app : via service PDF (service role) ou policies futures.

create table if not exists public.qr_links (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  child_id uuid not null references public.children (id) on delete cascade,
  memory_id uuid not null references public.memories (id) on delete cascade,
  book_id text not null,
  storage_bucket text not null default 'qr-media',
  media_path text not null,
  kind text not null check (kind in ('audio', 'video')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists qr_links_token_idx on public.qr_links (token);
create index if not exists qr_links_memory_id_idx on public.qr_links (memory_id);

alter table public.qr_links enable row level security;

-- Aucune policy : accès uniquement service_role / backend (comme d’autres tables internes).

comment on table public.qr_links is 'Tokens QR livre → média compressé dans Storage privé (qr-media).';
