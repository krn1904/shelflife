'use client';

import { useActionState } from 'react';
import {
  archiveOrganisation,
  restoreOrganisation,
  type OrganisationLifecycleState,
} from '@/lib/admin/actions';

export function OrganisationLifecycleAdmin({
  orgId,
  slug,
  archived,
}: {
  orgId: string;
  slug: string;
  archived: boolean;
}) {
  const action = archived ? restoreOrganisation : archiveOrganisation;
  const [state, formAction, pending] = useActionState<OrganisationLifecycleState, FormData>(
    action,
    { status: 'idle' },
  );

  if (archived) {
    return (
      <form action={formAction} className="rounded-xl border border-good/30 bg-good-soft p-4">
        <input type="hidden" name="org_id" value={orgId} />
        <h3 className="text-sm font-semibold">Restore organisation</h3>
        <p className="mt-1 text-sm text-muted">
          Restoring re-enables access, scheduled processing and notifications for everyone in this organisation.
        </p>
        {state.status === 'error' && <ErrorMessage message={state.message} />}
        <button type="submit" disabled={pending} className="btn btn-primary mt-3">
          {pending ? 'Restoring…' : 'Restore organisation'}
        </button>
      </form>
    );
  }

  return (
    <form action={formAction} className="rounded-xl border border-critical/30 bg-critical-soft p-4">
      <input type="hidden" name="org_id" value={orgId} />
      <h3 className="text-sm font-semibold text-critical">Archive organisation</h3>
      <p className="mt-1 text-sm text-muted">
        This blocks every member, pauses scheduled processing and notifications, and preserves all records.
      </p>
      <label className="mt-3 block max-w-sm text-sm font-medium">
        Type <code className="font-mono">{slug}</code> to confirm
        <input name="confirm_slug" required autoComplete="off" className="field mt-1" />
      </label>
      {state.status === 'error' && <ErrorMessage message={state.message} />}
      <button type="submit" disabled={pending} className="btn btn-danger mt-3">
        {pending ? 'Archiving…' : 'Archive organisation'}
      </button>
    </form>
  );
}

function ErrorMessage({ message }: { message: string }) {
  return (
    <p className="mt-3 rounded-lg border border-critical/30 bg-surface px-3 py-2 text-sm text-critical">
      {message}
    </p>
  );
}
