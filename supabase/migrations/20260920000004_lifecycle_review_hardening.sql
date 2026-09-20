-- Follow-up hardening for organisation lifecycle invariants.
--
-- Lifecycle transitions and their audit rows are one database transaction, normal
-- authenticated clients cannot update orgs directly, and service-role writes to admin-
-- managed child rows serialize against archival.

drop policy orgs_update on public.orgs;

create or replace function public.archive_organisation(
  p_org_id uuid,
  p_confirm_slug text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org public.orgs%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'platform admin required' using errcode = 'insufficient_privilege';
  end if;

  select * into v_org
  from public.orgs
  where id = p_org_id
  for update;

  if not found then
    raise exception 'organisation not found' using errcode = 'no_data_found';
  end if;
  if v_org.status = 'archived' then
    return;
  end if;
  if p_confirm_slug is distinct from v_org.slug then
    raise exception 'organisation slug did not match' using errcode = 'check_violation';
  end if;

  update public.orgs
  set status = 'archived',
      archived_at = now(),
      archived_by = (select auth.uid())
  where id = p_org_id;

  perform public.write_audit(
    'platform_admin.archived_organisation',
    p_org_id,
    null,
    'org',
    p_org_id,
    null
  );
end;
$$;

create or replace function public.restore_organisation(p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.org_status;
begin
  if not public.is_platform_admin() then
    raise exception 'platform admin required' using errcode = 'insufficient_privilege';
  end if;

  select status into v_status
  from public.orgs
  where id = p_org_id
  for update;

  if not found then
    raise exception 'organisation not found' using errcode = 'no_data_found';
  end if;
  if v_status = 'active' then
    return;
  end if;

  update public.orgs
  set status = 'active',
      archived_at = null,
      archived_by = null
  where id = p_org_id;

  perform public.write_audit(
    'platform_admin.restored_organisation',
    p_org_id,
    null,
    'org',
    p_org_id,
    null
  );
end;
$$;

-- Lock the parent row while an admin-managed child row is changed. An archive racing
-- this trigger must commit either before the mutation (which is then rejected) or after
-- it (which gives the operations an unambiguous order).
create or replace function public.require_active_org_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_status public.org_status;
begin
  v_org_id := case when tg_op = 'DELETE' then old.org_id else new.org_id end;

  select status into v_status
  from public.orgs
  where id = v_org_id
  for share;

  if v_status is distinct from 'active'::public.org_status then
    raise exception 'organisation is archived or missing' using errcode = 'check_violation';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create trigger sites_require_active_org
  before insert or update or delete on public.sites
  for each row execute function public.require_active_org_write();

create trigger memberships_require_active_org
  before insert or update or delete on public.memberships
  for each row execute function public.require_active_org_write();

-- Subscription scope follows the row's organisation, not merely whether the caller has
-- some other active membership.
drop policy push_select on public.push_subscriptions;
create policy push_select on public.push_subscriptions for select to authenticated
  using (
    user_id = (select auth.uid())
    and org_id in (select public.auth_org_ids())
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
  );

drop policy push_delete on public.push_subscriptions;
create policy push_delete on public.push_subscriptions for delete to authenticated
  using (
    user_id = (select auth.uid())
    and org_id in (select public.auth_org_ids())
  );

-- Platform events remain platform-only. The demo clock keeps its existing, narrower
-- authorization: an owner/platform admin of an active org explicitly flagged is_demo.
create or replace function public.write_audit(
  p_action text,
  p_org_id uuid default null,
  p_site_id uuid default null,
  p_subject_type text default null,
  p_subject_id uuid default null,
  p_detail jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_authorized boolean := false;
begin
  if (select auth.uid()) is null or p_org_id is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  if p_action ~ '^platform_admin\.' then
    v_authorized := public.is_platform_admin();
  elsif p_action = 'demo.jump_days' then
    v_authorized := public.can_manage_org(p_org_id)
      and exists (
        select 1 from public.orgs o
        where o.id = p_org_id and o.is_demo and o.status = 'active'
      );
  end if;

  if not v_authorized
     or not exists (select 1 from public.orgs o where o.id = p_org_id) then
    raise exception 'invalid or unauthorized audit event' using errcode = 'insufficient_privilege';
  end if;

  if p_site_id is not null and not exists (
    select 1 from public.sites s where s.id = p_site_id and s.org_id = p_org_id
  ) then
    raise exception 'audit site is outside organisation' using errcode = 'check_violation';
  end if;

  insert into public.audit_log
    (actor_id, action, org_id, site_id, subject_type, subject_id, detail)
  values
    ((select auth.uid()), p_action, p_org_id, p_site_id, p_subject_type, p_subject_id, p_detail)
  returning id into v_id;

  return v_id;
end;
$$;
