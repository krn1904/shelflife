import Link from 'next/link';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { Stat } from '@/components/stat';
import { PageHeader, SectionTitle } from '@/components/ui';

const RUN_LIMIT = 15;

// The engine runs nightly, so a day and a half of silence means it has stopped.
const STALE_AFTER_MS = 36 * 60 * 60 * 1000;

/**
 * Reads the clock outside the component body — a render must stay pure, and this is a
 * data question ("has the engine reported in lately?") rather than a rendering one.
 */
function isStale(lastRunAt: string | undefined): boolean {
  if (!lastRunAt) return true;
  return Date.now() - new Date(lastRunAt).getTime() > STALE_AFTER_MS;
}

export default async function AdminPage() {
  await requireRole('platform_admin');
  const supabase = await createClient();

  // is_platform_admin() widens every policy, so these reads are already cross-tenant.
  const [{ data: orgs }, { count: sites }, { count: products }, { data: runs }] =
    await Promise.all([
      supabase.from('orgs').select('id, name, slug, created_at').order('name'),
      supabase.from('sites').select('*', { count: 'exact', head: true }),
      supabase.from('products').select('*', { count: 'exact', head: true }),
      supabase
        .from('job_runs')
        .select('id, job, ran_at, ok, processed, skipped, reason, duration_ms')
        .order('ran_at', { ascending: false })
        .limit(RUN_LIMIT),
    ]);

  const lastEngineRun = (runs ?? []).find((r) => r.job === 'expiry-engine');
  const engineStale = isStale(lastEngineRun?.ran_at);

  return (
    <div className="space-y-8">
      <PageHeader title="Platform" subtitle="Every tenant, and the jobs that keep them fed." />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Tenants" value={orgs?.length ?? 0} />
        <Stat label="Sites" value={sites ?? 0} />
        <Stat label="Catalogue products" value={products ?? 0} hint="shared across tenants" />
      </div>

      {/* A cron that stopped firing looks like nothing at all until stock is gone, so it
          gets stated plainly rather than left for someone to infer from a table. */}
      {engineStale && (
        <p className="rounded-xl border border-critical/30 bg-critical-soft px-4 py-3 text-sm text-critical">
          <strong className="font-semibold">The expiry engine has not run in the last 36 hours</strong>
          {lastEngineRun
            ? ` — last run ${new Date(lastEngineRun.ran_at).toLocaleString('en-AU')}.`
            : ' — no run has ever been recorded.'}{' '}
          Nothing is being surfaced to staff while this is true.
        </p>
      )}

      <div>
        <SectionTitle>Tenants</SectionTitle>
        <ul className="card divide-y divide-line overflow-hidden">
          {(orgs ?? []).map((org) => (
            <li key={org.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <span className="font-medium">{org.name}</span>
              <span className="badge badge-neutral font-mono">{org.slug}</span>
              <Link href={`/admin/tenants/${org.id}`} className="btn btn-outline ml-auto px-3 py-1.5 text-xs">
                Manage
              </Link>
            </li>
          ))}
          {(orgs ?? []).length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">No tenants yet.</li>
          )}
        </ul>
      </div>

      <div>
        <SectionTitle>Scheduled job history</SectionTitle>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
              <tr>
                <th className="px-4 py-2.5 font-medium">Job</th>
                <th className="px-4 py-2.5 font-medium">Ran</th>
                <th className="px-4 py-2.5 font-medium">Result</th>
                <th className="px-4 py-2.5 text-right font-medium">Processed</th>
                <th className="px-4 py-2.5 text-right font-medium">Skipped</th>
                <th className="px-4 py-2.5 text-right font-medium">Took</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(runs ?? []).map((run) => (
                <tr key={run.id}>
                  <td className="px-4 py-2.5 font-mono text-xs">{run.job}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                    {new Date(run.ran_at).toLocaleString('en-AU')}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`badge ${run.ok ? 'badge-neutral text-good' : 'text-critical'}`}
                      style={run.ok ? undefined : { background: 'var(--critical-soft)' }}>
                      {run.ok ? 'ok' : 'failed'}
                    </span>
                    {run.reason && <span className="ml-2 text-xs text-faint">{run.reason}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{run.processed}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{run.skipped}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-faint">
                    {run.duration_ms === null ? '—' : `${run.duration_ms}ms`}
                  </td>
                </tr>
              ))}
              {(runs ?? []).length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted">
                    No scheduled job has ever reported in. Deploy the Edge Functions and set
                    CRON_SECRET.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
