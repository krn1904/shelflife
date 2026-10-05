-- Run the expiry engine every night at 03:00 Australia/Melbourne, from the database itself.
--
-- pg_cron only knows UTC, and Melbourne is UTC+10 in winter and UTC+11 in summer, so a
-- single UTC time would drift an hour twice a year. The job fires at both 16:00 and 17:00
-- UTC and only calls the engine when it is 03:00 in Melbourne: exactly one of the two,
-- every day of the year, including the two days the clocks change.
--
-- The call needs the project URL and the CRON_SECRET the engine checks. Neither belongs in
-- a migration, so they are read from Supabase Vault by name. Set them once per project:
--
--   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret');
--
-- Without them the job records a failed run in job_runs instead of failing silently.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Whether p_at is the engine's hour. Pure, so the RLS suite can check the DST days.
create or replace function public.expiry_engine_due(p_at timestamptz default now())
returns boolean
language sql
stable
set search_path = ''
as $$
  select extract(hour from p_at at time zone 'Australia/Melbourne') = 3;
$$;

revoke all on function public.expiry_engine_due(timestamptz) from public, anon, authenticated;
grant execute on function public.expiry_engine_due(timestamptz) to service_role;

-- Not exposed through the API (only public and graphql_public are), so only the cron job
-- and the database owner can call the engine this way.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Returns the pg_net request id, or null when it is not the engine's hour or the Vault
-- secrets are missing. The engine writes its own job_runs row once it runs; this only
-- writes one when it could not even make the call.
create or replace function private.run_expiry_engine(p_at timestamptz default now())
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_url text;
  v_secret text;
begin
  if not public.expiry_engine_due(p_at) then
    return null;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'cron_secret';

  if v_url is null or v_secret is null then
    insert into public.job_runs (job, ok, reason)
    values ('expiry-engine', false,
            'not called: set the project_url and cron_secret Vault secrets');
    return null;
  end if;

  return net.http_post(
    url := rtrim(v_url, '/') || '/functions/v1/expiry-engine',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

revoke all on function private.run_expiry_engine(timestamptz) from public, anon, authenticated;

-- Scheduling by name replaces an existing job of the same name, so re-running is harmless.
select cron.schedule('expiry-engine-nightly', '0 16,17 * * *', 'select private.run_expiry_engine()');
