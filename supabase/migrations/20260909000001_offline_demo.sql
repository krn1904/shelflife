-- Offline replay safety, and the demo tenant's time machine.

-- A client-generated id, assigned before the write leaves the phone. It is what makes a
-- replayed write a no-op instead of a duplicate: the outbox cannot know whether a request
-- that timed out was actually applied, so it retries, and this is what makes retrying safe.
alter table public.waste_events
  add column client_id uuid;

create unique index waste_events_client_id_key
  on public.waste_events (client_id) where client_id is not null;

-- Demo orgs can have their clock moved. Flagged on the org rather than inferred from a
-- slug so nothing can accidentally time-travel a real tenant's stock.
alter table public.orgs
  add column is_demo boolean not null default false;

/**
 * record_waste, now idempotent.
 *
 * When p_client_id has already been recorded the existing id is returned and nothing is
 * written — a replayed offline mutation must not decrement the batch a second time.
 */
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
  v_unit_cost numeric(10,2);
  v_existing uuid;
  v_id uuid;
begin
  if p_client_id is not null then
    select id into v_existing from public.waste_events where client_id = p_client_id;
    if found then
      return v_existing;
    end if;
  end if;

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
    (org_id, site_id, product_id, batch_id, qty, reason, value_aud, note, wasted_by, client_id)
  values
    (v_batch.org_id, v_batch.site_id, v_batch.product_id, v_batch.id, p_qty, p_reason,
     coalesce(v_unit_cost, 0) * p_qty, p_note, (select auth.uid()), p_client_id)
  returning id into v_id;

  update public.stock_batches
  set qty_remaining = qty_remaining - p_qty,
      status = case when qty_remaining - p_qty = 0 then 'pulled'::public.batch_status
                    else status end
  where id = v_batch.id;

  return v_id;
end;
$$;

/**
 * Moves a demo tenant's stock forward in time.
 *
 * A visitor should not have to wait a week to watch the expiry engine fire. Shifting the
 * dates backwards is equivalent to the calendar moving forwards, and it keeps the engine
 * itself honest — the engine is not told it is a demo and does exactly what it does in
 * production.
 *
 * Refuses outright on a non-demo org. This function can destroy a real tenant's expiry
 * data, so the guard is a hard error rather than a filtered no-op.
 */
create or replace function public.demo_jump_days(p_org_id uuid, p_days integer)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_is_demo boolean;
  v_moved integer;
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
  set expiry_date = expiry_date - p_days
  where org_id = p_org_id and expiry_date is not null;
  get diagnostics v_moved = row_count;

  -- Deliveries and waste move too, so the dashboards stay coherent rather than showing
  -- stock that expires before it was ever received.
  update public.deliveries
  set received_at = received_at - make_interval(days => p_days),
      closed_at = closed_at - make_interval(days => p_days)
  where org_id = p_org_id;

  update public.waste_events
  set wasted_at = wasted_at - make_interval(days => p_days)
  where org_id = p_org_id;

  perform public.write_audit(
    'demo.jump_days', p_org_id, null, 'org', p_org_id,
    jsonb_build_object('days', p_days, 'batches_moved', v_moved)
  );

  return v_moved;
end;
$$;
