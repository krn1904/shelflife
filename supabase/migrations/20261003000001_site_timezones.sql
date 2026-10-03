-- Every site's calendar comes from its own timezone, so it has to be chosen and real.

-- No silent default: a site created without a timezone would quietly take Melbourne's
-- calendar, and every "today" it sees would be a day off if it is not in Melbourne.
alter table public.sites alter column timezone drop default;

-- A timezone name Postgres knows ('Australia/Perth'), not free text ('Perth', 'AEST').
create or replace function public.is_valid_timezone(p_timezone text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (select 1 from pg_catalog.pg_timezone_names where name = p_timezone);
$$;

alter table public.sites
  add constraint sites_timezone_valid check (public.is_valid_timezone(timezone));
