-- Couleur de fond couverture livre (ids : white|cream|olive|navy|charcoal|black).
alter table public.books
  add column if not exists cover_color_id text;

comment on column public.books.cover_color_id is
  'Couleur de fond couverture (white, cream, olive, navy, charcoal, black).';
