import Link from 'next/link';
import { signOut } from '@/lib/auth/actions';
import { PendingChanges } from '@/components/pending-changes';
import { roleAtLeast, type Session } from '@/lib/auth/session';
import type { AppRole } from '@/lib/supabase/types';

const NAV: { href: string; label: string; bar: AppRole }[] = [
  { href: '/app', label: 'Shift', bar: 'staff' },
  { href: '/manage', label: 'Site', bar: 'manager' },
  { href: '/owner', label: 'Group', bar: 'owner' },
  { href: '/admin', label: 'Platform', bar: 'platform_admin' },
];

const ROLE_LABEL: Record<AppRole, string> = {
  platform_admin: 'Platform admin',
  owner: 'Owner',
  manager: 'Manager',
  staff: 'Staff',
};

export function PortalShell({ session, children }: { session: Session; children: React.ReactNode }) {
  const links = NAV.filter((n) => roleAtLeast(session.primaryRole, n.bar));
  const org = session.memberships[0];

  return (
    <div className="min-h-dvh">
      <PendingChanges />
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold tracking-tight">ShelfLife</span>
          <nav className="flex gap-4 text-sm">
            {links.map((n) => (
              <Link key={n.href} href={n.href} className="text-neutral-600 hover:text-neutral-900">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-neutral-500">
            <span>{org?.orgName}</span>
            <span className="rounded bg-neutral-100 px-2 py-0.5 text-xs">
              {ROLE_LABEL[session.primaryRole]}
            </span>
            <form action={signOut}>
              <button type="submit" className="text-neutral-600 underline hover:text-neutral-900">
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
    </div>
  );
}
