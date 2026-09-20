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
    <div className="mt-8 border-t border-line pt-6">
      <h2 className="text-sm font-semibold">Have a look around</h2>
      <p className="mt-1 text-xs text-muted">
        Demo data, four roles, no signup. Everything you change is fake.
      </p>

      <div className="mt-3 grid gap-2">
        {DEMO_LOGINS.map((login) => (
          <form key={login.email} action={formAction}>
            <input type="hidden" name="email" value={login.email} />
            <button
              type="submit"
              disabled={pending}
              className="card w-full p-3 text-left transition hover:border-line-strong disabled:opacity-50"
            >
              <span className="flex items-center justify-between text-sm font-medium">
                {login.label}
                <span aria-hidden className="text-faint">→</span>
              </span>
              <span className="mt-0.5 block text-xs text-muted">{login.blurb}</span>
            </button>
          </form>
        ))}
      </div>

      {state.status === 'error' && (
        <p className="mt-3 rounded-lg border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical">
          {state.message}
        </p>
      )}
    </div>
  );
}
