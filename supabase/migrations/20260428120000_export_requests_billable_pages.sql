-- print_order : palier fixe page_count → pages mémoire réelles billable_pages + prix calculé côté serveur.

alter table public.export_requests add column if not exists billable_pages integer;

update public.export_requests
set billable_pages = page_count
where type = 'print_order' and page_count is not null and billable_pages is null;

alter table public.export_requests drop constraint if exists export_requests_print_fields_chk;

alter table public.export_requests drop column if exists page_count;

alter table public.export_requests add constraint export_requests_print_fields_chk
  check (
    type <> 'print_order'
    or (
      shipping_name is not null
      and shipping_address_json is not null
      and billable_pages is not null
      and price_cents is not null
    )
  );

comment on column public.export_requests.billable_pages is 'Nombre réel de pages mémoire (print_order) ; tarif incrémental côté Edge.';
