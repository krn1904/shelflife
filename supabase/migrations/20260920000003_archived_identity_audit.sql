-- Close identity-adjacent paths when an organisation is archived and make the audit
-- writer enforce the claim carried by each platform-admin event.

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
    join public.orgs o on o.id = mine.org_id
    where mine.user_id = (select auth.uid())
      and theirs.user_id = other_user
      and o.status = 'active'
  );
$$;

drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (
    (id = (select auth.uid()) and public.has_active_membership())
    or public.shares_org_with(id)
    or public.is_platform_admin()
  );

drop policy profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (
    id = (select auth.uid())
    and (public.has_active_membership() or public.is_platform_admin())
  )
  with check (
    id = (select auth.uid())
    and (public.has_active_membership() or public.is_platform_admin())
  );

drop policy push_select on public.push_subscriptions;
create policy push_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()) and public.has_active_membership());

drop policy push_update on public.push_subscriptions;
create policy push_update on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid()) and public.has_active_membership())
  with check (
    user_id = (select auth.uid())
    and public.has_active_membership()
    and org_id in (select public.auth_org_ids())
  );

drop policy push_delete on public.push_subscriptions;
create policy push_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()) and public.has_active_membership());

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
begin
  if (select auth.uid()) is null or not public.is_platform_admin() then
    raise exception 'platform admin required' using errcode = 'insufficient_privilege';
  end if;

  if p_action is null or p_action !~ '^platform_admin\.'
     or p_org_id is null
     or not exists (select 1 from public.orgs o where o.id = p_org_id) then
    raise exception 'invalid platform audit event' using errcode = 'check_violation';
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
