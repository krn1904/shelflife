import { redirect } from 'next/navigation';
import { getSession, homePathFor } from '@/lib/auth/session';

export default async function RootPage() {
  const session = await getSession();
  redirect(session ? homePathFor(session.primaryRole) : '/login');
}
