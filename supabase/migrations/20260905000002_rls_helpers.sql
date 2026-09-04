-- The functions every RLS policy is built on.
--
-- These read public.memberships, which is itself RLS-protected. Without SECURITY DEFINER
-- a policy that calls them would re-enter the same policy and recurse forever, so the
-- definer bypass is load-bearing, not an optimisation. search_path is pinned to '' to
-- defeat search-path hijacking, hence the fully-qualified names throughout.

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.role = 'platform_admin'
  );
$$;

create or replace function public.auth_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.org_id from public.memberships m
  where m.user_id = (select auth.uid());
$$;

-- A membership with a null site_id grants every site in that org.
create or replace function public.auth_site_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select s.id
  from public.sites s
  join public.memberships m on m.org_id = s.org_id
  where m.user_id = (select auth.uid())
    and (m.site_id is null or m.site_id = s.id);
$$;

-- True when the current user holds any of `roles` in `org`.
create or replace function public.has_org_role(org uuid, roles public.app_role[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = (select auth.uid())
      and m.org_id = org
      and m.role = any(roles)
  );
$$;

-- Convenience wrappers so policies read as intent rather than role arrays.
create or replace function public.can_manage_org(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
      or public.has_org_role(org, array['owner']::public.app_role[]);
$$;

create or replace function public.can_manage_site(org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin()
      or public.has_org_role(org, array['owner', 'manager']::public.app_role[]);
$$;
