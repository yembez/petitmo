-- Tagline personnalisable de la 4e de couverture (null = « Chaque moment compte. »).
alter table public.books
  add column if not exists back_cover_tagline text;

comment on column public.books.back_cover_tagline is
  'null = libelle par defaut « Chaque moment compte. » ; sinon texte personnalise de la 4e de couverture.';
