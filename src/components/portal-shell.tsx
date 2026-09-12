import Link from 'next/link';
import { signOut } from '@/lib/auth/actions';
import { PendingChanges } from '@/components/pending-changes';
import type { Session } from '@/lib/auth/session';

const NAV: { href: string; label: string }[] = [
  { href: '/app', label: 'Dashboard' },
  { href: '/app/today', label: 'Today' },
  { href: '/app/deliveries', label: 'Deliveries' },
  { href: '/manage/expiry', label: 'Expiry' },
  { href: '/manage/products', label: 'Products' },
  { href: '/manage/waste', label: 'Waste' },
];

export function PortalShell({ session, children }: { session: Session; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <PendingChanges />
      <header className="border-b border-neutral-200">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
          <span className="font-semibold tracking-tight">ShelfLife</span>
          <nav className="flex gap-4 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-neutral-600 hover:text-neutral-900">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-neutral-500">
            <span>{session.fullName ?? session.email}</span>
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
