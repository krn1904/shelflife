-- Row level security. Tenant isolation is enforced here, in the database, so it cannot be
-- lost by a missing filter in application code.

create or replace function public.shares_org_with(other_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.memberships mine
    join public.memberships theirs on theirs.org_id = mine.org_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = other_user
  );
$$;

alter table public.orgs           enable row level security;
alter table public.sites          enable row level security;
alter table public.profiles       enable row level security;
alter table public.memberships    enable row level security;
alter table public.suppliers      enable row level security;
alter table public.products       enable row level security;
alter table public.site_products  enable row level security;

-- orgs ---------------------------------------------------------------------
create policy orgs_select on public.orgs for select to authenticated
  using (id in (select public.auth_org_ids()) or public.is_platform_admin());
create policy orgs_insert on public.orgs for insert to authenticated
  with check (public.is_platform_admin());
create policy orgs_update on public.orgs for update to authenticated
  using (public.can_manage_org(id)) with check (public.can_manage_org(id));
create policy orgs_delete on public.orgs for delete to authenticated
  using (public.is_platform_admin());

-- sites --------------------------------------------------------------------
-- auth_site_ids() already expands an owner's null site_id to every site in the org,
-- so this single rule covers staff (one site) and owners (all sites) alike.
create policy sites_select on public.sites for select to authenticated
  using (id in (select public.auth_site_ids()) or public.is_platform_admin());
create policy sites_insert on public.sites for insert to authenticated
  with check (public.can_manage_org(org_id));
create policy sites_update on public.sites for update to authenticated
  using (public.can_manage_org(org_id)) with check (public.can_manage_org(org_id));
create policy sites_delete on public.sites for delete to authenticated
  using (public.can_manage_org(org_id));

-- profiles -----------------------------------------------------------------
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.shares_org_with(id) or public.is_platform_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- memberships --------------------------------------------------------------
create policy memberships_select on public.memberships for select to authenticated
  using (org_id in (select public.auth_org_ids()) or public.is_platform_admin());
create policy memberships_insert on public.memberships for insert to authenticated
  with check (public.can_manage_org(org_id));
create policy memberships_update on public.memberships for update to authenticated
  using (public.can_manage_org(org_id)) with check (public.can_manage_org(org_id));
create policy memberships_delete on public.memberships for delete to authenticated
  using (public.can_manage_org(org_id));

-- suppliers ----------------------------------------------------------------
create policy suppliers_select on public.suppliers for select to authenticated
  using (org_id in (select public.auth_org_ids()) or public.is_platform_admin());
create policy suppliers_insert on public.suppliers for insert to authenticated
  with check (public.can_manage_site(org_id));
create policy suppliers_update on public.suppliers for update to authenticated
  using (public.can_manage_site(org_id)) with check (public.can_manage_site(org_id));
create policy suppliers_delete on public.suppliers for delete to authenticated
  using (public.can_manage_org(org_id));

-- products (global catalogue) ----------------------------------------------
-- Readable and insertable by any signed-in user: that is the point of a shared catalogue.
-- Editing is restricted to the creator (fixing their own typo) or a platform admin, so one
-- tenant cannot rewrite catalogue entries another tenant depends on.
create policy products_select on public.products for select to authenticated
  using (true);
create policy products_insert on public.products for insert to authenticated
  with check ((select auth.uid()) is not null);
create policy products_update on public.products for update to authenticated
  using (created_by = (select auth.uid()) or public.is_platform_admin())
  with check (created_by = (select auth.uid()) or public.is_platform_admin());
create policy products_delete on public.products for delete to authenticated
  using (public.is_platform_admin());

-- site_products ------------------------------------------------------------
create policy site_products_select on public.site_products for select to authenticated
  using (site_id in (select public.auth_site_ids()) or public.is_platform_admin());
create policy site_products_insert on public.site_products for insert to authenticated
  with check (public.can_manage_site(org_id) and site_id in (select public.auth_site_ids()));
create policy site_products_update on public.site_products for update to authenticated
  using (public.can_manage_site(org_id)) with check (public.can_manage_site(org_id));
create policy site_products_delete on public.site_products for delete to authenticated
  using (public.can_manage_site(org_id));
