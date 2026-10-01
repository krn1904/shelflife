-- Products an organisation adds from its own dockets are its own.
--
-- The catalogue stays shared (org_id null): the seeded range and barcode scans, which every
-- organisation benefits from. A product created because a docket named something the
-- catalogue did not know carries that docket's wording, so it belongs to the organisation
-- that received it and is invisible to everyone else.

alter table public.products
  add column org_id uuid references public.orgs(id) on delete cascade;
create index on public.products (org_id) where org_id is not null;

drop policy products_select on public.products;
create policy products_select on public.products for select to authenticated
  using (
    (org_id is null and public.has_active_membership())
    or org_id in (select public.auth_org_ids())
    or public.is_platform_admin()
  );

-- Shared products stay open to any active member; a private one only to its own organisation.
drop policy products_insert on public.products;
create policy products_insert on public.products for insert to authenticated
  with check (
    (public.has_active_membership() and (org_id is null or org_id in (select public.auth_org_ids())))
    or public.is_platform_admin()
  );

-- The creator may still fix their own typo, but cannot move a product into another
-- organisation or make a private one shared.
drop policy products_update on public.products;
create policy products_update on public.products for update to authenticated
  using (
    (created_by = (select auth.uid()) and public.has_active_membership()
      and (org_id is null or org_id in (select public.auth_org_ids())))
    or public.is_platform_admin()
  )
  with check (
    (created_by = (select auth.uid()) and public.has_active_membership()
      and (org_id is null or org_id in (select public.auth_org_ids())))
    or public.is_platform_admin()
  );
