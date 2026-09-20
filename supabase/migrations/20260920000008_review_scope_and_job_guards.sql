-- Close remaining review gaps: owner-scoped site/member writes, org-wide push
-- subscriptions, consistent membership lock order, and job writes that recheck
-- organisation lifecycle before they commit.

-- Owners keep a direct API for their own organisation. Platform-admin child writes
-- stay on the audited RPCs from 20260920000006_audited_admin_writes.sql.
create policy sites_insert on public.sites for insert to authenticated
  with check (public.has_org_role(org_id, array['owner']::public.app_role[]));
create policy sites_update on public.sites for update to authenticated
  using (public.has_org_role(org_id, array['owner']::public.app_role[]))
  with check (public.has_org_role(org_id, array['owner']::public.app_role[]));

create policy memberships_insert on public.memberships for insert to authenticated
  with check (public.has_org_role(org_id, array['owner']::public.app_role[]));
create policy memberships_update on public.memberships for update to authenticated
  using (public.has_org_role(org_id, array['owner']::public.app_role[]))
  with check (public.has_org_role(org_id, array['owner']::public.app_role[]));
create policy memberships_delete on public.memberships for delete to authenticated
  using (public.has_org_role(org_id, array['owner']::public.app_role[]));

-- A null site_id is organisation-wide delivery. Only owners (and platform admins)
-- may create or retarget that shape; staff and managers stay pinned to a site in
-- their organisation.
drop policy push_insert on public.push_subscriptions;
create policy push_insert on public.push_subscriptions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and org_id in (select public.auth_org_ids())
    and (
      (
        push_subscriptions.site_id is null
        and (
          public.has_org_role(push_subscriptions.org_id, array['owner']::public.app_role[])
          or public.is_platform_admin()
        )
      )
      or (
        push_subscriptions.site_id is not null
        and push_subscriptions.site_id in (select public.auth_site_ids())
        and exists (
          select 1 from public.sites s
          where s.id = push_subscriptions.site_id
            and s.org_id = push_subscriptions.org_id
        )
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
      (
        push_subscriptions.site_id is null
        and (
          public.has_org_role(push_subscriptions.org_id, array['owner']::public.app_role[])
          or public.is_platform_admin()
        )
      )
      or (
        push_subscriptions.site_id is not null
        and push_subscriptions.site_id in (select public.auth_site_ids())
        and exists (
          select 1 from public.sites s
          where s.id = push_subscriptions.site_id
            and s.org_id = push_subscriptions.org_id
        )
      )
    )
  );

-- Lock the organisation before the membership row so this matches
-- remove_organisation_member and cannot deadlock against it.
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
  v_org_id uuid;
  v_membership public.memberships%rowtype;
  v_status public.org_status;
begin
  if not public.is_platform_admin() then
    raise exception 'platform admin required' using errcode = 'insufficient_privilege';
  end if;

  select org_id into v_org_id
  from public.memberships
  where id = p_membership_id;
  if not found then
    raise exception 'membership not found' using errcode = 'no_data_found';
  end if;

  select status into v_status
  from public.orgs
  where id = v_org_id
  for update;
  if v_status is distinct from 'active'::public.org_status then
    raise exception 'organisation is archived or missing' using errcode = 'check_violation';
  end if;

  select * into v_membership
  from public.memberships
  where id = p_membership_id
  for update;
  if not found then
    raise exception 'membership not found' using errcode = 'no_data_found';
  end if;
  if v_membership.org_id is distinct from v_org_id then
    raise exception 'membership organisation changed' using errcode = 'check_violation';
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

  perform 1
  from public.orgs
  where status = 'active'
  order by id
  for update;

  delete from public.expiry_actions a
  using public.orgs o
  where o.id = a.org_id
    and o.status = 'active'
    and a.state = 'open';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- Service-role job writers lock each referenced organisation and skip archived ones
-- so an archive that commits after the job's snapshot cannot still insert work.
create or replace function public.insert_active_expiry_actions(p_actions jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_inserted bigint := 0;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = 'insufficient_privilege';
  end if;

  if p_actions is null or jsonb_typeof(p_actions) <> 'array' then
    raise exception 'actions payload must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;

  for v_org_id in
    select distinct (elem->>'org_id')::uuid
    from jsonb_array_elements(p_actions) elem
    where elem->>'org_id' is not null
    order by 1
  loop
    perform 1 from public.orgs where id = v_org_id for update;
  end loop;

  insert into public.expiry_actions (org_id, site_id, batch_id, action, due_date)
  select
    (elem->>'org_id')::uuid,
    (elem->>'site_id')::uuid,
    (elem->>'batch_id')::uuid,
    (elem->>'action')::public.expiry_action_kind,
    (elem->>'due_date')::date
  from jsonb_array_elements(p_actions) elem
  join public.orgs o on o.id = (elem->>'org_id')::uuid
  where o.status = 'active'::public.org_status;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create or replace function public.upsert_active_rotation_checks(p_checks jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_inserted bigint := 0;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'service role required' using errcode = 'insufficient_privilege';
  end if;

  if p_checks is null or jsonb_typeof(p_checks) <> 'array' then
    raise exception 'checks payload must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;

  for v_org_id in
    select distinct (elem->>'org_id')::uuid
    from jsonb_array_elements(p_checks) elem
    where elem->>'org_id' is not null
    order by 1
  loop
    perform 1 from public.orgs where id = v_org_id for update;
  end loop;

  insert into public.rotation_checks (org_id, site_id, fixture, check_date)
  select
    (elem->>'org_id')::uuid,
    (elem->>'site_id')::uuid,
    elem->>'fixture',
    (elem->>'check_date')::date
  from jsonb_array_elements(p_checks) elem
  join public.orgs o on o.id = (elem->>'org_id')::uuid
  where o.status = 'active'::public.org_status
  on conflict (site_id, fixture, check_date) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

create trigger expiry_actions_require_active_org
  before insert or update on public.expiry_actions
  for each row execute function public.require_active_org_write();

create trigger rotation_checks_require_active_org
  before insert or update on public.rotation_checks
  for each row execute function public.require_active_org_write();
