-- Tokens Expo Push par compte (multi-appareils).
-- UI : local-first ; upsert silencieux après permission + session.

create table if not exists public.push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null,
  platform text not null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint push_tokens_platform_chk check (platform in ('ios', 'android')),
  constraint push_tokens_token_chk check (char_length(expo_push_token) between 20 and 512),
  constraint push_tokens_user_token_uidx unique (user_id, expo_push_token)
);

create index if not exists push_tokens_user_id_idx
  on public.push_tokens (user_id);

create index if not exists push_tokens_token_idx
  on public.push_tokens (expo_push_token);

alter table public.push_tokens enable row level security;

create policy "Users can select own push tokens"
  on public.push_tokens for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own push tokens"
  on public.push_tokens for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own push tokens"
  on public.push_tokens for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own push tokens"
  on public.push_tokens for delete
  to authenticated
  using (auth.uid() = user_id);

comment on table public.push_tokens is
  'Expo push tokens (ExponentPushToken[…]). Upsert client authentifié ; envoi via Expo Push API / Edge Function.';
