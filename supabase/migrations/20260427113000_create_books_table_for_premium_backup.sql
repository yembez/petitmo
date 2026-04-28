-- Premium backup : sauvegarde des livres (drafts) dans Supabase.
-- Local-first : SQLite reste la source sur l’app ; cloud = backup/restauration.

create table if not exists public.books (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  memory_ids jsonb not null default '[]'::jsonb,
  cover_photo_url text,
  rotations jsonb,
  photo_crops jsonb,
  text_edits jsonb,
  chapter_title text
);

create index if not exists books_user_id_idx on public.books (user_id);
create index if not exists books_updated_at_idx on public.books (updated_at desc);

alter table public.books enable row level security;

-- Les utilisateurs peuvent uniquement lire/écrire leurs propres livres.
create policy "books_select_own"
  on public.books for select
  using (auth.uid() = user_id);

create policy "books_insert_own"
  on public.books for insert
  with check (auth.uid() = user_id);

create policy "books_update_own"
  on public.books for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "books_delete_own"
  on public.books for delete
  using (auth.uid() = user_id);

