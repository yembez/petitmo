-- Parité APPEND multi-photos album : backup cloud des pages livre (pas seulement memory_ids uniques).
alter table public.books
  add column if not exists page_entries jsonb;

alter table public.books
  add column if not exists memory_photo_refs jsonb;

comment on column public.books.page_entries is
  'Pages contenu [{memoryId, photoRef?}] — source de vérité APPEND (même souvenir, photos distinctes).';

comment on column public.books.memory_photo_refs is
  'Dernier slot photo par memoryId (compat) ; dérivé de page_entries.';
