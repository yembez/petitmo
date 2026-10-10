-- Vue ops lecture seule : UUID + e-mail + enfants + CRM en un coup d’œil.
-- N’écrit rien, n’est pas utilisée par l’app mobile.
-- Accès : Dashboard SQL / Table Editor (rôle admin) + service_role uniquement.
-- Pas de grant à anon / authenticated → zéro fuite vers les clientes.

create or replace view public.ops_user_overview as
select
  u.id as user_id,
  u.email,
  coalesce(nullif(trim(u.raw_app_meta_data ->> 'subscriptionTier'), ''), 'free')
    as subscription_tier,
  u.created_at as user_created_at,
  u.last_sign_in_at,
  (
    select string_agg(c.name, ', ' order by c.birthdate nulls last, c.created_at)
    from public.children c
    where c.user_id = u.id
  ) as children_names,
  (
    select count(*)::integer
    from public.children c
    where c.user_id = u.id
  ) as children_count,
  crm.full_name as crm_full_name,
  nullif(
    trim(
      concat_ws(
        ', ',
        nullif(trim(crm.address_json ->> 'line1'), ''),
        nullif(trim(crm.address_json ->> 'line2'), ''),
        nullif(
          trim(
            concat_ws(
              ' ',
              nullif(trim(crm.address_json ->> 'zip'), ''),
              nullif(trim(crm.address_json ->> 'city'), '')
            )
          ),
          ''
        ),
        nullif(trim(crm.address_json ->> 'country'), '')
      )
    ),
    ''
  ) as crm_address_line,
  crm.address_json as crm_address_json,
  crm.last_order_at,
  crm.order_count,
  crm.last_seen_at as crm_last_seen_at
from auth.users u
left join public.crm_contacts crm
  on lower(crm.email) = lower(u.email::text)
where coalesce(u.email, '') !~* '@petitmo\.local$';

comment on view public.ops_user_overview is
  'Ops / support : identité Auth + enfants + CRM. Lecture seule. Pas d’accès app.';

revoke all on public.ops_user_overview from public;
revoke all on public.ops_user_overview from anon, authenticated;
grant select on public.ops_user_overview to service_role;
