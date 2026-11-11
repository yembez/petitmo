-- Vue ops : child_id → prénom + e-mail parent (chemins Storage / memories).
-- Lecture seule, service_role / SQL Editor uniquement — pas d’accès app.

create or replace view public.ops_child_directory as
select
  c.id as child_id,
  c.name as child_name,
  c.birthdate,
  c.user_id,
  u.email as user_email,
  coalesce(nullif(trim(u.raw_app_meta_data ->> 'subscriptionTier'), ''), 'free')
    as subscription_tier,
  c.created_at as child_created_at
from public.children c
join auth.users u on u.id = c.user_id
where coalesce(u.email, '') !~* '@petitmo\.local$';

comment on view public.ops_child_directory is
  'Ops : child_id + prénom + e-mail parent. Lecture seule. Pas d’accès app.';

revoke all on public.ops_child_directory from public;
revoke all on public.ops_child_directory from anon, authenticated;
grant select on public.ops_child_directory to service_role;
