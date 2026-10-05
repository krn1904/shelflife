-- Reminder plans: each site's settings, what staff have already done to a batch, and one
-- function that records each tap on the Today list.

-- Settings per site ----------------------------------------------------------------
-- A site with no row uses the defaults below. The engine applies the same defaults, so
-- a site works the same whether or not a manager has ever opened the screen.
create table public.reminder_settings (
  site_id uuid primary key references public.sites(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  -- Groups, by shelf life on arrival (expiry date minus the day it arrived).
  short_max_days integer not null default 21,
  medium_max_days integer not null default 90,
  -- Days before expiry that each reminder appears.
  short_markdown_days integer not null default 2,
  medium_markdown_days integer not null default 7,
  long_check_days integer not null default 30,
  long_markdown_days integer not null default 7,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Same rules as validateReminderSettings() in the app: no reminder may fire on the day
  -- the shortest item of its group arrives.
  check (short_max_days >= 2 and short_max_days < medium_max_days and medium_max_days <= 3650),
  check (short_markdown_days >= 1 and short_markdown_days < short_max_days),
  check (medium_markdown_days >= 1 and medium_markdown_days <= short_max_days),
  check (long_markdown_days >= 1 and long_markdown_days < long_check_days),
  check (long_check_days <= medium_max_days)
);

create trigger set_updated_at before update on public.reminder_settings
  for each row execute function public.set_updated_at();

alter table public.reminder_settings enable row level security;

-- Anyone at the site can read them; only its manager or the owner can change them.
-- org_id must be the site's own org, so a row cannot be filed under another organisation.
create policy reminder_settings_select on public.reminder_settings for select to authenticated
  using (site_id in (select public.auth_site_ids()) or public.is_platform_admin());
create policy reminder_settings_insert on public.reminder_settings for insert to authenticated
  with check (
    public.can_manage_site(org_id)
    and site_id in (select public.auth_site_ids())
    and org_id = (select s.org_id from public.sites s where s.id = site_id)
  );
create policy reminder_settings_update on public.reminder_settings for update to authenticated
  using (public.can_manage_site(org_id) and site_id in (select public.auth_site_ids()))
  with check (
    public.can_manage_site(org_id)
    and site_id in (select public.auth_site_ids())
    and org_id = (select s.org_id from public.sites s where s.id = site_id)
  );

-- What staff already did to a batch -------------------------------------------------
-- The engine reads these so a batch moves on to its next reminder instead of repeating
-- the one staff already answered. A batch's created_at is the day it arrived (batches
-- are written when the delivery closes), which sets its group.
alter table public.stock_batches
  add column checked_at timestamptz,
  add column marked_down_at timestamptz;

-- Waste value -----------------------------------------------------------------------
-- Cost per unit: the site's own cost if a manager set one, else the price on the docket
-- the batch came from, else nothing (0).
create or replace function public.batch_unit_cost(p_batch public.stock_batches)
returns numeric
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(
    (select sp.unit_cost from public.site_products sp
      where sp.site_id = p_batch.site_id and sp.product_id = p_batch.product_id),
    (select dl.unit_cost from public.delivery_lines dl where dl.id = p_batch.delivery_line_id),
    0
  );
$$;

-- record_waste, unchanged except that it now values waste with batch_unit_cost().
create or replace function public.record_waste(
  p_batch_id uuid,
  p_qty integer,
  p_reason public.waste_reason,
  p_note text default null,
  p_client_id uuid default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.stock_batches;
  v_existing uuid;
  v_id uuid;
begin
  if p_client_id is not null then
    select id into v_existing from public.waste_events where client_id = p_client_id;
    if found then
      return v_existing;
    end if;
  end if;

  select * into v_batch from public.stock_batches where id = p_batch_id for update;
  if not found then
    raise exception 'batch not found' using errcode = 'no_data_found';
  end if;
  if p_qty <= 0 or p_qty > v_batch.qty_remaining then
    raise exception 'cannot waste % of % remaining', p_qty, v_batch.qty_remaining
      using errcode = 'check_violation';
  end if;

  insert into public.waste_events
    (org_id, site_id, product_id, batch_id, qty, reason, value_aud, note, wasted_by, client_id)
  values
    (v_batch.org_id, v_batch.site_id, v_batch.product_id, v_batch.id, p_qty, p_reason,
     public.batch_unit_cost(v_batch) * p_qty, p_note, (select auth.uid()), p_client_id)
  returning id into v_id;

  update public.stock_batches
  set qty_remaining = qty_remaining - p_qty,
      status = case when qty_remaining - p_qty = 0 then 'pulled'::public.batch_status
                    else status end
  where id = v_batch.id;

  return v_id;
end;
$$;

-- One tap on the Today list ---------------------------------------------------------
create type public.batch_step as enum ('checked', 'marked_down', 'sold', 'pulled');

/**
 * Records a staff answer for a batch and closes its open reminder.
 *
 *   checked      long-life early check done; next stop is half price
 *   marked_down  on half price now; next stop is the last day
 *   sold         gone from the shelf; closes the batch as sold
 *   pulled       binned; records p_qty (default: all left) as expired waste, closes it
 *
 * Safe to send twice (offline replay, two phones): a closed batch is left alone and the
 * timestamps keep their first value. Security invoker, so RLS decides who may do this.
 */
create or replace function public.resolve_batch_step(
  p_batch_id uuid,
  p_step public.batch_step,
  p_qty integer default null,
  p_client_id uuid default null
)
returns public.batch_status
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_batch public.stock_batches;
  v_qty integer;
begin
  -- Lock the batch so two phones answering at once cannot both write waste.
  select * into v_batch from public.stock_batches where id = p_batch_id for update;
  if not found then
    raise exception 'batch not found' using errcode = 'no_data_found';
  end if;

  if v_batch.status = 'active' then
    case p_step
      when 'checked' then
        update public.stock_batches set checked_at = coalesce(checked_at, now())
        where id = v_batch.id;

      when 'marked_down' then
        update public.stock_batches set marked_down_at = coalesce(marked_down_at, now())
        where id = v_batch.id;

      when 'sold' then
        update public.stock_batches set qty_remaining = 0, status = 'sold_through'
        where id = v_batch.id;

      when 'pulled' then
        v_qty := coalesce(p_qty, v_batch.qty_remaining);
        if v_qty < 0 or v_qty > v_batch.qty_remaining then
          raise exception 'cannot pull % of % remaining', v_qty, v_batch.qty_remaining
            using errcode = 'check_violation';
        end if;
        -- Whatever was not binned was sold, so the batch closes either way.
        if v_qty > 0 then
          insert into public.waste_events
            (org_id, site_id, product_id, batch_id, qty, reason, value_aud, wasted_by, client_id)
          values
            (v_batch.org_id, v_batch.site_id, v_batch.product_id, v_batch.id, v_qty, 'expired',
             public.batch_unit_cost(v_batch) * v_qty, (select auth.uid()), p_client_id);
        end if;
        update public.stock_batches set qty_remaining = 0, status = 'pulled'
        where id = v_batch.id;
    end case;
  end if;

  -- Today's reminder for this batch is answered. Tomorrow's run plans the next one.
  update public.expiry_actions
  set state = 'done', actioned_by = (select auth.uid()), actioned_at = now()
  where batch_id = v_batch.id and state = 'open';

  select status into v_batch.status from public.stock_batches where id = v_batch.id;
  return v_batch.status;
end;
$$;

-- Demo time machine -----------------------------------------------------------------
-- Same as before, plus batch arrival and answer times, so a jump keeps every batch in
-- the group it arrived in (its shelf life on arrival must not shrink).
create or replace function public.demo_jump_days(p_org_id uuid, p_days integer)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_is_demo boolean;
  v_moved integer;
  v_shift interval := make_interval(days => p_days);
begin
  if p_days <= 0 or p_days > 365 then
    raise exception 'p_days must be between 1 and 365' using errcode = 'check_violation';
  end if;

  select o.is_demo into v_is_demo from public.orgs o where o.id = p_org_id;
  if v_is_demo is null then
    raise exception 'org not found' using errcode = 'no_data_found';
  end if;
  if not v_is_demo then
    raise exception 'refusing to move time for a live tenant' using errcode = 'insufficient_privilege';
  end if;
  if not public.can_manage_org(p_org_id) then
    raise exception 'not permitted' using errcode = 'insufficient_privilege';
  end if;

  update public.stock_batches
  set expiry_date = expiry_date - p_days,
      created_at = created_at - v_shift,
      checked_at = checked_at - v_shift,
      marked_down_at = marked_down_at - v_shift
  where org_id = p_org_id;
  select count(*) into v_moved
  from public.stock_batches where org_id = p_org_id and expiry_date is not null;

  update public.deliveries
  set received_at = received_at - v_shift,
      closed_at = closed_at - v_shift
  where org_id = p_org_id;

  update public.waste_events
  set wasted_at = wasted_at - v_shift
  where org_id = p_org_id;

  perform public.write_audit(
    'demo.jump_days', p_org_id, null, 'org', p_org_id,
    jsonb_build_object('days', p_days, 'batches_moved', v_moved)
  );

  return v_moved;
end;
$$;
