-- Web Push subscriptions and the audit trail.

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  site_id uuid references public.sites(id) on delete cascade,
  -- The endpoint URL is the browser's own identifier for this subscription, and it is
  -- what the push service dedupes on. Unique here so re-subscribing on the same device
  -- updates the row instead of accumulating one per visit.
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  -- A push service returns 404/410 when a subscription is dead. Recording that rather
  -- than deleting the row keeps the digest job from retrying it every morning forever,
  -- and leaves evidence of why someone stopped getting notifications.
  failed_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.push_subscriptions (user_id);
create index on public.push_subscriptions (site_id) where failed_at is null;

-- Who did what to whom. Written for the actions a tenant would want to question later:
-- a platform admin looking at their data, a role change, a waste correction.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  org_id uuid references public.orgs(id) on delete set null,
  site_id uuid references public.sites(id) on delete set null,
  subject_type text,
  subject_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index on public.audit_log (org_id, created_at desc);
create index on public.audit_log (actor_id, created_at desc);

create trigger set_updated_at before update on public.push_subscriptions
  for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;
alter table public.audit_log          enable row level security;

-- A push subscription is a device, so it belongs to its owner and nobody else —
-- not even their manager. Scoped to the user rather than the org on purpose.
create policy push_select on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy push_insert on public.push_subscriptions for insert to authenticated
  with check (user_id = (select auth.uid()) and org_id in (select public.auth_org_ids()));
create policy push_update on public.push_subscriptions for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy push_delete on public.push_subscriptions for delete to authenticated
  using (user_id = (select auth.uid()));

-- A tenant can read its own audit trail — that is the point of keeping one. Nobody can
-- write to it through the API or amend it afterwards: entries are made by SECURITY
-- DEFINER functions and by the service role, so the record cannot be quietly tidied up.
create policy audit_select on public.audit_log for select to authenticated
  using (public.can_manage_org(org_id) or public.is_platform_admin());

/**
 * Records an audit entry under the caller's own identity.
 *
 * SECURITY DEFINER so the table can stay closed to direct inserts: without that, anyone
 * able to write to audit_log could also forge entries, which makes the log worth nothing.
 */
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
  if (select auth.uid()) is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;

  insert into public.audit_log
    (actor_id, action, org_id, site_id, subject_type, subject_id, detail)
  values
    ((select auth.uid()), p_action, p_org_id, p_site_id, p_subject_type, p_subject_id, p_detail)
  returning id into v_id;

  return v_id;
end;
$$;
