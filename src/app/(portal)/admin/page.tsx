import Link from 'next/link';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { Stat } from '@/components/stat';

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
    <div>
      <h1 className="text-xl font-semibold">Platform</h1>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Tenants" value={orgs?.length ?? 0} />
        <Stat label="Sites" value={sites ?? 0} />
        <Stat label="Catalogue products" value={products ?? 0} hint="shared across tenants" />
      </div>

      {/* A cron that stopped firing looks like nothing at all until stock is gone, so it
          gets stated plainly rather than left for someone to infer from a table. */}
      {engineStale && (
        <p className="mt-6 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          The expiry engine has not run in the last 36 hours
          {lastEngineRun
            ? ` — last run ${new Date(lastEngineRun.ran_at).toLocaleString('en-AU')}.`
            : ' — no run has ever been recorded.'}{' '}
          Nothing is being surfaced to staff while this is true.
        </p>
      )}

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">Tenants</h2>
      <ul className="mt-2 divide-y divide-neutral-200 rounded border border-neutral-200">
        {(orgs ?? []).map((org) => (
          <li key={org.id} className="flex flex-wrap items-baseline gap-3 px-4 py-2 text-sm">
            <span className="font-medium">{org.name}</span>
            <span className="font-mono text-xs text-neutral-500">{org.slug}</span>
            <Link
              href={`/admin/tenants/${org.id}`}
              className="ml-auto text-xs underline"
            >
              Inspect
            </Link>
          </li>
        ))}
        {(orgs ?? []).length === 0 && (
          <li className="px-4 py-2 text-sm text-neutral-500">No tenants yet.</li>
        )}
      </ul>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">
        Scheduled job history
      </h2>
      <div className="mt-2 overflow-x-auto rounded border border-neutral-200">
        <table className="w-full min-w-[40rem] text-sm">
          <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
            <tr>
              <th className="px-3 py-2 font-medium">Job</th>
              <th className="px-3 py-2 font-medium">Ran</th>
              <th className="px-3 py-2 font-medium">Result</th>
              <th className="px-3 py-2 text-right font-medium">Processed</th>
              <th className="px-3 py-2 text-right font-medium">Skipped</th>
              <th className="px-3 py-2 text-right font-medium">Took</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {(runs ?? []).map((run) => (
              <tr key={run.id}>
                <td className="px-3 py-2 font-mono text-xs">{run.job}</td>
                <td className="px-3 py-2 whitespace-nowrap text-neutral-600">
                  {new Date(run.ran_at).toLocaleString('en-AU')}
                </td>
                <td className="px-3 py-2">
                  <span className={run.ok ? 'text-green-700' : 'text-red-700'}>
                    {run.ok ? 'ok' : 'failed'}
                  </span>
                  {run.reason && (
                    <span className="ml-2 text-xs text-neutral-500">{run.reason}</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{run.processed}</td>
                <td className="px-3 py-2 text-right tabular-nums">{run.skipped}</td>
                <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                  {run.duration_ms === null ? '—' : `${run.duration_ms}ms`}
                </td>
              </tr>
            ))}
            {(runs ?? []).length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-3 text-neutral-500">
                  No scheduled job has ever reported in. Deploy the Edge Functions and set
                  CRON_SECRET.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
