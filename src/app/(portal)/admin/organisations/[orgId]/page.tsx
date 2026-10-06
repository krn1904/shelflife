import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { User } from '@supabase/supabase-js';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Stat } from '@/components/stat';
import { PageHeader, SectionTitle } from '@/components/ui';
import { formatAud } from '@/lib/charts/tokens';
import type { Tables } from '@/lib/supabase/database.types';
import { fetchAllPages } from '@/lib/pagination';
import { SiteAdmin, type ManagedSite } from './site-admin';
import { PeopleAdmin, type Person } from './people-admin';
import { OrganisationLifecycleAdmin } from './lifecycle-admin';
import { platformTime } from '@/lib/admin/time';

const AUDIT_LIMIT = 20;

type SiteRow = Pick<Tables<'sites'>, 'id' | 'name'>;
type MembershipRow = Pick<Tables<'memberships'>, 'id' | 'user_id' | 'site_id' | 'role'>;

async function listAllAuthUsers(admin: ReturnType<typeof createAdminClient>): Promise<User[]> {
  const users: User[] = [];
  const perPage = 1000;
  for (let page = 1; ; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < perPage) return users;
  }
}

async function listAllSites(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<SiteRow[]> {
  return fetchAllPages<SiteRow>((from, to) =>
    supabase
      .from('sites')
      .select('id, name')
      .eq('org_id', orgId)
      .order('name')
      .order('id')
      .range(from, to)
  );
}

async function listAllMemberships(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<MembershipRow[]> {
  return fetchAllPages<MembershipRow>((from, to) =>
    supabase
      .from('memberships')
      .select('id, user_id, site_id, role')
      .eq('org_id', orgId)
      .order('id')
      .range(from, to)
  );
}

async function removableSiteIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  siteIds: string[],
): Promise<Set<string>> {
  const removable = new Set<string>();
  await Promise.all(
    siteIds.map(async (id) => {
      const [{ count: d }, { count: b }, { count: w }, { count: m }] = await Promise.all([
        supabase.from('deliveries').select('*', { count: 'exact', head: true }).eq('site_id', id),
        supabase.from('stock_batches').select('*', { count: 'exact', head: true }).eq('site_id', id),
        supabase.from('waste_events').select('*', { count: 'exact', head: true }).eq('site_id', id),
        supabase.from('memberships').select('*', { count: 'exact', head: true }).eq('site_id', id),
      ]);
      if ((d ?? 0) + (b ?? 0) + (w ?? 0) + (m ?? 0) === 0) removable.add(id);
    }),
  );
  return removable;
}

export default async function OrganisationPage(
  props: { params: Promise<{ orgId: string }> },
) {
  await requireRole('platform_admin');
  const { orgId } = await props.params;
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('orgs')
    .select('id, name, slug, status, archived_at, created_at')
    .eq('id', orgId)
    .maybeSingle();
  if (!org) notFound();

  const [sites, members, { data: totalWaste }, { count: batches }, { data: audit }] =
    await Promise.all([
      listAllSites(supabase, org.id),
      listAllMemberships(supabase, org.id),
      supabase.rpc('organisation_waste_total', { p_org_id: org.id }),
      supabase
        .from('stock_batches')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', org.id)
        .eq('status', 'active')
        .gt('qty_remaining', 0),
      supabase
        .from('audit_log')
        .select('id, action, created_at, subject_type, detail')
        .eq('org_id', org.id)
        .order('created_at', { ascending: false })
        .limit(AUDIT_LIMIT),
    ]);

  const admin = createAdminClient();
  const userList = await listAllAuthUsers(admin);
  const userById = new Map(
    userList.map((user) => [
      user.id,
      {
        email: user.email ?? '—',
        fullName: (user.user_metadata?.full_name as string | undefined) ?? '',
      },
    ]),
  );

  const siteRows = sites;
  const removable = org.status === 'active'
    ? await removableSiteIds(supabase, siteRows.map((site) => site.id))
    : new Set<string>();
  const managedSites: ManagedSite[] = siteRows.map((site) => ({
    id: site.id,
    name: site.name,
    removable: removable.has(site.id),
  }));
  const people: Person[] = members.map((membership) => ({
    membershipId: membership.id,
    fullName: userById.get(membership.user_id)?.fullName ?? '',
    email: userById.get(membership.user_id)?.email ?? '—',
    role: membership.role,
    siteId: membership.site_id,
  }));

  const { error: visitAuditError } = await supabase.rpc('write_audit', {
    p_action: 'platform_admin.viewed_organisation',
    p_org_id: org.id,
    p_subject_type: 'org',
    p_subject_id: org.id,
  });

  const archived = org.status === 'archived';

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin" className="text-sm text-muted hover:text-ink">
          ← Platform
        </Link>
        <div className="mt-3">
          <PageHeader
            title={org.name}
            subtitle={
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono">{org.slug}</span>
                <span className={`badge ${archived ? 'text-critical' : 'badge-neutral'}`}>
                  {org.status}
                </span>
              </span>
            }
          />
        </div>
        {visitAuditError ? (
          <p className="mt-3 rounded-xl border border-critical/30 bg-critical-soft px-4 py-2.5 text-sm text-critical">
            This support visit could not be written to the audit log. Do not make changes until audit logging is restored.
          </p>
        ) : archived ? (
          <p className="mt-3 rounded-xl border border-critical/30 bg-critical-soft px-4 py-2.5 text-sm text-critical">
            Archived {org.archived_at ? platformTime(org.archived_at) : ''}.
            Member access, scheduled processing and notifications are paused.
          </p>
        ) : (
          <p className="mt-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-2.5 text-xs text-warning">
            This visit has been written to {org.name}&rsquo;s audit log, which their owner can read.
          </p>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Sites" value={managedSites.length} />
        <Stat label="People" value={people.length} />
        <Stat label="Active batches" value={batches ?? 0} />
        <Stat label="Waste recorded" value={formatAud(totalWaste ?? 0)} hint="all time" />
      </div>

      <section>
        <SectionTitle>Sites</SectionTitle>
        {archived || visitAuditError ? (
          <ReadOnlyList
            items={managedSites.map((site) => ({ id: site.id, label: site.name }))}
            empty="No sites recorded."
          />
        ) : (
          <SiteAdmin orgId={org.id} sites={managedSites} />
        )}
      </section>

      <section>
        <SectionTitle>People</SectionTitle>
        {archived || visitAuditError ? (
          <ReadOnlyList
            items={people.map((person) => ({
              id: person.membershipId,
              label: `${person.fullName || person.email} · ${person.role}`,
            }))}
            empty="No people recorded."
          />
        ) : (
          <PeopleAdmin
            orgId={org.id}
            people={people}
            sites={siteRows.map((site) => ({ id: site.id, name: site.name }))}
          />
        )}
      </section>

      <section>
        <SectionTitle>Recent audit entries</SectionTitle>
        <ul className="card divide-y divide-line overflow-hidden">
          {(audit ?? []).map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-baseline gap-3 px-4 py-2.5 text-sm">
              <span className="font-mono text-xs">{entry.action}</span>
              <span className="ml-auto text-xs text-faint">
                {platformTime(entry.created_at)}
              </span>
            </li>
          ))}
          {(audit ?? []).length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">Nothing logged yet.</li>
          )}
        </ul>
      </section>

      <section>
        <SectionTitle>Organisation lifecycle</SectionTitle>
        {visitAuditError ? (
          <p className="card px-4 py-3 text-sm text-muted">
            Lifecycle controls are unavailable until audit logging is restored.
          </p>
        ) : (
          <OrganisationLifecycleAdmin orgId={org.id} slug={org.slug} archived={archived} />
        )}
      </section>
    </div>
  );
}

function ReadOnlyList({
  items,
  empty,
}: {
  items: { id: string; label: string }[];
  empty: string;
}) {
  return (
    <ul className="card divide-y divide-line overflow-hidden">
      {items.map((item) => <li key={item.id} className="px-4 py-2.5 text-sm">{item.label}</li>)}
      {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">{empty}</li>}
    </ul>
  );
}
