'use client';

import { useActionState } from 'react';
import { signInAsDemo, type DemoState } from '@/lib/demo/actions';
import { DEMO_LOGINS } from '@/lib/demo/config';

/**
 * Four one-click logins, one per role, no signup.
 *
 * A visitor to a portfolio piece will not create an account to look around, so the demo
 * has to open in one tap or it does not get seen at all.
 */
export function DemoLogins() {
  const [state, formAction, pending] = useActionState<DemoState, FormData>(signInAsDemo, {
    status: 'idle',
  });

  return (
    <div className="mt-8 border-t border-neutral-200 pt-6">
      <h2 className="text-sm font-medium">Have a look around</h2>
      <p className="mt-1 text-xs text-neutral-500">
        Demo data, four roles, no signup. Everything you change is fake.
      </p>

      <div className="mt-3 grid gap-2">
        {DEMO_LOGINS.map((login) => (
          <form key={login.email} action={formAction}>
            <input type="hidden" name="email" value={login.email} />
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded border border-neutral-300 px-4 py-2 text-left hover:bg-neutral-50 disabled:opacity-50"
            >
              <span className="block text-sm font-medium">{login.label}</span>
              <span className="block text-xs text-neutral-500">{login.blurb}</span>
            </button>
          </form>
        ))}
      </div>

      {state.status === 'error' && (
        <p className="mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.message}
        </p>
      )}
    </div>
  );
}
