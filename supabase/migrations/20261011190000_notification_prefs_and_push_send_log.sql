-- Préférences notifications (rappel capture) + journal d’envoi anti-doublon.
-- Opt-in rappel : défaut OFF (App Store / confiance). Timezone sync silencieuse côté app.

create table if not exists public.notification_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  capture_reminder_enabled boolean not null default false,
  capture_reminder_local_time text not null default '20:00',
  timezone text not null default 'Europe/Paris',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint notification_prefs_time_chk check (capture_reminder_local_time ~ '^\d{2}:\d{2}$'),
  constraint notification_prefs_tz_chk check (char_length(timezone) between 3 and 64)
);

comment on table public.notification_prefs is
  'Prefs push par compte. capture_reminder_* = rappel quotidien local ; défaut enabled=false.';

alter table public.notification_prefs enable row level security;

create policy "Users can select own notification prefs"
  on public.notification_prefs for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own notification prefs"
  on public.notification_prefs for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own notification prefs"
  on public.notification_prefs for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create table if not exists public.push_send_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null,
  day_key text not null,
  created_at timestamptz not null default now(),
  constraint push_send_log_kind_chk check (char_length(kind) between 2 and 64),
  constraint push_send_log_day_chk check (char_length(day_key) between 8 and 32),
  constraint push_send_log_user_kind_day_uidx unique (user_id, kind, day_key)
);

create index if not exists push_send_log_kind_day_idx
  on public.push_send_log (kind, day_key);

comment on table public.push_send_log is
  'Anti-doublon envois push (service_role). day_key = date locale YYYY-MM-DD.';

alter table public.push_send_log enable row level security;
-- Pas de policy client : lecture/écriture service_role uniquement.
