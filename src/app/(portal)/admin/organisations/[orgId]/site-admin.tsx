'use client';

import { useActionState } from 'react';
import { createSite, removeSite, type SiteFormState } from '@/lib/admin/actions';

export type ManagedSite = { id: string; name: string; removable: boolean };

export function SiteAdmin({ orgId, sites }: { orgId: string; sites: ManagedSite[] }) {
  return (
    <div className="space-y-4">
      <ul className="card divide-y divide-line overflow-hidden">
        {sites.map((s) => (
          <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
            <span className="font-medium">{s.name}</span>
            {s.removable ? (
              <form
                action={removeSite}
                className="ml-auto"
                onSubmit={(e) => {
                  if (!confirm(`Remove ${s.name}? This is only for sites added by mistake.`)) {
                    e.preventDefault();
                  }
                }}
              >
                <input type="hidden" name="site_id" value={s.id} />
                <button type="submit" className="btn btn-danger px-2.5 py-1 text-xs">
                  Remove
                </button>
              </form>
            ) : (
              <span className="ml-auto text-xs text-faint">has activity — kept</span>
            )}
          </li>
        ))}
        {sites.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted">No sites yet. Add the first one below.</li>
        )}
      </ul>

      <AddSiteForm orgId={orgId} />
    </div>
  );
}

function AddSiteForm({ orgId }: { orgId: string }) {
  const [state, formAction, pending] = useActionState<SiteFormState, FormData>(createSite, {
    status: 'idle',
  });

  return (
    <form action={formAction} className="rounded-xl border border-line bg-surface-2 p-4">
      <h3 className="text-sm font-semibold">Add a site</h3>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <input type="hidden" name="org_id" value={orgId} />
        <div>
          <label htmlFor="site_name" className="block text-sm font-medium">Name</label>
          <input id="site_name" name="name" required placeholder="Brunswick" className="field mt-1" />
        </div>
        <div>
          <label htmlFor="timezone" className="block text-sm font-medium">Timezone</label>
          <input id="timezone" name="timezone" defaultValue="Australia/Melbourne" className="field mt-1" />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="address" className="block text-sm font-medium">Address (optional)</label>
          <input id="address" name="address" maxLength={200} className="field mt-1" />
        </div>
      </div>

      {state.status === 'error' && (
        <p className="mt-3 rounded-lg border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical">
          {state.message}
        </p>
      )}
      {state.status === 'created' && (
        <p className="mt-3 rounded-lg border border-good/30 bg-good-soft px-3 py-2 text-sm text-good">
          Site created.
        </p>
      )}

      <button type="submit" disabled={pending} className="btn btn-primary mt-4">
        {pending ? 'Creating…' : 'Add site'}
      </button>
    </form>
  );
}
