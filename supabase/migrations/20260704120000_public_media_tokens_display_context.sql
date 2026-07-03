-- Contexte d’affichage page publique /m/{token} (date souvenir, lieu, naissance enfant).

alter table public.public_media_tokens
  add column if not exists memory_created_at timestamptz null,
  add column if not exists memory_location text null,
  add column if not exists child_birthdate text null;

comment on column public.public_media_tokens.memory_created_at is
  'Date de prise / événement du souvenir (memories.created_at) pour la page QR publique.';
comment on column public.public_media_tokens.memory_location is
  'Lieu du souvenir affiché sur la page QR publique.';
comment on column public.public_media_tokens.child_birthdate is
  'Date de naissance enfant (ISO) pour calculer l’âge sur la page QR publique.';
