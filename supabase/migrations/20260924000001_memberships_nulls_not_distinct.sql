-- unique (user_id, org_id, site_id) treated NULLs as distinct, so organisation-wide memberships
-- (owners and platform admins, site_id is null) could be inserted twice, and an upsert on
-- 'user_id,org_id,site_id' never conflicted for them. Repeated seed runs left exact duplicates.

-- Keeping the oldest row is only safe while duplicates agree on role; refuse to guess otherwise
-- rather than silently dropping someone's owner or platform_admin grant. group by treats NULL
-- site_ids as equal, which is the same grouping the new constraint enforces.
do $$
begin
  if exists (
    select 1
    from public.memberships
    group by user_id, org_id, site_id
    having count(distinct role) > 1
  ) then
    raise exception 'duplicate memberships disagree on role; resolve them by hand before migrating';
  end if;
end;
$$;

delete from public.memberships m
using public.memberships keep
where keep.user_id = m.user_id
  and keep.org_id = m.org_id
  and keep.site_id is not distinct from m.site_id
  and (keep.created_at, keep.id) < (m.created_at, m.id);

alter table public.memberships
  drop constraint memberships_user_id_org_id_site_id_key;

alter table public.memberships
  add constraint memberships_user_id_org_id_site_id_key
  unique nulls not distinct (user_id, org_id, site_id);
