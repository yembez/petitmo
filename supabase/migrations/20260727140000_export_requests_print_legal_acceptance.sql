-- Preuve d’acceptation avant commande livre imprimé (contenu vérifié + version CGV).
alter table public.export_requests
  add column if not exists content_verified_at timestamptz,
  add column if not exists cgv_version text;

comment on column public.export_requests.content_verified_at is
  'Horodatage case « J’ai vérifié le contenu et la mise en page » (print_order).';
comment on column public.export_requests.cgv_version is
  'Version CGV acceptée au moment de la commande (ex. 2026-07-27).';
