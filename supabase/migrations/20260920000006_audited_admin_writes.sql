-- Make every platform-admin site/member write an audited database transaction.

drop policy sites_insert on public.sites;
drop policy sites_update on public.sites;
drop policy memberships_insert on public.memberships;
drop policy memberships_update on public.memberships;

create or replace function public.create_organisation_site(
  p_org_id uuid,
  p_name text,
  p_timezone text,
  p_address text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.org_status;
  v_site_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'platform admin required' using errcode = 'insufficient_privilege';
  end if;

  select status into v_status from public.orgs where id = p_org_id for update;
  if v_status is distinct from 'active'::public.org_status then
    raise exception 'organisation is archived or missing' using errcode = 'check_violation';
  end if;

  insert into public.sites (org_id, name, timezone, address)
  values (p_org_id, p_name, p_timezone, p_address)
  returning id into v_site_id;

  perform public.write_audit(
    'platform_admin.created_site',
    p_org_id,
    v_site_id,
    'site',
    v_site_id,
    jsonb_build_object('name', p_name)
  );

  return v_site_id;
end;
$$;

create or replace function public.add_organisation_member(
  p_org_id uuid,
  p_user_id uuid,
  p_site_id uuid,
  p_role public.app_role,
  p_email text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.org_status;
  v_membership_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'platform admin required' using errcode = 'insufficient_privilege';
  end if;

  select status into v_status from public.orgs where id = p_org_id for update;
  if v_status is distinct from 'active'::public.org_status then
    raise exception 'organisation is archived or missing' using errcode = 'check_violation';
  end if;

  if p_role in ('staff'::public.app_role, 'manager'::public.app_role) then
    if p_site_id is null or not exists (
      select 1 from public.sites where id = p_site_id and org_id = p_org_id
    ) then
      raise exception 'site role requires a site in the organisation' using errcode = 'check_violation';
    end if;
  elsif p_site_id is not null then
    raise exception 'organisation-wide role cannot carry a site' using errcode = 'check_violation';
  end if;

  insert into public.memberships (user_id, org_id, site_id, role)
  values (p_user_id, p_org_id, p_site_id, p_role)
  returning id into v_membership_id;

  perform public.write_audit(
    'platform_admin.added_member',
    p_org_id,
    p_site_id,
    'membership',
    v_membership_id,
    jsonb_build_object('email', p_email, 'role', p_role)
  );

  return v_membership_id;
end;
$$;

create or replace function public.update_organisation_member(
  p_membership_id uuid,
  p_site_id uuid,
  p_role public.app_role
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships%rowtype;
  v_status public.org_status;
begin
  if not public.is_platform_admin() then
    raise exception 'platform admin required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_membership
  from public.memberships
  where id = p_membership_id
  for update;
  if not found then
    raise exception 'membership not found' using errcode = 'no_data_found';
  end if;

  select status into v_status
  from public.orgs
  where id = v_membership.org_id
  for update;
  if v_status is distinct from 'active'::public.org_status then
    raise exception 'organisation is archived or missing' using errcode = 'check_violation';
  end if;

  if p_role in ('staff'::public.app_role, 'manager'::public.app_role) then
    if p_site_id is null or not exists (
      select 1 from public.sites where id = p_site_id and org_id = v_membership.org_id
    ) then
      raise exception 'site role requires a site in the organisation' using errcode = 'check_violation';
    end if;
  elsif p_site_id is not null then
    raise exception 'organisation-wide role cannot carry a site' using errcode = 'check_violation';
  end if;

  update public.memberships
  set role = p_role, site_id = p_site_id
  where id = p_membership_id;

  perform public.write_audit(
    'platform_admin.updated_role',
    v_membership.org_id,
    p_site_id,
    'membership',
    p_membership_id,
    jsonb_build_object('role', p_role)
  );

  return v_membership.org_id;
end;
$$;

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

  select status into v_org_status from public.orgs where id = v_org_id for update;
  select * into v_site from public.sites where id = p_site_id for update;
  if not found then
    return null;
  end if;
  if v_org_status <> 'active' then
    raise exception 'organisation is archived' using errcode = 'check_violation';
  end if;
  if exists (select 1 from public.deliveries where site_id = p_site_id)
     or exists (select 1 from public.stock_batches where site_id = p_site_id)
     or exists (select 1 from public.waste_events where site_id = p_site_id)
     or exists (select 1 from public.memberships where site_id = p_site_id) then
    raise exception 'site has activity or assigned members' using errcode = 'check_violation';
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

create or replace function public.organisation_waste_total(p_org_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'platform admin required' using errcode = 'insufficient_privilege';
  end if;

  return coalesce(
    (select sum(w.value_aud) from public.waste_events w where w.org_id = p_org_id),
    0
  );
end;
$$;

create or replace function public.clear_active_expiry_actions()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted bigint;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = 'insufficient_privilege';
  end if;

  delete from public.expiry_actions a
  using public.orgs o
  where o.id = a.org_id
    and o.status = 'active'
    and a.state = 'open';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;
