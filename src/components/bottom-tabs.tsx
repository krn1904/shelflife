'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SHIFT_TABS } from '@/components/shift-tabs';

/** Thumb-reach navigation for staff on a phone; hidden from `sm` up, where the header has room. */
export function BottomTabs() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Shift"
      className="fixed inset-x-0 bottom-0 z-20 flex justify-around border-t border-line bg-paper/95 px-2 pt-1.5 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur sm:hidden"
    >
      {SHIFT_TABS.map((t) => {
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
