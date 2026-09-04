'use client';

import { useActionState } from 'react';
import { signIn, type AuthState } from '@/lib/auth/actions';

const initial: AuthState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initial);

  return (
    <form action={formAction} className="mt-8 flex flex-col gap-3">
      <label className="flex flex-col gap-1 text-sm">
        Email
        <input
          name="email" type="email" required autoComplete="email"
          className="rounded border border-neutral-300 px-3 py-2 text-base"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Password
        <input
          name="password" type="password" required autoComplete="current-password"
          className="rounded border border-neutral-300 px-3 py-2 text-base"
        />
      </label>

      {state.error && (
        <p role="alert" className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">
          {state.error}
        </p>
      )}

      <button
        type="submit" disabled={pending}
        className="mt-2 rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
