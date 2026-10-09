-- Snapshot payload PDF print (médias déjà uploadés) pour fulfill serveur post-paiement.
alter table public.export_requests
  add column if not exists pdf_payload_json jsonb;

alter table public.export_requests
  add column if not exists pdf_payload_stashed_at timestamptz;

comment on column public.export_requests.pdf_payload_json is
  'Snapshot GenerateBookPdfPayload (URLs HTTPS / paths Storage) stashé avant Checkout ; utilisé par le fulfill PDF+Gelato après payment_status=paid.';

comment on column public.export_requests.pdf_payload_stashed_at is
  'Horodatage du dernier stash pdf_payload_json réussi.';
