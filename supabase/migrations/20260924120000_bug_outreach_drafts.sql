-- Drafts d’outreach fondateur (HITL) : dédup des mails « bug détecté ».
-- Accès : Edge Function service role uniquement. RLS sans policy public.

create table if not exists public.bug_outreach_drafts (
  id uuid primary key default gen_random_uuid(),
  sentry_issue_id text not null,
  user_id uuid references auth.users (id) on delete set null,
  user_email text,
  status text not null default 'drafted',
  error_family text,
  sentry_url text,
  created_at timestamptz not null default now(),
  constraint bug_outreach_drafts_status_chk
    check (status in ('drafted', 'dismissed', 'sent_manual')),
  constraint bug_outreach_drafts_issue_chk
    check (char_length(sentry_issue_id) between 1 and 128)
);

create index if not exists bug_outreach_drafts_issue_user_created_idx
  on public.bug_outreach_drafts (sentry_issue_id, user_id, created_at desc);

create index if not exists bug_outreach_drafts_created_at_idx
  on public.bug_outreach_drafts (created_at desc);

alter table public.bug_outreach_drafts enable row level security;

comment on table public.bug_outreach_drafts is
  'Anti-spam mails fondateur (Sentry webhook). Jamais d’envoi auto à l’utilisatrice.';
