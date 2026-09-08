-- Mode d'ordre des pages contenu : null = chronologique, 'manual' = page_entries fait foi.
alter table public.books
  add column if not exists page_order_mode text;

comment on column public.books.page_order_mode is
  'null = ordre chronologique (created_at) recalcule a l''affichage ; ''manual'' = l''ordre de page_entries fait foi (livre reorganise par l''utilisatrice).';
