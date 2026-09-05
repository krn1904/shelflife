-- Delivery intake: the docket, its lines, and the stock batches a closed docket creates.
--
-- The shape here is deliberate. A docket LINE is one SKU with one quantity — "Coke Zero
-- 1.25L x 2 boxes" is a single line, not two. A BATCH is one SKU at one expiry date.
-- Normally that is one batch per line; a line splits into several batches only in the
-- uncommon case where one SKU turns up carrying two different dates, so expiry lives on
-- the batch and never on the line.

create type public.delivery_status as enum ('draft', 'closed');

-- How much to trust a date. 'predicted' came from history or a catalogue default and
-- was never looked at; 'confirmed' means someone checked it against the box; 'manual'
-- was typed in. The expiry engine treats them alike, but a manager triaging a surprise
-- write-off needs to know which dates nobody actually read.
create type public.expiry_source as enum ('predicted', 'confirmed', 'manual');

create type public.batch_status as enum ('active', 'pulled', 'sold_through');

create table public.deliveries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  docket_number text,
  docket_photo_path text,
  status public.delivery_status not null default 'draft',
  received_by uuid references auth.users(id) on delete set null,
  received_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.deliveries (site_id, status);
create index on public.deliveries (supplier_id, site_id, closed_at desc);

-- qty_docketed and qty_received are separate from day one. The docket says what the
-- supplier claims they sent; qty_received is what staff actually counted. Keeping both
-- means v2's invoice reconciliation needs no migration — and any gap between them is
-- already a deliberate edit, which is exactly the signal reconciliation consumes.
create table public.delivery_lines (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  delivery_id uuid not null references public.deliveries(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  qty_docketed integer not null default 0 check (qty_docketed >= 0),
  qty_received integer not null default 0 check (qty_received >= 0),
  unit_cost numeric(10,2) check (unit_cost is null or unit_cost >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (delivery_id, product_id)
);
create index on public.delivery_lines (delivery_id);
create index on public.delivery_lines (product_id);

create table public.stock_batches (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  delivery_line_id uuid references public.delivery_lines(id) on delete set null,
  expiry_date date,
  expiry_source public.expiry_source not null default 'predicted',
  expiry_photo_path text,
  qty_received integer not null check (qty_received >= 0),
  qty_remaining integer not null check (qty_remaining >= 0),
  status public.batch_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- You cannot have more left than ever arrived.
  check (qty_remaining <= qty_received)
);
-- The expiry engine's hot path: active batches at a site, soonest first.
create index on public.stock_batches (site_id, status, expiry_date);
create index on public.stock_batches (product_id, site_id);
create index on public.stock_batches (delivery_line_id);

create trigger set_updated_at before update on public.deliveries
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.delivery_lines
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.stock_batches
  for each row execute function public.set_updated_at();

-- RLS ------------------------------------------------------------------------
-- Reads follow the site; writes additionally require the row's site to be one the
-- caller can actually see, so a posted site_id cannot widen anyone's scope.

alter table public.deliveries     enable row level security;
alter table public.delivery_lines enable row level security;
alter table public.stock_batches  enable row level security;

create policy deliveries_select on public.deliveries for select to authenticated
  using (site_id in (select public.auth_site_ids()) or public.is_platform_admin());
create policy deliveries_insert on public.deliveries for insert to authenticated
  with check (site_id in (select public.auth_site_ids()) and org_id in (select public.auth_org_ids()));
create policy deliveries_update on public.deliveries for update to authenticated
  using (site_id in (select public.auth_site_ids()))
  with check (site_id in (select public.auth_site_ids()));
-- Only a manager may delete a delivery; staff correct one by editing it.
create policy deliveries_delete on public.deliveries for delete to authenticated
  using (public.can_manage_site(org_id));

-- A line is reachable exactly when its delivery is.
create policy delivery_lines_select on public.delivery_lines for select to authenticated
  using (exists (select 1 from public.deliveries d
                 where d.id = delivery_id and d.site_id in (select public.auth_site_ids()))
         or public.is_platform_admin());
create policy delivery_lines_insert on public.delivery_lines for insert to authenticated
  with check (exists (select 1 from public.deliveries d
                      where d.id = delivery_id and d.site_id in (select public.auth_site_ids())));
create policy delivery_lines_update on public.delivery_lines for update to authenticated
  using (exists (select 1 from public.deliveries d
                 where d.id = delivery_id and d.site_id in (select public.auth_site_ids())))
  with check (exists (select 1 from public.deliveries d
                      where d.id = delivery_id and d.site_id in (select public.auth_site_ids())));
create policy delivery_lines_delete on public.delivery_lines for delete to authenticated
  using (exists (select 1 from public.deliveries d
                 where d.id = delivery_id and d.site_id in (select public.auth_site_ids())));

create policy stock_batches_select on public.stock_batches for select to authenticated
  using (site_id in (select public.auth_site_ids()) or public.is_platform_admin());
create policy stock_batches_insert on public.stock_batches for insert to authenticated
  with check (site_id in (select public.auth_site_ids()) and org_id in (select public.auth_org_ids()));
create policy stock_batches_update on public.stock_batches for update to authenticated
  using (site_id in (select public.auth_site_ids()))
  with check (site_id in (select public.auth_site_ids()));
create policy stock_batches_delete on public.stock_batches for delete to authenticated
  using (public.can_manage_site(org_id));

-- Docket and date photos -------------------------------------------------------
-- Private bucket. Paths are '<org_id>/<site_id>/<delivery_id>/<file>', and the policies
-- below read those first two segments, so a user can only reach photos belonging to an
-- org they are a member of and a site they can see.

insert into storage.buckets (id, name, public)
values ('dockets', 'dockets', false)
on conflict (id) do nothing;

create policy dockets_select on storage.objects for select to authenticated
  using (
    bucket_id = 'dockets'
    and (storage.foldername(name))[1]::uuid in (select public.auth_org_ids())
    and (storage.foldername(name))[2]::uuid in (select public.auth_site_ids())
  );

create policy dockets_insert on storage.objects for insert to authenticated
  with check (
    bucket_id = 'dockets'
    and (storage.foldername(name))[1]::uuid in (select public.auth_org_ids())
    and (storage.foldername(name))[2]::uuid in (select public.auth_site_ids())
  );

-- Photos are evidence for supplier disputes, so replacing one is allowed but deleting
-- it is a manager's call.
create policy dockets_update on storage.objects for update to authenticated
  using (
    bucket_id = 'dockets'
    and (storage.foldername(name))[2]::uuid in (select public.auth_site_ids())
  );
