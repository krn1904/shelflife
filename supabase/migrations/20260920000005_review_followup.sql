-- Close the remaining review gaps without applying child-table delete triggers to
-- ON DELETE CASCADE. Destructive admin operations use locked, audited RPCs instead.

drop policy orgs_insert on public.orgs;

drop trigger sites_require_active_org on public.sites;
create trigger sites_require_active_org
  before insert or update on public.sites
  for each row execute function public.require_active_org_write();

drop trigger memberships_require_active_org on public.memberships;
create trigger memberships_require_active_org
  before insert or update on public.memberships
  for each row execute function public.require_active_org_write();

-- Direct child deletion is not part of the tenant API. Platform-admin removals below
-- lock the parent organisation and audit in the same transaction.
drop policy sites_delete on public.sites;
drop policy memberships_delete on public.memberships;

create or replace function public.remove_empty_site(p_site_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_site public.sites%rowtype;
  v_org_id uuid;
  v_org_status public.org_status;
begin
  if not public.is_platform_admin() then
    raise exception 'platform admin required' using errcode = 'insufficient_privilege';
  end if;

  select org_id into v_org_id from public.sites where id = p_site_id;
  if not found then
    return null;
  end if;

  select status into v_org_status
  from public.orgs
  where id = v_org_id
  for update;
  select * into v_site
  from public.sites
  where id = p_site_id
  for update;
  if not found then
    return null;
  end if;
  if v_org_status <> 'active' then
    raise exception 'organisation is archived' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.deliveries where site_id = p_site_id)
     or exists (select 1 from public.stock_batches where site_id = p_site_id)
     or exists (select 1 from public.waste_events where site_id = p_site_id) then
    raise exception 'site has activity' using errcode = 'check_violation';
  end if;

  perform public.write_audit(
    'platform_admin.removed_site',
    v_site.org_id,
    null,
    'site',
    v_site.id,
    jsonb_build_object('name', v_site.name)
  );

  delete from public.sites where id = v_site.id;
  return v_site.org_id;
end;
$$;

create or replace function public.remove_organisation_member(p_membership_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships%rowtype;
  v_org_id uuid;
  v_org_status public.org_status;
begin
  if not public.is_platform_admin() then
    raise exception 'platform admin required' using errcode = 'insufficient_privilege';
  end if;

  select org_id into v_org_id from public.memberships where id = p_membership_id;
  if not found then
    return null;
  end if;

  select status into v_org_status
  from public.orgs
  where id = v_org_id
  for update;
  select * into v_membership
  from public.memberships
  where id = p_membership_id
  for update;
  if not found then
    return null;
  end if;
  if v_org_status <> 'active' then
    raise exception 'organisation is archived' using errcode = 'check_violation';
  end if;

  perform public.write_audit(
    'platform_admin.removed_member',
    v_membership.org_id,
    null,
    'membership',
    v_membership.id,
    jsonb_build_object('role', v_membership.role)
  );

  delete from public.memberships where id = v_membership.id;
  return v_membership.org_id;
end;
$$;

-- A subscription's optional site must belong to the same active organisation and be in
-- the caller's site scope. This closes both cross-org insertion and reassignment.
drop policy push_insert on public.push_subscriptions;
create policy push_insert on public.push_subscriptions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and org_id in (select public.auth_org_ids())
    and (
      push_subscriptions.site_id is null
      or push_subscriptions.site_id in (select public.auth_site_ids())
    )
    and (
      push_subscriptions.site_id is null
      or exists (
        select 1 from public.sites s
        where s.id = push_subscriptions.site_id
          and s.org_id = push_subscriptions.org_id
      )
    )
  );

drop policy push_update on public.push_subscriptions;
create policy push_update on public.push_subscriptions for update to authenticated
  using (
    user_id = (select auth.uid())
    and org_id in (select public.auth_org_ids())
  )
  with check (
    user_id = (select auth.uid())
    and org_id in (select public.auth_org_ids())
    and (
      push_subscriptions.site_id is null
      or push_subscriptions.site_id in (select public.auth_site_ids())
    )
    and (
      push_subscriptions.site_id is null
      or exists (
        select 1 from public.sites s
        where s.id = push_subscriptions.site_id
          and s.org_id = push_subscriptions.org_id
      )
    )
  );
