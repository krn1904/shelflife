'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  createOrganisation,
  type OrganisationFormState,
} from '@/lib/admin/actions';

export function AddOrganisationForm() {
  const [state, formAction, pending] = useActionState<OrganisationFormState, FormData>(
    createOrganisation,
    { status: 'idle' },
  );

  return (
    <form action={formAction} className="rounded-xl border border-line bg-surface-2 p-4">
      <h3 className="text-sm font-semibold">New organisation</h3>
      <p className="mt-1 text-xs text-muted">
        Creates the organisation, its first site and an owner account in one step.
      </p>

      <div className="mt-4 grid gap-5 lg:grid-cols-3">
        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-faint">
            Organisation
          </legend>
          <label className="block text-sm font-medium">
            Name
            <input name="name" required maxLength={120} placeholder="Metro Petroleum" className="field mt-1" />
          </label>
          <label className="block text-sm font-medium">
            Slug
            <input
              name="slug"
              required
              maxLength={60}
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              placeholder="metro-petroleum"
              className="field mt-1 font-mono"
            />
            <span className="mt-1 block text-xs font-normal text-faint">
              Lowercase letters, numbers and hyphens.
            </span>
          </label>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-faint">
            First site
          </legend>
          <label className="block text-sm font-medium">
            Site name
            <input name="site_name" required maxLength={120} placeholder="Brunswick" className="field mt-1" />
          </label>
          <label className="block text-sm font-medium">
            Timezone
            <input name="timezone" required defaultValue="Australia/Melbourne" className="field mt-1" />
          </label>
          <label className="block text-sm font-medium">
            Address (optional)
            <input name="address" maxLength={200} className="field mt-1" />
          </label>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-xs font-semibold uppercase tracking-wide text-faint">
            Initial owner
          </legend>
          <label className="block text-sm font-medium">
            Name
            <input name="owner_name" required maxLength={120} className="field mt-1" />
          </label>
          <label className="block text-sm font-medium">
            Email
            <input name="owner_email" type="email" required className="field mt-1" />
          </label>
        </fieldset>
      </div>

      {state.status === 'error' && (
        <p className="mt-4 rounded-lg border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical">
          {state.message}
        </p>
      )}
      {state.status === 'created' && (
        <div className="mt-4 rounded-lg border border-good/30 bg-good-soft px-3 py-2 text-sm text-good">
          <p>
            Organisation created with <strong>{state.email}</strong> as owner.
          </p>
          {state.tempPassword ? (
            <p className="mt-1">
              Temporary password (shown once):{' '}
              <code className="rounded bg-surface px-1 font-mono text-ink">{state.tempPassword}</code>
            </p>
          ) : (
            <p className="mt-1">The existing account was linked; its password is unchanged.</p>
          )}
          <Link
            href={`/admin/organisations/${state.orgId}`}
            className="mt-2 inline-block font-medium underline underline-offset-2"
          >
            Manage organisation
          </Link>
        </div>
      )}

      <button type="submit" disabled={pending} className="btn btn-primary mt-4">
        {pending ? 'Creating…' : 'Create organisation'}
      </button>
    </form>
  );
}
