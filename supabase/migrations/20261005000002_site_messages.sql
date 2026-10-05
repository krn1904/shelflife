-- Site messages: a manager writes a short note to everyone on staff at their site, and each
-- staff member taps Got it. The manager sees who has read it. One-way: staff don't reply.

create table public.site_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  site_id uuid not null references public.sites(id) on delete cascade,
  -- Same limit as validateMessageBody() in the app.
  body text not null check (char_length(btrim(body)) between 1 and 500),
  sent_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index site_messages_site_created_idx on public.site_messages (site_id, created_at desc);

-- An archived organisation is read-only, messages included.
create trigger site_messages_require_active_org
  before insert or update or delete on public.site_messages
  for each row execute function public.require_active_org_write();

alter table public.site_messages enable row level security;

-- Everyone at the site reads them; its manager or the owner sends and deletes them, as
-- themselves. org_id must be the site's own org, so a message cannot be filed under another
-- organisation. No update policy: a sent message is not edited, only deleted.
create policy site_messages_select on public.site_messages for select to authenticated
  using (site_id in (select public.auth_site_ids()) or public.is_platform_admin());
create policy site_messages_insert on public.site_messages for insert to authenticated
  with check (
    public.can_manage_site(org_id)
    and site_id in (select public.auth_site_ids())
    and org_id = (select s.org_id from public.sites s where s.id = site_id)
    and sent_by = (select auth.uid())
  );
create policy site_messages_delete on public.site_messages for delete to authenticated
  using (public.can_manage_site(org_id) and site_id in (select public.auth_site_ids()));

-- Who has read what ------------------------------------------------------------------
create table public.site_message_reads (
  message_id uuid not null references public.site_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

create index site_message_reads_user_idx on public.site_message_reads (user_id);

alter table public.site_message_reads enable row level security;

-- Visible messages only: the subqueries read site_messages through its own policy.
-- A reader sees their own rows; the site's manager or owner sees everyone's, which is
-- the "read by" list. Staff never see who else has read.
create policy site_message_reads_select on public.site_message_reads for select to authenticated
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.site_messages m
      where m.id = message_id and public.can_manage_site(m.org_id)
    )
  );
-- Only for yourself, only on a message you can see. Written once (Got it twice is a no-op).
create policy site_message_reads_insert on public.site_message_reads for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.site_messages m where m.id = message_id)
  );
