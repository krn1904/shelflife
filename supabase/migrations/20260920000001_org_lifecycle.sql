-- Reversible organisation lifecycle.
--
-- Operational history is the product's source of truth, so removing an organisation
-- from service archives it instead of cascading a physical delete through every table.

create type public.org_status as enum ('active', 'archived');

alter table public.orgs
  add column status public.org_status not null default 'active',
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete set null,
  add constraint orgs_archive_state check (
    (status = 'active' and archived_at is null and archived_by is null)
    or
    (status = 'archived' and archived_at is not null and archived_by is not null)
  );

create index orgs_status_idx on public.orgs (status);

-- Membership-derived scope contains active organisations only. Platform admins remain
-- global through is_platform_admin(), including when their anchor membership happens to
-- belong to an archived organisation.
create or replace function public.auth_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id
  from public.memberships m
  join public.orgs o on o.id = m.org_id
  where m.user_id = (select auth.uid())
    and o.status = 'active';
$$;

create or replace function public.auth_site_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.sites s
  join public.orgs o on o.id = s.org_id
  join public.memberships m on m.org_id = s.org_id
  where m.user_id = (select auth.uid())
    and o.status = 'active'
    and (m.site_id is null or m.site_id = s.id);
$$;

create or replace function public.has_org_role(org uuid, roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships m
    join public.orgs o on o.id = m.org_id
    where m.user_id = (select auth.uid())
      and m.org_id = org
      and m.role = any(roles)
      and o.status = 'active'
  );
$$;

-- Organisation lifecycle is a platform operation. Owners continue to manage their sites,
-- but cannot archive or alter their organisation row through a direct API request.
drop policy orgs_update on public.orgs;
create policy orgs_update on public.orgs for update to authenticated
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- Physical deletion is deliberately unavailable to application users. The service role
-- remains available for explicit break-glass maintenance outside the normal admin UI.
drop policy orgs_delete on public.orgs;
