import { signOut } from '@/lib/auth/actions';
import { PendingChanges } from '@/components/pending-changes';
import { PortalNav, type NavLink } from '@/components/portal-nav';
import { roleAtLeast, type Session } from '@/lib/auth/session';
import type { AppRole } from '@/lib/supabase/types';

const NAV: (NavLink & { bar: AppRole })[] = [
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
  const contextName = session.primaryRole === 'platform_admin'
    ? 'ShelfLife Platform'
    : org?.orgName;

  return (
    <div className="min-h-dvh">
      <PendingChanges />
      <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
          <span className="flex items-center gap-2 font-semibold tracking-tight">
            <span aria-hidden className="inline-block h-4 w-4 rounded-[5px] bg-brand" />
            ShelfLife
          </span>

          {links.length > 1 && <PortalNav links={links} />}

          <div className="ml-auto flex items-center gap-3 text-sm">
            <div className="hidden text-right leading-tight sm:block">
              <div className="font-medium text-ink">{contextName}</div>
              <div className="text-xs text-faint">{ROLE_LABEL[session.primaryRole]}</div>
            </div>
            <form action={signOut}>
              <button type="submit" className="btn btn-ghost px-2.5 py-1.5 text-sm">
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
