-- Replies to site messages. Each staff member has their own private thread under a message
-- with the site's manager and owner: staff answer, the manager answers back, and other staff
-- never see it. Nothing is pushed, so each reader's last visit to a thread is kept to show
-- what is new.

-- Is this person on staff at this site? Security definer like the RLS helpers, because it
-- reads memberships from inside a policy.
create or replace function public.is_staff_at_site(p_user_id uuid, p_site_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.memberships m
    where m.user_id = p_user_id
      and m.site_id = p_site_id
      and m.role = 'staff'
  );
$$;

revoke execute on function public.is_staff_at_site(uuid, uuid) from public, anon;
grant execute on function public.is_staff_at_site(uuid, uuid) to authenticated;

-- A reply's organisation and site are its message's, enforced by the key below for every
-- writer, the service key included.
alter table public.site_messages
  add constraint site_messages_id_org_site_key unique (id, org_id, site_id);

create table public.site_message_replies (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null,
  org_id uuid not null,
  site_id uuid not null,
  -- Whose thread this is. A staff member's reply has author_id = staff_id; a manager's answer
  -- has the manager as author and the staff member it answers as staff_id.
  staff_id uuid not null references auth.users(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null,
  -- Same limit as site_messages.body and validateReplyBody() in the app.
  body text not null check (char_length(btrim(body)) between 1 and 500),
  created_at timestamptz not null default now(),
  foreign key (message_id, org_id, site_id)
    references public.site_messages (id, org_id, site_id) on delete cascade
);

create index site_message_replies_thread_idx
  on public.site_message_replies (message_id, staff_id, created_at);
create index site_message_replies_site_created_idx
  on public.site_message_replies (site_id, created_at desc);

create trigger site_message_replies_require_active_org
  before insert or update or delete on public.site_message_replies
  for each row execute function public.require_active_org_write();

alter table public.site_message_replies enable row level security;

-- A thread is seen by its staff member while they are still at the site, and by the site's
-- manager or owner. No update or delete policy: a reply is not edited, and goes when its
-- message is deleted.
create policy site_message_replies_select on public.site_message_replies for select to authenticated
  using (
    (staff_id = (select auth.uid()) and site_id in (select public.auth_site_ids()))
    or (public.can_manage_site(org_id) and site_id in (select public.auth_site_ids()))
    or public.is_platform_admin()
  );

-- Every thread belongs to someone on staff at the site, so a manager can't open one for
-- themselves or for a person who works elsewhere. Staff write only in their own thread; the
-- manager or owner writes in any thread at their site. Both write as themselves.
create policy site_message_replies_insert on public.site_message_replies for insert to authenticated
  with check (
    author_id = (select auth.uid())
    and site_id in (select public.auth_site_ids())
    and public.is_staff_at_site(staff_id, site_id)
    and (staff_id = (select auth.uid()) or public.can_manage_site(org_id))
  );

-- When each person last opened each thread ------------------------------------------------
create table public.site_message_thread_reads (
  message_id uuid not null references public.site_messages(id) on delete cascade,
  staff_id uuid not null references auth.users(id) on delete cascade,
  reader_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (message_id, staff_id, reader_id)
);

create index site_message_thread_reads_reader_idx on public.site_message_thread_reads (reader_id);

alter table public.site_message_thread_reads enable row level security;

-- Private to the reader: nobody sees when someone else last looked.
create policy site_message_thread_reads_select on public.site_message_thread_reads for select to authenticated
  using (reader_id = (select auth.uid()));

-- Only for yourself, only on a thread you could read: your own as staff, or any at a site you
-- manage. The subquery reads site_messages through its own policy, so the site must be yours.
create policy site_message_thread_reads_insert on public.site_message_thread_reads for insert to authenticated
  with check (
    reader_id = (select auth.uid())
    and exists (
      select 1 from public.site_messages m
      where m.id = message_id
        and (staff_id = (select auth.uid()) or public.can_manage_site(m.org_id))
    )
  );

-- Opening the thread again moves last_read_at on, under the same rule.
create policy site_message_thread_reads_update on public.site_message_thread_reads for update to authenticated
  using (reader_id = (select auth.uid()))
  with check (
    reader_id = (select auth.uid())
    and exists (
      select 1 from public.site_messages m
      where m.id = message_id
        and (staff_id = (select auth.uid()) or public.can_manage_site(m.org_id))
    )
  );
