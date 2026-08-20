-- Paiement livre imprimé (Stripe PaymentSheet / Checkout) avant Gelato.

alter table public.export_requests
  add column if not exists payment_status text,
  add column if not exists stripe_payment_intent_id text,
  add column if not exists stripe_checkout_session_id text,
  add column if not exists paid_at timestamptz;

-- Historique : commandes déjà envoyées à l’imprimeur = encaissées.
update public.export_requests
set payment_status = 'paid',
    paid_at = coalesce(paid_at, updated_at, created_at)
where type = 'print_order'
  and payment_status is null
  and (
    printer_order_id is not null
    or status in ('sent_to_printer', 'done')
  );

update public.export_requests
set payment_status = 'unpaid'
where payment_status is null;

alter table public.export_requests
  alter column payment_status set default 'unpaid',
  alter column payment_status set not null;

alter table public.export_requests
  drop constraint if exists export_requests_payment_status_chk;

alter table public.export_requests
  add constraint export_requests_payment_status_chk
  check (payment_status in ('unpaid', 'paid', 'failed', 'refunded'));

create unique index if not exists export_requests_stripe_pi_uidx
  on public.export_requests (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create unique index if not exists export_requests_stripe_cs_uidx
  on public.export_requests (stripe_checkout_session_id)
  where stripe_checkout_session_id is not null;

comment on column public.export_requests.payment_status is
  'Encaissement Stripe (print_order). Gelato uniquement si paid.';
comment on column public.export_requests.stripe_payment_intent_id is
  'PaymentIntent Stripe (PaymentSheet).';
comment on column public.export_requests.stripe_checkout_session_id is
  'Checkout Session Stripe (repli Safari).';
