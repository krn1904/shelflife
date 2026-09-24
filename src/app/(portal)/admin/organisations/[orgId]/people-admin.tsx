'use client';

import { useActionState, useState } from 'react';
import {
  addPerson,
  resetMemberPassword,
  updateMemberRole,
  removeMember,
  type PasswordResetState,
  type PersonFormState,
} from '@/lib/admin/actions';
import type { AppRole } from '@/lib/supabase/types';

const ROLE_LABEL: Record<AppRole, string> = {
  platform_admin: 'Platform admin',
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
};

// Roles that occupy one site; the rest are org-wide and ignore the site choice.
const SITE_ROLES: AppRole[] = ['staff', 'manager'];
const ROLES: AppRole[] = ['staff', 'manager', 'owner', 'platform_admin'];

export type SiteOption = { id: string; name: string };

export type Person = {
  membershipId: string;
  fullName: string;
  email: string;
  role: AppRole;
  siteId: string | null;
};

export function PeopleAdmin({
  orgId,
  people,
  sites,
}: {
  orgId: string;
  people: Person[];
  sites: SiteOption[];
}) {
  const siteName = (id: string | null) => sites.find((s) => s.id === id)?.name ?? '—';

  return (
    <div className="space-y-4">
      <ul className="card divide-y divide-line overflow-hidden">
        {people.map((p) => (
          <li key={p.membershipId} className="px-4 py-3">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-medium">{p.fullName || 'Unnamed'}</span>
              <span className="text-xs text-faint">{p.email}</span>
              <span className="badge badge-brand ml-auto">
                {ROLE_LABEL[p.role]}
                {SITE_ROLES.includes(p.role) && ` · ${siteName(p.siteId)}`}
              </span>
            </div>
            <RoleEditor person={p} sites={sites} />
          </li>
        ))}
        {people.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted">
            No one has access to this organisation yet. Add the first person below.
          </li>
        )}
      </ul>

      <AddPersonForm orgId={orgId} sites={sites} />
    </div>
  );
}

function RoleEditor({ person, sites }: { person: Person; sites: SiteOption[] }) {
  const [role, setRole] = useState<AppRole>(person.role);
  const needsSite = SITE_ROLES.includes(role);

  return (
    <div className="mt-2.5 flex flex-wrap items-end gap-2">
      <form action={updateMemberRole} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="membership_id" value={person.membershipId} />
        <label className="text-xs text-muted">
          Role
          <select
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as AppRole)}
            className="field mt-1 block sm:w-40"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </label>
        <label className="text-xs text-muted">
          Site
          <select
            name="site_id"
            defaultValue={person.siteId ?? ''}
            disabled={!needsSite}
            className="field mt-1 block sm:w-48"
          >
            <option value="">{needsSite ? 'Choose a site…' : 'All sites'}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn btn-outline">Update</button>
      </form>

      <form
        action={removeMember}
        onSubmit={(e) => {
          if (!confirm(`Remove ${person.fullName || person.email} from this organisation?`)) e.preventDefault();
        }}
      >
        <input type="hidden" name="membership_id" value={person.membershipId} />
        <button type="submit" className="btn btn-danger">Remove</button>
      </form>
      <ResetPasswordForm person={person} />
    </div>
  );
}

function ResetPasswordForm({ person }: { person: Person }) {
  const [state, formAction, pending] = useActionState<PasswordResetState, FormData>(
    resetMemberPassword,
    { status: 'idle' },
  );

  return (
    <div className="basis-full">
      <form
        action={formAction}
        onSubmit={(event) => {
          if (!confirm(`Reset the password for ${person.fullName || person.email}? Their current password will stop working.`)) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="membership_id" value={person.membershipId} />
        <button type="submit" disabled={pending} className="btn btn-outline">
          {pending ? 'Resetting…' : 'Reset password'}
        </button>
      </form>

      {state.status === 'error' && (
        <p className="mt-2 rounded-lg border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical">
          {state.message}
        </p>
      )}
      {state.status === 'reset' && (
        <p className="mt-2 rounded-lg border border-good/30 bg-good-soft px-3 py-2 text-sm text-good">
          New temporary password for <strong>{state.email}</strong> (shown once):{' '}
          <code className="rounded bg-surface px-1 font-mono text-ink">{state.tempPassword}</code>
          {state.auditWarning && (
            <span className="mt-1 block text-critical">
              The password changed, but the audit entry failed. Contact support.
            </span>
          )}
        </p>
      )}
    </div>
  );
}

function AddPersonForm({ orgId, sites }: { orgId: string; sites: SiteOption[] }) {
  const [state, formAction, pending] = useActionState<PersonFormState, FormData>(addPerson, {
    status: 'idle',
  });
  const [role, setRole] = useState<AppRole>('staff');
  const needsSite = SITE_ROLES.includes(role);

  return (
    <form action={formAction} className="rounded-xl border border-line bg-surface-2 p-4">
      <h3 className="text-sm font-semibold">Add a person</h3>
      <p className="mt-1 text-xs text-muted">
        Creates a login if the email is new, or links an existing account to this organisation.
      </p>
      <input type="hidden" name="org_id" value={orgId} />

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="full_name" className="block text-sm font-medium">Name</label>
          <input id="full_name" name="full_name" required className="field mt-1" />
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium">Email</label>
          <input id="email" name="email" type="email" required className="field mt-1" />
        </div>
        <div>
          <label htmlFor="role" className="block text-sm font-medium">Role</label>
          <select
            id="role"
            name="role"
            value={role}
            onChange={(e) => setRole(e.target.value as AppRole)}
            className="field mt-1"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="site_id" className="block text-sm font-medium">Site</label>
          <select id="site_id" name="site_id" disabled={!needsSite} className="field mt-1">
            <option value="">{needsSite ? 'Choose a site…' : 'All sites (org-wide role)'}</option>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>

      {state.status === 'error' && (
        <p className="mt-3 rounded-lg border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical">
          {state.message}
        </p>
      )}
      {state.status === 'created' && (
        <p className="mt-3 rounded-lg border border-good/30 bg-good-soft px-3 py-2 text-sm text-good">
          Added <strong>{state.email}</strong>. Temporary password (shown once):{' '}
          <code className="rounded bg-surface px-1 font-mono text-ink">{state.tempPassword}</code> — share it
          and have them reset it.
        </p>
      )}
      {state.status === 'linked' && (
        <p className="mt-3 rounded-lg border border-good/30 bg-good-soft px-3 py-2 text-sm text-good">
          Linked existing account <strong>{state.email}</strong> to this organisation. Their password is unchanged.
        </p>
      )}

      <button type="submit" disabled={pending} className="btn btn-primary mt-4">
        {pending ? 'Adding…' : 'Add person'}
      </button>
    </form>
  );
}
