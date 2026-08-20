-- Messages support in-app (formulaire Espace parent).
-- Accès : Edge Function service role uniquement. RLS sans policy public.

create table if not exists public.support_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  email text not null,
  kind text not null default 'contact',
  message text not null,
  tech_context text,
  created_at timestamptz not null default now(),
  constraint support_messages_kind_chk check (kind in ('contact', 'report')),
  constraint support_messages_email_chk check (char_length(email) between 3 and 254),
  constraint support_messages_message_chk check (char_length(message) between 1 and 8000)
);

create index if not exists support_messages_created_at_idx
  on public.support_messages (created_at desc);

create index if not exists support_messages_email_idx
  on public.support_messages (lower(email));

alter table public.support_messages enable row level security;

comment on table public.support_messages is
  'Tickets support in-app. Lecture / écriture via Edge Function (service role).';
