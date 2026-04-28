-- QR médias liés à une demande d’export (sans compte / ticket), pas aux lignes children/memories Supabase.
-- Même bucket `qr-media` et même route `GET /q/:token` que `qr_links` (résolution dans les deux tables).

create table if not exists public.qr_links_exports (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  export_request_id uuid not null references public.export_requests (id) on delete cascade,
  book_id text not null,
  memory_client_id text not null,
  storage_bucket text not null default 'qr-media',
  media_path text not null,
  kind text not null check (kind in ('audio', 'video')),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint qr_links_exports_export_memory_uniq unique (export_request_id, memory_client_id)
);

create index if not exists qr_links_exports_token_idx on public.qr_links_exports (token);
create index if not exists qr_links_exports_export_id_idx on public.qr_links_exports (export_request_id);

alter table public.qr_links_exports enable row level security;

comment on table public.qr_links_exports is 'Tokens QR livre (flux export_request) → média dans Storage privé qr-media.';
