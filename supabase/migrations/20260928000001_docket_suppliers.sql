-- Reading the docket at intake: suppliers recognised from the docket itself, and the
-- docket's text kept on the delivery it was read for.
--
-- Staff create suppliers during intake, which suppliers_insert (managers and up) does not
-- allow, so creation goes through add_supplier(). Aliases are only written through
-- remember_supplier_docket(); neither has a direct write policy.

-- An ABN identifies a business where a printed name does not. Optional: a local bakery's
-- docket may not print one, and suppliers created before this had none.
alter table public.suppliers
  add column abn text check (abn ~ '^[0-9]{11}$'),
  add column created_by uuid references auth.users(id) on delete set null;
create unique index suppliers_org_abn on public.suppliers (org_id, abn) where abn is not null;

-- A printed name an operator has confirmed for a supplier ("CCEP AUSTRALIA PTY LTD" is
-- Coca-Cola Europacific), stored normalised so the next docket matches it outright.
create table public.supplier_aliases (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete cascade,
  alias text not null check (alias <> ''),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, alias)
);
create index on public.supplier_aliases (supplier_id);

alter table public.supplier_aliases enable row level security;
create policy supplier_aliases_select on public.supplier_aliases for select to authenticated
  using (org_id in (select public.auth_org_ids()) or public.is_platform_admin());

-- What the docket said, as the OCR read it: the intake screen parses this into lines, and it
-- stays with the delivery as the record of what the docket claimed.
alter table public.deliveries add column docket_reading jsonb;

-- Creates a supplier for the caller's organisation, or returns the one it already is: the
-- same ABN, or the same name ignoring case. A deactivated match is brought back, since a
-- docket from it has just arrived.
create or replace function public.add_supplier(
  p_org_id uuid,
  p_name text,
  p_abn text default null
)
returns table (supplier_id uuid, existing boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := btrim(p_name);
  v_abn text := nullif(btrim(coalesce(p_abn, '')), '');
  v_id uuid;
begin
  if p_org_id is null or p_org_id not in (select public.auth_org_ids()) then
    raise exception 'not a member of this organisation' using errcode = 'insufficient_privilege';
  end if;
  -- Holds off an archive until this supplier is in.
  perform 1 from public.orgs where id = p_org_id and status = 'active' for share;
  if not found then
    raise exception 'organisation is archived or missing' using errcode = 'check_violation';
  end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    raise exception 'supplier name must be 2 to 120 characters' using errcode = 'check_violation';
  end if;
  if v_abn is not null and v_abn !~ '^[0-9]{11}$' then
    raise exception 'ABN must be 11 digits' using errcode = 'check_violation';
  end if;

  select s.id into v_id from public.suppliers s
  where s.org_id = p_org_id
    and ((v_abn is not null and s.abn = v_abn) or lower(s.name) = lower(v_name))
  order by (s.abn = v_abn) desc nulls last
  limit 1;

  if v_id is not null then
    update public.suppliers s
    set active = true,
        abn = coalesce(s.abn, case when not exists (
          select 1 from public.suppliers o where o.org_id = p_org_id and o.abn = v_abn
        ) then v_abn end)
    where s.id = v_id;
    return query select v_id, true;
    return;
  end if;

  insert into public.suppliers (org_id, name, abn, created_by)
  values (p_org_id, v_name, v_abn, auth.uid())
  returning id into v_id;
  return query select v_id, false;
end;
$$;

-- Remembers what a confirmed supplier's docket printed: its name as an alias (the latest
-- confirmation wins if that name pointed elsewhere), and its ABN if none is on file and no
-- other supplier holds it.
create or replace function public.remember_supplier_docket(
  p_supplier_id uuid,
  p_alias text,
  p_abn text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id uuid;
  v_alias text := nullif(btrim(coalesce(p_alias, '')), '');
  v_abn text := nullif(btrim(coalesce(p_abn, '')), '');
begin
  select org_id into v_org_id from public.suppliers where id = p_supplier_id;
  if v_org_id is null or v_org_id not in (select public.auth_org_ids()) then
    raise exception 'not a member of this organisation' using errcode = 'insufficient_privilege';
  end if;

  if v_alias is not null and length(v_alias) <= 200 then
    insert into public.supplier_aliases (org_id, supplier_id, alias, created_by)
    values (v_org_id, p_supplier_id, v_alias, auth.uid())
    on conflict (org_id, alias) do update set supplier_id = excluded.supplier_id;
  end if;

  if v_abn ~ '^[0-9]{11}$' then
    update public.suppliers s set abn = v_abn
    where s.id = p_supplier_id and s.abn is null
      and not exists (select 1 from public.suppliers o where o.org_id = v_org_id and o.abn = v_abn);
  end if;
end;
$$;
