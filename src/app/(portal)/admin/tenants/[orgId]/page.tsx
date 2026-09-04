import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { Stat } from '@/components/stat';
import { formatAud } from '@/lib/charts/tokens';

const AUDIT_LIMIT = 20;

/**
 * A platform admin looking at one tenant's numbers.
 *
 * This is the "impersonation" the plan asks for, in the only form that is safe to build:
 * is_platform_admin() already widens every RLS policy, so an admin can read across
 * tenants without any token swapping — and issuing a session as another user would be a
 * genuinely dangerous mechanism to add for the sake of a convenience. Every visit writes
 * an audit_log row the tenant themselves can read.
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
        .select('role, profiles(full_name)')
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

  // Recorded after the reads, so the entry reflects a view that actually happened.
  await supabase.rpc('write_audit', {
    p_action: 'platform_admin.viewed_tenant',
    p_org_id: org.id,
    p_subject_type: 'org',
    p_subject_id: org.id,
  });

  const totalWaste = (waste ?? []).reduce((sum, w) => sum + (w.value_aud ?? 0), 0);

  return (
    <div>
      <Link href="/admin" className="text-sm text-neutral-500 underline">
        ← Platform
      </Link>

      <h1 className="mt-3 text-xl font-semibold">{org.name}</h1>
      <p className="mt-1 font-mono text-sm text-neutral-500">{org.slug}</p>
      <p className="mt-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
        This visit has been written to {org.name}&rsquo;s audit log, which their owner can read.
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Sites" value={sites?.length ?? 0} />
        <Stat label="People" value={members?.length ?? 0} />
        <Stat label="Active batches" value={batches ?? 0} />
        <Stat label="Waste recorded" value={formatAud(totalWaste)} hint="all time" />
      </div>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">Sites</h2>
      <ul className="mt-2 divide-y divide-neutral-200 rounded border border-neutral-200">
        {(sites ?? []).map((s) => (
          <li key={s.id} className="px-4 py-2 text-sm">{s.name}</li>
        ))}
        {(sites ?? []).length === 0 && (
          <li className="px-4 py-2 text-sm text-neutral-500">No sites.</li>
        )}
      </ul>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">
        Recent audit entries
      </h2>
      <ul className="mt-2 divide-y divide-neutral-200 rounded border border-neutral-200">
        {(audit ?? []).map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-baseline gap-3 px-4 py-2 text-sm">
            <span className="font-mono text-xs">{entry.action}</span>
            <span className="ml-auto text-xs text-neutral-500">
              {new Date(entry.created_at).toLocaleString('en-AU')}
            </span>
          </li>
        ))}
        {(audit ?? []).length === 0 && (
          <li className="px-4 py-2 text-sm text-neutral-500">Nothing logged yet.</li>
        )}
      </ul>
    </div>
  );
}
