-- E-mail de confirmation commande livre (Resend) : anti-doublon + diagnostic.
alter table public.export_requests
  add column if not exists confirmation_email_sent_at timestamptz,
  add column if not exists confirmation_email_error text;

comment on column public.export_requests.confirmation_email_sent_at is
  'Mail récap commande (livre, adresse, prix) envoyé après commande imprimeur — un seul envoi.';
comment on column public.export_requests.confirmation_email_error is
  'Dernière erreur d’envoi du mail de confirmation (Resend / données manquantes).';
