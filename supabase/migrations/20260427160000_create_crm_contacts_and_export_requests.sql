-- CRM minimal (1 ligne par email) + demandes export PDF / commande impression.
-- Accès applicatif prévu : Edge Functions (service role) + service Railway (service role).
-- RLS activé sans policy public → pas d’accès anon/authenticated jusqu’à policies explicites.

-- ── crm_contacts ───────────────────────────────────────────────────────────

create table if not exists public.crm_contacts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  full_name text,
  address_json jsonb,
  child_name text,
  child_birthdate date,
  gdpr_consent_at timestamptz not null,
  marketing_opt_in boolean not null default false,
  last_seen_at timestamptz not null default now(),
  last_order_at timestamptz,
  order_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists crm_contacts_email_idx on public.crm_contacts (lower(email));
create index if not exists crm_contacts_last_seen_idx on public.crm_contacts (last_seen_at desc);

alter table public.crm_contacts enable row level security;

comment on table public.crm_contacts is 'Contact CRM unique par email (historique, relances).';

-- ── export_requests (pdf_export + print_order) ─────────────────────────────

create table if not exists public.export_requests (
  id uuid primary key default gen_random_uuid(),
  crm_contact_id uuid not null references public.crm_contacts (id) on delete restrict,
  user_id uuid references auth.users (id) on delete set null,

  type text not null,
  export_mode text not null,
  status text not null default 'created',
  book_id text not null,
  child_local_id text,
  subscription_tier text not null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- print_order uniquement
  shipping_name text,
  shipping_address_json jsonb,
  page_count integer,
  price_cents integer,
  discount_percent integer,
  printer_name text,
  printer_order_id text,
  printer_order_json jsonb,
  shipped_at timestamptz,
  delivered_at timestamptz,

  -- pdf_export uniquement
  pdf_storage_path text,

  constraint export_requests_type_chk
    check (type in ('pdf_export', 'print_order')),
  constraint export_requests_export_mode_chk
    check (export_mode in ('digital', 'print')),
  constraint export_requests_status_chk
    check (
      status in (
        'created',
        'media_uploading',
        'rendering',
        'done',
        'failed',
        'sent_to_printer'
      )
    ),
  constraint export_requests_subscription_tier_chk
    check (subscription_tier in ('free', 'paid')),
  constraint export_requests_print_fields_chk
    check (
      type <> 'print_order'
      or (
        shipping_name is not null
        and shipping_address_json is not null
        and page_count is not null
        and price_cents is not null
      )
    )
);

create index if not exists export_requests_crm_contact_id_idx on public.export_requests (crm_contact_id);
create index if not exists export_requests_user_id_idx on public.export_requests (user_id);
create index if not exists export_requests_type_idx on public.export_requests (type);
create index if not exists export_requests_status_idx on public.export_requests (status);
create index if not exists export_requests_created_at_idx on public.export_requests (created_at desc);
create index if not exists export_requests_contact_created_idx
  on public.export_requests (crm_contact_id, created_at desc);

alter table public.export_requests enable row level security;

comment on table public.export_requests is 'Export PDF serveur ou commande impression ; statuts + champs spécifiques par type.';

-- updated_at automatique (nom unique pour éviter collision avec d’autres migrations)
create or replace function public.petitmo_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists crm_contacts_set_updated_at on public.crm_contacts;
create trigger crm_contacts_set_updated_at
  before update on public.crm_contacts
  for each row execute procedure public.petitmo_touch_updated_at();

drop trigger if exists export_requests_set_updated_at on public.export_requests;
create trigger export_requests_set_updated_at
  before update on public.export_requests
  for each row execute procedure public.petitmo_touch_updated_at();
