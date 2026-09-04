-- Tenancy, identity and the product catalogue. Everything else in the system hangs off these.

create type public.app_role as enum ('platform_admin', 'owner', 'manager', 'staff');

-- How much expiry discipline a product is worth — the system's central design decision.
-- Short-life items are rotated by eye, so staff are never asked to record their dates.
create type public.tracking_mode as enum ('rotation', 'batch', 'none');

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.sites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  timezone text not null default 'Australia/Melbourne',
  address text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.sites (org_id);

-- Mirrors auth.users so we can show who received a delivery without exposing the auth schema.
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A null site_id grants every site in the org (owners, platform admins).
create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  org_id uuid not null references public.orgs(id) on delete cascade,
  site_id uuid references public.sites(id) on delete cascade,
  role public.app_role not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, org_id, site_id)
);
create index on public.memberships (user_id);
create index on public.memberships (org_id);

create table public.suppliers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  contact_note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, name)
);
create index on public.suppliers (org_id);

-- Deliberately GLOBAL, not per-tenant. There is no free comprehensive AU barcode database,
-- so the catalogue grows as sites scan unknown barcodes and every tenant benefits.
-- Nothing commercially sensitive lives here; prices and par levels are in site_products.
create table public.products (
  id uuid primary key default gen_random_uuid(),
  barcode text unique,
  name text not null,
  brand text,
  size text,
  category text,
  default_shelf_life_days integer check (default_shelf_life_days is null or default_shelf_life_days > 0),
  tracking_mode public.tracking_mode not null default 'batch',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.products (barcode);
create index on public.products (lower(name));

-- Per-site commercial overrides on a global product.
create table public.site_products (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  retail_price numeric(10,2) check (retail_price is null or retail_price >= 0),
  unit_cost numeric(10,2) check (unit_cost is null or unit_cost >= 0),
  par_level integer check (par_level is null or par_level >= 0),
  fixture text,
  tracking_mode_override public.tracking_mode,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, product_id)
);
create index on public.site_products (org_id);
create index on public.site_products (site_id);

create trigger set_updated_at before update on public.orgs
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.sites
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.memberships
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.suppliers
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.products
  for each row execute function public.set_updated_at();
create trigger set_updated_at before update on public.site_products
  for each row execute function public.set_updated_at();

-- Keep profiles in step with auth.users automatically.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
