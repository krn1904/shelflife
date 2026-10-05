'use client';

import { useActionState } from 'react';
import { signIn, type AuthState } from '@/lib/auth/actions';

const initial: AuthState = { error: null };

export function LoginForm() {
  const [state, formAction, pending] = useActionState(signIn, initial);

  return (
    <form action={formAction} className="mt-4 flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Email
        <input
          name="email" type="email" required autoComplete="email"
          className="field"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm font-medium">
        Password
        <input
          name="password" type="password" required autoComplete="current-password"
          className="field"
        />
      </label>

      {state.error && (
        <p role="alert" className="alert alert-critical">
          {state.error}
        </p>
      )}

      <button type="submit" disabled={pending} className="btn btn-primary mt-1">
        {pending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
