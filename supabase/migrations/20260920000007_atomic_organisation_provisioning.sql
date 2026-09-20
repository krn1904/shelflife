-- Provision the organisation, first site, owner membership and audit row atomically.

create or replace function public.provision_organisation(
  p_name text,
  p_slug text,
  p_site_name text,
  p_site_timezone text,
  p_site_address text,
  p_owner_user_id uuid,
  p_owner_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_site_id uuid;
  v_membership_id uuid;
begin
  if not public.is_platform_admin() then
    raise exception 'platform admin required' using errcode = 'insufficient_privilege';
  end if;

  insert into public.orgs (name, slug)
  values (p_name, p_slug)
  returning id into v_org_id;

  insert into public.sites (org_id, name, timezone, address)
  values (v_org_id, p_site_name, p_site_timezone, p_site_address)
  returning id into v_site_id;

  insert into public.memberships (user_id, org_id, site_id, role)
  values (p_owner_user_id, v_org_id, null, 'owner')
  returning id into v_membership_id;

  perform public.write_audit(
    'platform_admin.created_organisation',
    v_org_id,
    v_site_id,
    'org',
    v_org_id,
    jsonb_build_object(
      'name', p_name,
      'slug', p_slug,
      'owner_email', p_owner_email,
      'owner_membership_id', v_membership_id
    )
  );

  return jsonb_build_object('org_id', v_org_id, 'site_id', v_site_id);
end;
$$;
