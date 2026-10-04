'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/app', label: 'Shift', icon: 'M3 11l9-7 9 7v9H3z', exact: true },
  { href: '/app/today', label: 'Today', icon: 'M8 6h13M8 12h13M8 18h13M3 6h1M3 12h1M3 18h1' },
  { href: '/app/deliveries', label: 'Receive', icon: 'M3 7h13v10H3zM16 10h3l2 3v4h-5M7 18h.01M18 18h.01' },
  { href: '/app/waste', label: 'Waste', icon: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13' },
  { href: '/app/scan', label: 'Scan', icon: 'M4 6v12M8 6v12M11 6v12M15 6v12M18 6v12M20 6v12' },
];

/** Thumb-reach navigation for staff on a phone; hidden from `sm` up, where the header has room. */
export function BottomTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Shift"
      className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-line bg-paper/95 px-2 pt-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden"
    >
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`flex min-h-11 min-w-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${
              active ? 'text-brand-text' : 'text-muted'
            }`}
          >
            <svg aria-hidden width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d={t.icon} />
            </svg>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
