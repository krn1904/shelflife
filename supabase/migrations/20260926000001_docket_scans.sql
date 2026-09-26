-- Dockets read from a photo, with the expiry dates the operator entered.
--
-- A staging record, deliberately apart from deliveries: a scanned line is the docket's own
-- words ("EA I Pura Milk 2Lt Bottle"), not yet linked to a catalogue product, so it cannot
-- become a delivery_line or stock_batch until that link exists. Cells are kept as printed,
-- under the docket's own column headings, so nothing is lost before matching is built.

create table public.docket_scans (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  supplier_name text,
  docket_number text,
  -- As printed ("16 Sep 26", "23/09/2026"); formats vary too much to trust a parse yet.
  docket_date text,
  -- The chosen table's column headings, in order.
  columns jsonb not null default '[]'::jsonb check (jsonb_typeof(columns) = 'array'),
  -- The operator said this delivery needs no expiry dates (tobacco, accessories…).
  expiry_not_needed boolean not null default false,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
create index on public.docket_scans (site_id, created_at desc);

create table public.docket_scan_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  scan_id uuid not null references public.docket_scans(id) on delete cascade,
  position integer not null check (position >= 0),
  -- One string per column of the scan's headings, as corrected by the operator.
  cells jsonb not null check (jsonb_typeof(cells) = 'array'),
  expiry_date date,
  created_at timestamptz not null default now(),
  unique (scan_id, position)
);
create index on public.docket_scan_lines (scan_id);

alter table public.docket_scans enable row level security;
alter table public.docket_scan_lines enable row level security;

-- Reads follow the site; writes also require the org, so a posted id cannot widen scope.
create policy docket_scans_select on public.docket_scans for select to authenticated
  using (site_id in (select public.auth_site_ids()) or public.is_platform_admin());
create policy docket_scans_insert on public.docket_scans for insert to authenticated
  with check (
    site_id in (select public.auth_site_ids())
    and org_id in (select public.auth_org_ids())
    and exists (select 1 from public.sites s where s.id = site_id and s.org_id = docket_scans.org_id)
  );

-- A line is reachable exactly when its scan is, and belongs to the scan's organisation.
create policy docket_scan_lines_select on public.docket_scan_lines for select to authenticated
  using (exists (select 1 from public.docket_scans d
                 where d.id = scan_id
                   and (d.site_id in (select public.auth_site_ids()) or public.is_platform_admin())));
create policy docket_scan_lines_insert on public.docket_scan_lines for insert to authenticated
  with check (exists (select 1 from public.docket_scans d
                      where d.id = scan_id and d.org_id = docket_scan_lines.org_id
                        and d.site_id in (select public.auth_site_ids())));

/**
 * Saves a docket and its lines in one transaction, so a failure never leaves a docket
 * without its lines. SECURITY INVOKER: the caller's own RLS decides whether the site is
 * theirs, exactly as a direct insert would.
 */
create or replace function public.save_docket_scan(
  p_site_id uuid,
  p_supplier_name text,
  p_docket_number text,
  p_docket_date text,
  p_columns jsonb,
  p_expiry_not_needed boolean,
  p_lines jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_scan_id uuid := gen_random_uuid();
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'a docket needs at least one line' using errcode = 'check_violation';
  end if;
  -- The operator's answer, enforced here too: without it every line needs its date.
  if not p_expiry_not_needed and exists (
    select 1 from jsonb_array_elements(p_lines) line
    where coalesce(line ->> 'expiry_date', '') = ''
  ) then
    raise exception 'every line needs an expiry date' using errcode = 'check_violation';
  end if;

  select s.org_id into v_org_id from public.sites s where s.id = p_site_id;
  if v_org_id is null then
    raise exception 'site not found' using errcode = 'no_data_found';
  end if;

  insert into public.docket_scans
    (id, org_id, site_id, supplier_name, docket_number, docket_date, columns, expiry_not_needed)
  values
    (v_scan_id, v_org_id, p_site_id, nullif(trim(p_supplier_name), ''), nullif(trim(p_docket_number), ''),
     nullif(trim(p_docket_date), ''), coalesce(p_columns, '[]'::jsonb), p_expiry_not_needed);

  insert into public.docket_scan_lines (org_id, scan_id, position, cells, expiry_date)
  select v_org_id, v_scan_id, (line.ord - 1)::integer, line.value -> 'cells',
         nullif(line.value ->> 'expiry_date', '')::date
  from jsonb_array_elements(p_lines) with ordinality as line(value, ord);

  return v_scan_id;
end;
$$;

revoke execute on function public.save_docket_scan(uuid, text, text, text, jsonb, boolean, jsonb) from public, anon;
grant execute on function public.save_docket_scan(uuid, text, text, text, jsonb, boolean, jsonb) to authenticated;
