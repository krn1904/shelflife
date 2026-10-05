import { signOut } from '@/lib/auth/actions';
import { PendingChanges } from '@/components/pending-changes';
import { PortalNav, type NavLink } from '@/components/portal-nav';
import { BottomTabs } from '@/components/bottom-tabs';
import { SHIFT_TABS } from '@/components/shift-tabs';
import { ThemePicker } from '@/components/theme-picker';
import { roleAtLeast, type Session } from '@/lib/auth/session';
import { currentTheme } from '@/lib/theme/server';
import { loadReminders } from '@/lib/expiry/reminders-data';
import { remindersShownTo } from '@/lib/expiry/reminders';
import { RefreshOnReturn } from '@/components/refresh-on-return';
import { loadStaffMessages } from '@/lib/messages/data';
import { MessageNotices } from '@/components/message-notices';
import { HideOnPath } from '@/components/hide-on-path';
import type { AppRole } from '@/lib/supabase/types';
import { SubmitButton } from '@/components/submit-button';

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

export async function PortalShell({ session, children }: { session: Session; children: React.ReactNode }) {
  const links = NAV.filter((n) => roleAtLeast(session.primaryRole, n.bar));
  const org = session.memberships[0];
  const contextName = session.primaryRole === 'platform_admin'
    ? 'ShelfLife Platform'
    : org?.orgName;
  // Staff live in the shift portal on a phone, so they get thumb-reach tabs instead.
  const staffTabs = session.primaryRole === 'staff';
  const theme = await currentTheme();
  // The count on the Today tab. Same read as the page's banner (cached per request).
  const [reminders, messages] = staffTabs
    ? await Promise.all([loadReminders(session), loadStaffMessages(session)])
    : [null, null];
  const badges: Record<string, number> = reminders ? { '/app/today': reminders.summary.total } : {};

  return (
    <div className="min-h-dvh">
      <PendingChanges />
      {remindersShownTo(session.primaryRole) && <RefreshOnReturn />}
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-5 gap-y-2 px-4 py-2.5">
          <span className="flex items-center gap-2 font-bold tracking-tight">
            <span aria-hidden className="inline-block size-2.5 rounded-[3px] bg-brand" />
            ShelfLife
          </span>

          {staffTabs ? (
            // Phones use the bottom tabs; from tablet width up the same links sit here.
            <div className="hidden sm:block">
              <PortalNav links={SHIFT_TABS.map(({ href, label, exact }) => ({ href, label, exact, badge: badges[href] }))} />
            </div>
          ) : (
            links.length > 1 && (
              // On a phone the portal tabs take their own row under the logo and Sign out.
              <div className="max-sm:order-last max-sm:-mx-1 max-sm:w-full max-sm:overflow-x-auto">
                <PortalNav links={links} />
              </div>
            )
          )}

          <div className="ml-auto flex items-center gap-3 text-sm">
            <div className="hidden text-right leading-tight lg:block">
              <div className="font-medium text-ink">{contextName}</div>
              <div className="text-xs text-faint">{ROLE_LABEL[session.primaryRole]}</div>
            </div>
            <div className="hidden lg:block">
              <ThemePicker initial={theme} compact />
            </div>
            <form action={signOut}>
              <SubmitButton className="btn btn-ghost btn-sm" pendingLabel="Signing out…">
                Sign out
              </SubmitButton>
            </form>
          </div>
        </div>
      </header>
      <main className={`mx-auto max-w-6xl px-4 py-6 sm:py-8 ${staffTabs ? 'pb-28 sm:pb-8' : ''}`}>
        {messages && (
          // The Messages page lists them itself.
          <HideOnPath path="/app/messages">
            <MessageNotices unread={messages.unread} timeZone={messages.site.timeZone} />
          </HideOnPath>
        )}
        {children}
      </main>
      {staffTabs && <BottomTabs badges={badges} />}
    </div>
  );
}
