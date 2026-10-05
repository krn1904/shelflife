-- A manager corrects a closed delivery, and reviews the products staff added from dockets.
--
-- Staff count fast at the back door and sometimes get it wrong. The fix belongs on the
-- delivery itself, so the record, the stock and the expiry board all move together. Each
-- correction keeps what staff first entered, so the manager's change is visible next to it.

alter table public.delivery_lines
  add column staff_qty_docketed integer,
  add column staff_qty_received integer,
  add column corrected_at timestamptz,
  add column corrected_by uuid references auth.users(id) on delete set null;

-- A product added from a docket carries the docket's wording and a guessed tracking mode.
-- It stays on the manager's review list until someone has looked at it.
alter table public.products
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references auth.users(id) on delete set null;

/**
 * True when the caller manages this site: an owner of its organisation, or a manager whose
 * membership covers it. Unlike can_manage_site(org), a manager pinned to another site of the
 * same organisation does not pass.
 */
create or replace function public.can_correct_site(p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_platform_admin() or exists (
    select 1
    from public.sites s
    join public.orgs o on o.id = s.org_id
    join public.memberships m on m.org_id = s.org_id and m.user_id = (select auth.uid())
    where s.id = p_site_id
      and o.status = 'active'
      and (m.role = 'owner' or (m.role = 'manager' and (m.site_id is null or m.site_id = p_site_id)))
  );
$$;

/**
 * Corrects one line of a closed delivery and its stock in one transaction.
 *
 * p_batches is the line's dated stock as it should be: [{ id | null, expiry_date, qty }].
 * A listed id is updated, a null id is a new date, and a batch left out is removed. Their
 * quantities may add up to less than received: the rest is stock nobody dated yet.
 *
 * Stock already written off or sold through cannot be un-received, so a batch never drops
 * below what has left it. Setting both quantities to 0 removes the line.
 */
create or replace function public.correct_delivery_line(
  p_line_id uuid,
  p_qty_docketed integer,
  p_qty_received integer,
  p_batches jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_line public.delivery_lines%rowtype;
  v_delivery public.deliveries%rowtype;
  v_mode public.tracking_mode;
  v_batch public.stock_batches%rowtype;
  v_wanted jsonb;
  v_qty integer;
  v_date date;
  v_used integer;
  v_remaining integer;
  v_dated integer := 0;
  v_before jsonb;
begin
  select * into v_line from public.delivery_lines where id = p_line_id for update;
  if not found then
    raise exception 'that line no longer exists' using errcode = 'no_data_found';
  end if;
  select * into v_delivery from public.deliveries where id = v_line.delivery_id for update;

  if not public.can_correct_site(v_delivery.site_id) then
    raise exception 'not permitted to correct this delivery' using errcode = 'insufficient_privilege';
  end if;
  if v_delivery.status <> 'closed' then
    raise exception 'staff are still receiving this delivery' using errcode = 'check_violation';
  end if;

  if p_qty_docketed is null or p_qty_received is null
     or p_qty_docketed not between 0 and 9999 or p_qty_received not between 0 and 9999 then
    raise exception 'quantities must be between 0 and 9999' using errcode = 'check_violation';
  end if;
  if p_batches is null or jsonb_typeof(p_batches) <> 'array' then
    raise exception 'batches must be a JSON array' using errcode = 'invalid_parameter_value';
  end if;

  select tracking_mode into v_mode from public.products where id = v_line.product_id;
  if v_mode <> 'batch' and jsonb_array_length(p_batches) > 0 then
    raise exception 'this product is not tracked by expiry date' using errcode = 'check_violation';
  end if;

  for v_wanted in select * from jsonb_array_elements(p_batches) loop
    v_qty := (v_wanted->>'qty')::integer;
    v_date := (v_wanted->>'expiry_date')::date;
    if v_qty is null or v_qty <= 0 or v_date is null then
      raise exception 'every date needs a quantity above 0' using errcode = 'check_violation';
    end if;
    if v_wanted->>'id' is not null and not exists (
      select 1 from public.stock_batches
      where id = (v_wanted->>'id')::uuid and delivery_line_id = v_line.id
    ) then
      raise exception 'that stock is not from this line' using errcode = 'check_violation';
    end if;
    v_dated := v_dated + v_qty;
  end loop;
  if v_dated > p_qty_received then
    raise exception 'the dates add up to % but only % arrived', v_dated, p_qty_received
      using errcode = 'check_violation';
  end if;

  select jsonb_build_object(
    'qty_docketed', v_line.qty_docketed,
    'qty_received', v_line.qty_received,
    'batches', coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'expiry_date', b.expiry_date, 'qty', b.qty_received)), '[]'::jsonb)
  ) into v_before
  from public.stock_batches b where b.delivery_line_id = v_line.id;

  -- Existing stock: updated when listed, removed when not.
  for v_batch in
    select * from public.stock_batches where delivery_line_id = v_line.id order by id for update
  loop
    select elem into v_wanted
    from jsonb_array_elements(p_batches) elem
    where (elem->>'id')::uuid = v_batch.id;

    v_used := v_batch.qty_received - v_batch.qty_remaining;

    if v_wanted is null then
      if v_used > 0 or exists (select 1 from public.waste_events where batch_id = v_batch.id) then
        raise exception '% of the stock dated % has already left the shelf, so it cannot be removed',
          v_used, v_batch.expiry_date using errcode = 'check_violation';
      end if;
      delete from public.stock_batches where id = v_batch.id;
      continue;
    end if;

    v_qty := (v_wanted->>'qty')::integer;
    v_date := (v_wanted->>'expiry_date')::date;
    if v_qty < v_used then
      raise exception '% of the stock dated % has already left the shelf', v_used, v_batch.expiry_date
        using errcode = 'check_violation';
    end if;

    -- Sold through means staff said the shelf is empty: it stays empty whatever the count.
    v_remaining := case when v_batch.status = 'sold_through' then 0 else v_qty - v_used end;

    if v_qty <> v_batch.qty_received or v_date is distinct from v_batch.expiry_date then
      update public.stock_batches
      set qty_received = v_qty,
          qty_remaining = v_remaining,
          expiry_date = v_date,
          expiry_source = case when v_date is distinct from v_batch.expiry_date
                               then 'manual'::public.expiry_source else expiry_source end,
          status = case when v_batch.status = 'sold_through' then status
                        when v_remaining = 0 then 'pulled'::public.batch_status
                        else 'active'::public.batch_status end
      where id = v_batch.id;
      -- The open reminder was planned from the old figures; tonight's run plans it afresh.
      delete from public.expiry_actions where batch_id = v_batch.id and state = 'open';
    end if;
  end loop;

  -- New dates. created_at is the arrival day the expiry engine counts from, so it is the
  -- delivery's, not today's.
  insert into public.stock_batches
    (org_id, site_id, product_id, delivery_line_id, expiry_date, expiry_source,
     qty_received, qty_remaining, created_at)
  select v_delivery.org_id, v_delivery.site_id, v_line.product_id, v_line.id,
         (elem->>'expiry_date')::date, 'manual', (elem->>'qty')::integer, (elem->>'qty')::integer,
         coalesce(v_delivery.closed_at, v_delivery.created_at)
  from jsonb_array_elements(p_batches) elem
  where elem->>'id' is null;

  if p_qty_docketed = 0 and p_qty_received = 0 then
    delete from public.delivery_lines where id = v_line.id;
  else
    update public.delivery_lines
    set staff_qty_docketed = coalesce(staff_qty_docketed, qty_docketed),
        staff_qty_received = coalesce(staff_qty_received, qty_received),
        qty_docketed = p_qty_docketed,
        qty_received = p_qty_received,
        corrected_at = now(),
        corrected_by = (select auth.uid())
    where id = v_line.id;
  end if;

  insert into public.audit_log (actor_id, action, org_id, site_id, subject_type, subject_id, detail)
  values ((select auth.uid()), 'delivery.line_corrected', v_delivery.org_id, v_delivery.site_id,
          'delivery_line', v_line.id,
          jsonb_build_object(
            'delivery_id', v_delivery.id,
            'product_id', v_line.product_id,
            'before', v_before,
            'after', jsonb_build_object('qty_docketed', p_qty_docketed, 'qty_received', p_qty_received,
                                        'batches', p_batches)));

  return v_delivery.id;
end;
$$;

/**
 * A manager's review of a product staff added from a docket: its name and details, how it
 * is tracked, and, for rotation stock, the fixture it is checked on at this site.
 *
 * Rotation is only checked through a fixture, so it cannot be chosen without one. When the
 * product stops being dated, its dated stock at this site leaves the expiry board: untouched
 * batches were never real and are removed; ones staff already acted on are closed as sold
 * through so their history stays. Returns how many batches left the board.
 */
create or replace function public.review_docket_product(
  p_product_id uuid,
  p_site_id uuid,
  p_name text,
  p_brand text,
  p_size text,
  p_barcode text,
  p_tracking_mode public.tracking_mode,
  p_shelf_life_days integer,
  p_fixture text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_product public.products%rowtype;
  v_site_org uuid;
  v_fixture text := nullif(btrim(p_fixture), '');
  v_retired integer := 0;
  v_removed integer := 0;
begin
  select * into v_product from public.products where id = p_product_id for update;
  if not found or v_product.org_id is null then
    raise exception 'only products added from your own dockets can be changed here'
      using errcode = 'insufficient_privilege';
  end if;
  select org_id into v_site_org from public.sites where id = p_site_id;
  if v_site_org is distinct from v_product.org_id or not public.can_correct_site(p_site_id) then
    raise exception 'not permitted to review this product' using errcode = 'insufficient_privilege';
  end if;

  if char_length(btrim(coalesce(p_name, ''))) not between 2 and 120 then
    raise exception 'give the product a name' using errcode = 'check_violation';
  end if;
  if p_tracking_mode = 'rotation' and v_fixture is null then
    raise exception 'rotation stock needs a fixture to be checked on' using errcode = 'check_violation';
  end if;

  update public.products
  set name = btrim(p_name),
      brand = nullif(btrim(p_brand), ''),
      size = nullif(btrim(p_size), ''),
      barcode = nullif(btrim(p_barcode), ''),
      tracking_mode = p_tracking_mode,
      default_shelf_life_days = p_shelf_life_days,
      reviewed_at = now(),
      reviewed_by = (select auth.uid())
  where id = v_product.id;

  if v_fixture is not null then
    insert into public.site_products (org_id, site_id, product_id, fixture)
    values (v_product.org_id, p_site_id, v_product.id, v_fixture)
    on conflict (site_id, product_id) do update
      set fixture = excluded.fixture, tracking_mode_override = null, active = true;
  end if;

  if p_tracking_mode <> 'batch' then
    delete from public.stock_batches b
    where b.product_id = v_product.id and b.site_id = p_site_id and b.status = 'active'
      and b.qty_remaining = b.qty_received
      and not exists (select 1 from public.waste_events w where w.batch_id = b.id)
      and not exists (select 1 from public.expiry_actions a where a.batch_id = b.id and a.state <> 'open');
    get diagnostics v_removed = row_count;

    update public.stock_batches
    set status = 'sold_through', qty_remaining = 0
    where product_id = v_product.id and site_id = p_site_id and status = 'active';
    get diagnostics v_retired = row_count;

    delete from public.expiry_actions a
    using public.stock_batches b
    where a.batch_id = b.id and a.state = 'open'
      and b.product_id = v_product.id and b.site_id = p_site_id;
  end if;

  insert into public.audit_log (actor_id, action, org_id, site_id, subject_type, subject_id, detail)
  values ((select auth.uid()), 'product.reviewed', v_product.org_id, p_site_id, 'product', v_product.id,
          jsonb_build_object(
            'before', jsonb_build_object('name', v_product.name, 'brand', v_product.brand, 'size', v_product.size,
                                         'barcode', v_product.barcode, 'tracking_mode', v_product.tracking_mode,
                                         'default_shelf_life_days', v_product.default_shelf_life_days),
            'after', jsonb_build_object('name', btrim(p_name), 'tracking_mode', p_tracking_mode,
                                        'barcode', nullif(btrim(p_barcode), ''), 'fixture', v_fixture,
                                        'shelf_life_days', p_shelf_life_days),
            'batches_off_board', v_removed + v_retired));

  return v_removed + v_retired;
end;
$$;

revoke execute on function public.can_correct_site(uuid) from public, anon;
revoke execute on function public.correct_delivery_line(uuid, integer, integer, jsonb) from public, anon;
revoke execute on function public.review_docket_product(uuid, uuid, text, text, text, text, public.tracking_mode, integer, text) from public, anon;
grant execute on function public.can_correct_site(uuid) to authenticated;
grant execute on function public.correct_delivery_line(uuid, integer, integer, jsonb) to authenticated;
grant execute on function public.review_docket_product(uuid, uuid, text, text, text, text, public.tracking_mode, integer, text) to authenticated;
