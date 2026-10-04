import { redirect } from 'next/navigation';
import { getSession, homePathFor } from '@/lib/auth/session';
import { demoEnabled } from '@/lib/demo/actions';
import { LoginForm } from './login-form';
import { DemoLogins } from './demo-logins';

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(homePathFor(session.primaryRole));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-12">
      <div className="mb-6 flex items-center gap-2.5">
        <span aria-hidden className="inline-block h-7 w-7 rounded-lg bg-brand" />
        <div>
          <h1 className="text-xl font-bold leading-tight tracking-tight">ShelfLife</h1>
          <p className="text-xs text-muted">Back-of-house operations for retail</p>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-sm font-semibold">Sign in</h2>
        <LoginForm />
      </div>

      {(await demoEnabled()) && <DemoLogins />}
    </main>
  );
}
