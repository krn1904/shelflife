-- What the expiry engine produces, and what staff do about it.
--
-- expiry_actions are DERIVED state: every open row is deleted and regenerated from the
-- current batches on each nightly run. A few thousand rows recompute in milliseconds, and
-- a full recompute is always correct — there is no incremental-diffing bug to have.
-- Rows that have been actioned (done/dismissed) are history and are never regenerated.

create type public.expiry_action_kind as enum ('check', 'markdown', 'pull');
create type public.action_state as enum ('open', 'done', 'dismissed');
create type public.waste_reason as enum
  ('expired', 'damaged', 'spoiled', 'recalled', 'staff_error', 'other');

create table public.expiry_actions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  batch_id uuid not null references public.stock_batches(id) on delete cascade,
  action public.expiry_action_kind not null,
  due_date date not null,
  state public.action_state not null default 'open',
  actioned_by uuid references auth.users(id) on delete set null,
  actioned_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One open action per batch. The engine relies on this: it is what stops a re-run from
-- stacking five rows on the same batch as it crosses each threshold.
create unique index expiry_actions_one_open_per_batch
  on public.expiry_actions (batch_id) where state = 'open';
create index on public.expiry_actions (site_id, state, due_date);

create table public.rotation_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  fixture text not null,
  check_date date not null,
  state public.action_state not null default 'open',
  checked_by uuid references auth.users(id) on delete set null,
  checked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, fixture, check_date)
);
create index on public.rotation_checks (site_id, check_date);

create table public.waste_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  batch_id uuid references public.stock_batches(id) on delete set null,
  qty integer not null check (qty > 0),
  reason public.waste_reason not null,
  -- Valued at the moment of waste. site_products.unit_cost moves, and a report of what
  -- last year cost must not silently re-price itself when someone edits a cost today.
  value_aud numeric(10,2) check (value_aud is null or value_aud >= 0),
  note text,
  wasted_by uuid references auth.users(id) on delete set null,
  wasted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index on public.waste_events (site_id, wasted_at desc);
create index on public.waste_events (product_id);

-- Every scheduled run writes one row here, successful or not, so a silently dead cron is
-- visible in the platform-admin portal rather than discovered months later.
create table public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  ran_at timestamptz not null default now(),
  ok boolean not null,
  processed integer not null default 0,
  skipped integer not null default 0,
  reason text,
  duration_ms integer
);
create index on public.job_runs (job, ran_at desc);

create trigger set_updated_at before update on public.expiry_actions
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.rotation_checks
  for each row execute function public.set_updated_at();

-- RLS ------------------------------------------------------------------------

alter table public.expiry_actions  enable row level security;
alter table public.rotation_checks enable row level security;
alter table public.waste_events    enable row level security;
alter table public.job_runs        enable row level security;

create policy expiry_actions_select on public.expiry_actions for select to authenticated
  using (site_id in (select public.auth_site_ids()) or public.is_platform_admin());
-- Staff tick actions off; only the engine (service role, which bypasses RLS) creates them.
create policy expiry_actions_update on public.expiry_actions for update to authenticated
  using (site_id in (select public.auth_site_ids()))
  with check (site_id in (select public.auth_site_ids()));
create policy expiry_actions_delete on public.expiry_actions for delete to authenticated
  using (public.can_manage_site(org_id));

create policy rotation_checks_select on public.rotation_checks for select to authenticated
  using (site_id in (select public.auth_site_ids()) or public.is_platform_admin());
create policy rotation_checks_update on public.rotation_checks for update to authenticated
  using (site_id in (select public.auth_site_ids()))
  with check (site_id in (select public.auth_site_ids()));
-- A fixture can be checked ad hoc before the nightly job has created the row.
create policy rotation_checks_insert on public.rotation_checks for insert to authenticated
  with check (site_id in (select public.auth_site_ids()) and org_id in (select public.auth_org_ids()));

create policy waste_events_select on public.waste_events for select to authenticated
  using (site_id in (select public.auth_site_ids()) or public.is_platform_admin());
create policy waste_events_insert on public.waste_events for insert to authenticated
  with check (site_id in (select public.auth_site_ids()) and org_id in (select public.auth_org_ids()));
-- Waste is a financial record. Correcting one is a manager's call, not a staff member's.
create policy waste_events_update on public.waste_events for update to authenticated
  using (public.can_manage_site(org_id)) with check (public.can_manage_site(org_id));
create policy waste_events_delete on public.waste_events for delete to authenticated
  using (public.can_manage_org(org_id));

-- Job history is cross-tenant operational data, so only platform admins see it.
create policy job_runs_select on public.job_runs for select to authenticated
  using (public.is_platform_admin());

-- Decrementing a batch when stock is wasted --------------------------------------
-- Done in the database rather than in two application writes, so a crash between them
-- cannot leave a waste event recorded against stock that was never taken off the batch.

create or replace function public.record_waste(
  p_batch_id uuid,
  p_qty integer,
  p_reason public.waste_reason,
  p_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.stock_batches;
  v_unit_cost numeric(10,2);
  v_id uuid;
begin
  -- FOR UPDATE so two staff wasting the same batch at once cannot both read the same
  -- qty_remaining and drive it negative.
  select * into v_batch from public.stock_batches where id = p_batch_id for update;
  if not found then
    raise exception 'batch not found' using errcode = 'no_data_found';
  end if;
  if p_qty <= 0 or p_qty > v_batch.qty_remaining then
    raise exception 'cannot waste % of % remaining', p_qty, v_batch.qty_remaining
      using errcode = 'check_violation';
  end if;

  select sp.unit_cost into v_unit_cost
  from public.site_products sp
  where sp.site_id = v_batch.site_id and sp.product_id = v_batch.product_id;

  insert into public.waste_events
    (org_id, site_id, product_id, batch_id, qty, reason, value_aud, note, wasted_by)
  values
    (v_batch.org_id, v_batch.site_id, v_batch.product_id, v_batch.id, p_qty, p_reason,
     coalesce(v_unit_cost, 0) * p_qty, p_note, (select auth.uid()))
  returning id into v_id;

  update public.stock_batches
  set qty_remaining = qty_remaining - p_qty,
      status = case when qty_remaining - p_qty = 0 then 'pulled'::public.batch_status
                    else status end
  where id = v_batch.id;

  return v_id;
end;
$$;
