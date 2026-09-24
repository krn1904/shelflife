-- Complete the archive boundary for accounts whose only organisation is inactive.
--
-- Most operational policies already call auth_org_ids/auth_site_ids and were closed by
-- the lifecycle migration. The shared catalogue is intentionally global, so its original
-- policies only required authentication and need this explicit active-membership guard.

alter table public.orgs drop constraint orgs_archive_state;
alter table public.orgs add constraint orgs_archive_state check (
  (status = 'active' and archived_at is null and archived_by is null)
  or
  (status = 'archived' and archived_at is not null)
);

create or replace function public.has_active_membership()
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
      and o.status = 'active'
  );
$$;

drop policy products_select on public.products;
create policy products_select on public.products for select to authenticated
  using (public.has_active_membership() or public.is_platform_admin());

drop policy products_insert on public.products;
create policy products_insert on public.products for insert to authenticated
  with check (public.has_active_membership() or public.is_platform_admin());

drop policy products_update on public.products;
create policy products_update on public.products for update to authenticated
  using (
    (created_by = (select auth.uid()) and public.has_active_membership())
    or public.is_platform_admin()
  )
  with check (
    (created_by = (select auth.uid()) and public.has_active_membership())
    or public.is_platform_admin()
  );
