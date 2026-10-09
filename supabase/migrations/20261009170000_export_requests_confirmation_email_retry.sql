-- Retry mail confirmation cliente : backoff + plafond (évite boucle Resend toutes les 2 min).
alter table public.export_requests
  add column if not exists confirmation_email_attempt_count integer not null default 0;

alter table public.export_requests
  add column if not exists confirmation_email_next_retry_at timestamptz;

create index if not exists export_requests_confirmation_email_retry_idx
  on public.export_requests (confirmation_email_next_retry_at)
  where
    type = 'print_order'
    and payment_status = 'paid'
    and status = 'sent_to_printer'
    and confirmation_email_sent_at is null
    and printer_order_id is not null;

comment on column public.export_requests.confirmation_email_attempt_count is
  'Tentatives d’envoi du mail confirmation cliente (Resend).';
comment on column public.export_requests.confirmation_email_next_retry_at is
  'Prochain retry mail confirmation ; null = immédiat / déjà envoyé.';
