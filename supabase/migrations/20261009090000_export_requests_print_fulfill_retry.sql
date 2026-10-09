-- Retries fond print fulfill (PDF + Gelato) + alerte ops permanente.
alter table public.export_requests
  add column if not exists fulfill_attempt_count integer not null default 0;

alter table public.export_requests
  add column if not exists fulfill_next_retry_at timestamptz;

alter table public.export_requests
  add column if not exists fulfill_failed_kind text;

alter table public.export_requests
  add column if not exists print_ops_alert_sent_at timestamptz;

alter table public.export_requests
  drop constraint if exists export_requests_fulfill_failed_kind_chk;

alter table public.export_requests
  add constraint export_requests_fulfill_failed_kind_chk
  check (
    fulfill_failed_kind is null
    or fulfill_failed_kind in ('retryable', 'permanent')
  );

create index if not exists export_requests_fulfill_retry_idx
  on public.export_requests (fulfill_next_retry_at)
  where
    type = 'print_order'
    and payment_status = 'paid'
    and status = 'failed'
    and fulfill_failed_kind = 'retryable';

create index if not exists export_requests_fulfill_rendering_watchdog_idx
  on public.export_requests (updated_at)
  where
    type = 'print_order'
    and payment_status = 'paid'
    and status = 'rendering'
    and printer_order_id is null;

comment on column public.export_requests.fulfill_attempt_count is
  'Nombre de tentatives PDF+Gelato après paid (retries fond inclus).';
comment on column public.export_requests.fulfill_next_retry_at is
  'Prochain retry serveur si fulfill_failed_kind=retryable.';
comment on column public.export_requests.fulfill_failed_kind is
  'retryable = backoff serveur ; permanent = stop + mail support.';
comment on column public.export_requests.print_ops_alert_sent_at is
  'Mail support@ envoyé une fois pour échec permanent print fulfill.';
