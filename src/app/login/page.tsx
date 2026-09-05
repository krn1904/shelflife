import { redirect } from 'next/navigation';
import { getSession, homePathFor } from '@/lib/auth/session';
import { demoEnabled } from '@/lib/demo/actions';
import { LoginForm } from './login-form';
import { DemoLogins } from './demo-logins';

export default async function LoginPage() {
  const session = await getSession();
  if (session) redirect(homePathFor(session.primaryRole));

  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 py-12">
      <h1 className="text-2xl font-semibold tracking-tight">ShelfLife</h1>
      <p className="mt-1 text-sm text-neutral-500">Back-of-house operations</p>
      <LoginForm />
      {(await demoEnabled()) && <DemoLogins />}
    </main>
  );
}
