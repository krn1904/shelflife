-- Owners and managers add and remove their own people, without the platform admin.
--
--   owner (or platform admin)  staff or managers, at any site of their organisation
--   manager                    staff only, at the site they manage
--
-- Nobody adds an owner or platform admin this way, removes an organisation-wide membership,
-- or removes themselves. The app checks the same rules first (src/lib/people/rules.ts) to
-- give a plain message; these functions are the authority.
--
-- The login itself is created by the server with the service key, then linked here. A login
-- that already belongs to another organisation is refused, so one tenant cannot pull another
-- tenant's people (or learn which emails have accounts) through this screen.

-- Who may manage `p_role` at `p_site_id`. Security definer like the other RLS helpers, since
-- it reads memberships.
create or replace function public.can_manage_site_role(p_site_id uuid, p_role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_role not in ('staff'::public.app_role, 'manager'::public.app_role) then false
    when public.is_platform_admin() then true
    else exists (
      select 1
      from public.sites s
      join public.memberships m on m.org_id = s.org_id and m.user_id = (select auth.uid())
      where s.id = p_site_id
        and (
          m.role = 'owner'
          or (m.role = 'manager' and m.site_id = p_site_id and p_role = 'staff')
        )
    )
  end;
$$;

create or replace function public.add_site_member(
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
  v_org_id uuid;
  v_status public.org_status;
  v_membership_id uuid;
begin
  select org_id into v_org_id from public.sites where id = p_site_id;
  if v_org_id is null then
    raise exception 'site not found' using errcode = 'no_data_found';
  end if;

  -- Lock the organisation so an archive cannot land between the check and the insert.
  select status into v_status from public.orgs where id = v_org_id for update;
  if v_status is distinct from 'active'::public.org_status then
    raise exception 'organisation is archived or missing' using errcode = 'check_violation';
  end if;

  if not public.can_manage_site_role(p_site_id, p_role) then
    raise exception 'not permitted to add that role here' using errcode = 'insufficient_privilege';
  end if;

  if exists (select 1 from public.memberships where user_id = p_user_id and org_id <> v_org_id) then
    raise exception 'that login belongs to another organisation' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.memberships where user_id = p_user_id and org_id = v_org_id) then
    raise exception 'already a member of this organisation' using errcode = 'unique_violation';
  end if;

  insert into public.memberships (user_id, org_id, site_id, role)
  values (p_user_id, v_org_id, p_site_id, p_role)
  returning id into v_membership_id;

  insert into public.audit_log (actor_id, action, org_id, site_id, subject_type, subject_id, detail)
  values ((select auth.uid()), 'member.added', v_org_id, p_site_id, 'membership', v_membership_id,
          jsonb_build_object('email', p_email, 'role', p_role));

  return v_membership_id;
end;
$$;

-- Takes away someone's access to the site. Their login stays, so their past deliveries,
-- answers and waste stay attributed, and they can be added again later.
create or replace function public.remove_site_member(p_membership_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.memberships%rowtype;
  v_status public.org_status;
begin
  select * into v_membership from public.memberships where id = p_membership_id;
  if not found then
    return null;
  end if;

  select status into v_status from public.orgs where id = v_membership.org_id for update;
  select * into v_membership from public.memberships where id = p_membership_id for update;
  if not found then
    return null;
  end if;
  if v_status is distinct from 'active'::public.org_status then
    raise exception 'organisation is archived or missing' using errcode = 'check_violation';
  end if;

  if v_membership.user_id = (select auth.uid()) then
    raise exception 'you cannot remove yourself' using errcode = 'insufficient_privilege';
  end if;
  if v_membership.site_id is null
     or not public.can_manage_site_role(v_membership.site_id, v_membership.role) then
    raise exception 'not permitted to remove that person' using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_log (actor_id, action, org_id, site_id, subject_type, subject_id, detail)
  values ((select auth.uid()), 'member.removed', v_membership.org_id, v_membership.site_id,
          'membership', v_membership.id, jsonb_build_object('role', v_membership.role));

  delete from public.memberships where id = v_membership.id;
  return v_membership.org_id;
end;
$$;

revoke execute on function public.add_site_member(uuid, uuid, public.app_role, text) from public, anon;
revoke execute on function public.remove_site_member(uuid) from public, anon;
grant execute on function public.add_site_member(uuid, uuid, public.app_role, text) to authenticated;
grant execute on function public.remove_site_member(uuid) to authenticated;
