-- Supplier upkeep: rename, deactivate and merge duplicates.
--
-- Staff create suppliers from dockets, so an organisation collects near-duplicates ("CCEP" and
-- "Coca-Cola Europacific") and names as the docket printed them. A manager tidies them up here.
-- Recognising the next docket must survive every change: a supplier's old name is kept as an
-- alias (normalised by the app, the same way intake stores aliases), so a docket that still
-- prints it is matched outright.

/**
 * Deliveries per supplier and when the last one closed, counted under the caller's own RLS:
 * a manager pinned to one site sees that site's deliveries only.
 */
create or replace function public.supplier_activity(p_org_id uuid)
returns table (supplier_id uuid, deliveries bigint, last_delivered_at timestamptz)
language sql
stable
security invoker
set search_path = ''
as $$
  select d.supplier_id, count(*), max(d.closed_at)
  from public.deliveries d
  where d.org_id = p_org_id and d.status = 'closed'
  group by d.supplier_id;
$$;

/**
 * Renames a supplier, sets or clears its ABN, and switches it on or off. Managers and owners,
 * as for the suppliers_update policy. Names are unique ignoring case, the way add_supplier()
 * finds an existing supplier. p_old_alias is the old name, normalised, kept so dockets still
 * printing it are recognised; null when the name did not change in a way that matters.
 *
 * Switching a supplier off hides it from intake, docket recognition included; add_supplier()
 * switches it back on when staff add it again with the same ABN or name.
 */
create or replace function public.update_supplier(
  p_supplier_id uuid,
  p_name text,
  p_abn text,
  p_active boolean,
  p_old_alias text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_supplier public.suppliers%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_abn text := nullif(btrim(coalesce(p_abn, '')), '');
  v_alias text := nullif(btrim(coalesce(p_old_alias, '')), '');
  v_taken text;
begin
  select * into v_supplier from public.suppliers where id = p_supplier_id;
  if not found or not public.can_manage_site(v_supplier.org_id) then
    raise exception 'not permitted to change this supplier' using errcode = 'insufficient_privilege';
  end if;
  if (select status from public.orgs where id = v_supplier.org_id for update) is distinct from 'active'::public.org_status then
    raise exception 'organisation is archived or missing' using errcode = 'check_violation';
  end if;
  select * into v_supplier from public.suppliers where id = p_supplier_id for update;

  if char_length(v_name) not between 2 and 120 then
    raise exception 'a supplier name is 2 to 120 characters' using errcode = 'check_violation';
  end if;
  if v_abn is not null and v_abn !~ '^[0-9]{11}$' then
    raise exception 'an ABN is 11 digits' using errcode = 'check_violation';
  end if;

  select name into v_taken from public.suppliers
  where org_id = v_supplier.org_id and id <> v_supplier.id and lower(name) = lower(v_name);
  if v_taken is not null then
    raise exception 'another supplier is already called %. Merge the two instead', v_taken
      using errcode = 'unique_violation';
  end if;
  select name into v_taken from public.suppliers
  where org_id = v_supplier.org_id and id <> v_supplier.id and abn = v_abn;
  if v_taken is not null then
    raise exception '% already has that ABN. Merge the two instead', v_taken
      using errcode = 'unique_violation';
  end if;

  -- Saving a form nobody changed is not a change: no write, and nothing for the audit log.
  if v_name = v_supplier.name and v_abn is not distinct from v_supplier.abn
     and coalesce(p_active, v_supplier.active) = v_supplier.active then
    return;
  end if;

  update public.suppliers
  set name = v_name, abn = v_abn, active = coalesce(p_active, active)
  where id = v_supplier.id;

  if v_alias is not null and v_name <> v_supplier.name and char_length(v_alias) <= 200 then
    insert into public.supplier_aliases (org_id, supplier_id, alias, created_by)
    values (v_supplier.org_id, v_supplier.id, v_alias, (select auth.uid()))
    on conflict (org_id, alias) do nothing;
  end if;

  insert into public.audit_log (actor_id, action, org_id, subject_type, subject_id, detail)
  values ((select auth.uid()), 'supplier.updated', v_supplier.org_id, 'supplier', v_supplier.id,
          jsonb_build_object(
            'before', jsonb_build_object('name', v_supplier.name, 'abn', v_supplier.abn, 'active', v_supplier.active),
            'after', jsonb_build_object('name', v_name, 'abn', v_abn, 'active', coalesce(p_active, v_supplier.active))));
end;
$$;

/**
 * Folds a duplicate supplier into the one being kept: its deliveries, its confirmed docket
 * names, its own name (as p_alias, normalised) and, when the kept one has none, its ABN.
 * Then the duplicate is deleted. Owners only, like deleting a supplier: it rewrites the
 * history of every site.
 *
 * Two different ABNs are two different businesses, so that merge is refused.
 */
create or replace function public.merge_suppliers(p_keep_id uuid, p_remove_id uuid, p_alias text default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_keep public.suppliers%rowtype;
  v_remove public.suppliers%rowtype;
  v_alias text := nullif(btrim(coalesce(p_alias, '')), '');
  v_moved integer;
  v_aliases integer;
begin
  if p_keep_id is null or p_remove_id is null or p_keep_id = p_remove_id then
    raise exception 'pick two different suppliers' using errcode = 'check_violation';
  end if;
  select * into v_keep from public.suppliers where id = p_keep_id;
  select * into v_remove from public.suppliers where id = p_remove_id;
  if v_keep.id is null or v_remove.id is null or v_keep.org_id <> v_remove.org_id
     or not public.can_manage_org(v_keep.org_id) then
    raise exception 'only an owner can merge suppliers' using errcode = 'insufficient_privilege';
  end if;
  if (select status from public.orgs where id = v_keep.org_id for update) is distinct from 'active'::public.org_status then
    raise exception 'organisation is archived or missing' using errcode = 'check_violation';
  end if;
  -- Locked in id order so two merges of the same pair cannot deadlock.
  perform 1 from public.suppliers where id in (p_keep_id, p_remove_id) order by id for update;
  select * into v_keep from public.suppliers where id = p_keep_id;
  select * into v_remove from public.suppliers where id = p_remove_id;
  if v_keep.id is null or v_remove.id is null then
    raise exception 'that supplier no longer exists' using errcode = 'no_data_found';
  end if;

  if v_keep.abn is not null and v_remove.abn is not null and v_keep.abn <> v_remove.abn then
    raise exception '% and % have different ABNs, so they are different businesses', v_keep.name, v_remove.name
      using errcode = 'check_violation';
  end if;

  -- Deliveries first: the foreign key would stop the delete. Aliases next: they would go with it.
  update public.deliveries set supplier_id = v_keep.id where supplier_id = v_remove.id;
  get diagnostics v_moved = row_count;
  update public.supplier_aliases set supplier_id = v_keep.id where supplier_id = v_remove.id;
  get diagnostics v_aliases = row_count;

  if v_alias is not null and char_length(v_alias) <= 200 then
    insert into public.supplier_aliases (org_id, supplier_id, alias, created_by)
    values (v_keep.org_id, v_keep.id, v_alias, (select auth.uid()))
    on conflict (org_id, alias) do update set supplier_id = excluded.supplier_id;
  end if;

  -- The ABN index is unique per organisation, so it leaves the duplicate before it moves.
  update public.suppliers set abn = null where id = v_remove.id;
  update public.suppliers
  set abn = coalesce(v_keep.abn, v_remove.abn), active = true
  where id = v_keep.id;
  delete from public.suppliers where id = v_remove.id;

  insert into public.audit_log (actor_id, action, org_id, subject_type, subject_id, detail)
  values ((select auth.uid()), 'supplier.merged', v_keep.org_id, 'supplier', v_keep.id,
          jsonb_build_object('kept', v_keep.name, 'removed', v_remove.name, 'removed_id', v_remove.id,
                             'removed_abn', v_remove.abn, 'deliveries_moved', v_moved, 'aliases_moved', v_aliases));
  return v_moved;
end;
$$;

revoke execute on function public.supplier_activity(uuid) from public, anon;
revoke execute on function public.update_supplier(uuid, text, text, boolean, text) from public, anon;
revoke execute on function public.merge_suppliers(uuid, uuid, text) from public, anon;
grant execute on function public.supplier_activity(uuid) to authenticated;
grant execute on function public.update_supplier(uuid, text, text, boolean, text) to authenticated;
grant execute on function public.merge_suppliers(uuid, uuid, text) to authenticated;
