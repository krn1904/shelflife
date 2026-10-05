'use client';

import { useActionState } from 'react';
import { addSiteMember, type AddPersonState } from '@/lib/people/actions';
import type { AppRole } from '@/lib/supabase/types';

const ROLE_LABEL: Partial<Record<AppRole, string>> = { staff: 'Staff', manager: 'Manager' };

/** Add someone to the site. Owners pick staff or manager; managers add staff. */
export function AddPersonForm({ siteId, siteName, roles }: { siteId: string; siteName: string; roles: AppRole[] }) {
  const [state, formAction, pending] = useActionState<AddPersonState, FormData>(addSiteMember, { status: 'idle' });
  // Keyed by each success, so the fields clear after every add, not just the first.
  const formKey = state.status === 'created' || state.status === 'linked' ? state.at : 0;

  return (
    <form key={formKey} action={formAction} className="card space-y-3 p-4">
      <div>
        <h2 className="font-semibold">Add someone to {siteName}</h2>
        <p className="text-xs text-muted">
          Creates their login with a temporary password to hand them. They sign in with their email.
        </p>
      </div>
      <input type="hidden" name="site_id" value={siteId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="block text-sm font-medium">Name</span>
          <input name="full_name" required autoComplete="off" className="field" />
        </label>
        <label className="block space-y-1">
          <span className="block text-sm font-medium">Email</span>
          <input name="email" type="email" required autoComplete="off" className="field" />
        </label>
        {roles.length > 1 ? (
          <label className="block space-y-1">
            <span className="block text-sm font-medium">Role</span>
            <select name="role" defaultValue="staff" className="field">
              {roles.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
            </select>
          </label>
        ) : (
          <input type="hidden" name="role" value="staff" />
        )}
      </div>

      <button type="submit" disabled={pending} className="btn btn-primary">
        {pending ? 'Adding…' : 'Add'}
      </button>

      {state.status === 'error' && <p role="alert" className="alert alert-critical">{state.message}</p>}
      {state.status === 'created' && (
        <p role="status" className="alert alert-good">
          Added <strong>{state.email}</strong>. Temporary password (shown once):{' '}
          <code className="rounded bg-surface px-1 font-mono text-ink">{state.tempPassword}</code>. Give it to them
          to sign in.
        </p>
      )}
      {state.status === 'linked' && (
        <p role="status" className="alert alert-good">
          Added <strong>{state.email}</strong>. They already had a ShelfLife login, so they sign in with their
          existing password.
        </p>
      )}
    </form>
  );
}
