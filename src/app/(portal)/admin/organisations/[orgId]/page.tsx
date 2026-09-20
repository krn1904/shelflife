import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { Stat } from '@/components/stat';
import { PageHeader, SectionTitle } from '@/components/ui';
import { formatAud } from '@/lib/charts/tokens';
import { SiteAdmin, type ManagedSite } from './site-admin';
import { PeopleAdmin, type Person } from './people-admin';
import { OrganisationLifecycleAdmin } from './lifecycle-admin';

const AUDIT_LIMIT = 20;

async function removableSiteIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  siteIds: string[],
): Promise<Set<string>> {
  const removable = new Set<string>();
  await Promise.all(
    siteIds.map(async (id) => {
      const [{ count: d }, { count: b }, { count: w }] = await Promise.all([
        supabase.from('deliveries').select('*', { count: 'exact', head: true }).eq('site_id', id),
        supabase.from('stock_batches').select('*', { count: 'exact', head: true }).eq('site_id', id),
        supabase.from('waste_events').select('*', { count: 'exact', head: true }).eq('site_id', id),
      ]);
      if ((d ?? 0) + (b ?? 0) + (w ?? 0) === 0) removable.add(id);
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

  const [{ data: sites }, { data: members }, { data: waste }, { count: batches }, { data: audit }] =
    await Promise.all([
      supabase.from('sites').select('id, name').eq('org_id', org.id).order('name'),
      supabase
        .from('memberships')
        .select('id, user_id, site_id, role')
        .eq('org_id', org.id),
      supabase.from('waste_events').select('value_aud').eq('org_id', org.id),
      supabase
        .from('stock_batches')
        .select('*', { count: 'exact', head: true })
        .eq('org_id', org.id)
        .eq('status', 'active'),
      supabase
        .from('audit_log')
        .select('id, action, created_at, subject_type, detail')
        .eq('org_id', org.id)
        .order('created_at', { ascending: false })
        .limit(AUDIT_LIMIT),
    ]);

  const admin = createAdminClient();
  const { data: userList } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const userById = new Map(
    (userList?.users ?? []).map((user) => [
      user.id,
      {
        email: user.email ?? '—',
        fullName: (user.user_metadata?.full_name as string | undefined) ?? '',
      },
    ]),
  );

  const siteRows = sites ?? [];
  const removable = org.status === 'active'
    ? await removableSiteIds(supabase, siteRows.map((site) => site.id))
    : new Set<string>();
  const managedSites: ManagedSite[] = siteRows.map((site) => ({
    id: site.id,
    name: site.name,
    removable: removable.has(site.id),
  }));
  const people: Person[] = (members ?? []).map((membership) => ({
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

  const totalWaste = (waste ?? []).reduce((sum, event) => sum + (event.value_aud ?? 0), 0);
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
            Archived {org.archived_at ? new Date(org.archived_at).toLocaleString('en-AU') : ''}.
            Member access, scheduled processing and notifications are paused.
          </p>
        ) : (
          <p className="mt-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-2.5 text-xs text-warning">
            This visit has been written to {org.name}&rsquo;s audit log, which their owner can read.
          </p>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Sites" value={managedSites.length} />
        <Stat label="People" value={people.length} />
        <Stat label="Active batches" value={batches ?? 0} />
        <Stat label="Waste recorded" value={formatAud(totalWaste)} hint="all time" />
      </div>

      <section>
        <SectionTitle>Sites</SectionTitle>
        {archived ? (
          <ReadOnlyList items={managedSites.map((site) => site.name)} empty="No sites recorded." />
        ) : (
          <SiteAdmin orgId={org.id} sites={managedSites} />
        )}
      </section>

      <section>
        <SectionTitle>People</SectionTitle>
        {archived ? (
          <ReadOnlyList
            items={people.map((person) => `${person.fullName || person.email} · ${person.role}`)}
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
                {new Date(entry.created_at).toLocaleString('en-AU')}
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
        <OrganisationLifecycleAdmin orgId={org.id} slug={org.slug} archived={archived} />
      </section>
    </div>
  );
}

function ReadOnlyList({ items, empty }: { items: string[]; empty: string }) {
  return (
    <ul className="card divide-y divide-line overflow-hidden">
      {items.map((item) => <li key={item} className="px-4 py-2.5 text-sm">{item}</li>)}
      {items.length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">{empty}</li>}
    </ul>
  );
}
