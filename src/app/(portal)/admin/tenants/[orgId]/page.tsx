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

const AUDIT_LIMIT = 20;

/** A site is removable only while nothing has been recorded against it (see removeSite). */
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

/**
 * A platform admin looking at one tenant, and managing its sites and people.
 *
 * is_platform_admin() already widens every RLS policy, so the reads here are cross-tenant
 * without any token swapping. The write actions run under the service key and re-authorise
 * themselves; every visit and change is written to the tenant's own audit log.
 */
export default async function TenantPage(props: PageProps<'/admin/tenants/[orgId]'>) {
  await requireRole('platform_admin');
  const { orgId } = await props.params;
  const supabase = await createClient();

  const { data: org } = await supabase
    .from('orgs')
    .select('id, name, slug, created_at')
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

  // Email and name live on auth.users (there is no FK from memberships to profiles for
  // PostgREST to join), so both come from the service-role client in one listing.
  const admin = createAdminClient();
  const { data: userList } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const userById = new Map(
    (userList?.users ?? []).map((u) => [
      u.id,
      {
        email: u.email ?? '—',
        fullName: (u.user_metadata?.full_name as string | undefined) ?? '',
      },
    ]),
  );

  const siteRows = sites ?? [];
  const removable = await removableSiteIds(supabase, siteRows.map((s) => s.id));

  const managedSites: ManagedSite[] = siteRows.map((s) => ({
    id: s.id,
    name: s.name,
    removable: removable.has(s.id),
  }));

  const people: Person[] = (members ?? []).map((m) => ({
    membershipId: m.id,
    fullName: userById.get(m.user_id)?.fullName ?? '',
    email: userById.get(m.user_id)?.email ?? '—',
    role: m.role,
    siteId: m.site_id,
  }));

  // Recorded after the reads, so the entry reflects a view that actually happened.
  await supabase.rpc('write_audit', {
    p_action: 'platform_admin.viewed_tenant',
    p_org_id: org.id,
    p_subject_type: 'org',
    p_subject_id: org.id,
  });

  const totalWaste = (waste ?? []).reduce((sum, w) => sum + (w.value_aud ?? 0), 0);

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin" className="text-sm text-muted hover:text-ink">
          ← Platform
        </Link>
        <div className="mt-3">
          <PageHeader
            title={org.name}
            subtitle={<span className="font-mono">{org.slug}</span>}
          />
        </div>
        <p className="mt-3 rounded-xl border border-warning/30 bg-warning-soft px-4 py-2.5 text-xs text-warning">
          This visit has been written to {org.name}&rsquo;s audit log, which their owner can read.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Sites" value={managedSites.length} />
        <Stat label="People" value={people.length} />
        <Stat label="Active batches" value={batches ?? 0} />
        <Stat label="Waste recorded" value={formatAud(totalWaste)} hint="all time" />
      </div>

      <section>
        <SectionTitle>Sites</SectionTitle>
        <SiteAdmin orgId={org.id} sites={managedSites} />
      </section>

      <section>
        <SectionTitle>People</SectionTitle>
        <PeopleAdmin
          orgId={org.id}
          people={people}
          sites={siteRows.map((s) => ({ id: s.id, name: s.name }))}
        />
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
    </div>
  );
}
