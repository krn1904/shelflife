'use client';

import { useState } from 'react';
import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';

export type NavLink = { href: string; label: string };

/** A dot that pulses beside a tab while its page is on the way. */
function PendingDot() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`ml-1.5 inline-block size-1.5 rounded-full bg-current align-middle transition-opacity ${
        pending ? 'opacity-70 motion-safe:animate-pulse' : 'opacity-0'
      }`}
    />
  );
}

/**
 * Portal switcher with an active-state pill, driven by the current path. A tab already on
 * its way, or already open, is not requested again: a second tap on a slow connection used
 * to fetch the page twice and make the wait longer.
 */
export function PortalNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();
  // Which tab was tapped, and from where: once the path changes, the navigation is over.
  const [tapped, setTapped] = useState<{ href: string; from: string } | null>(null);
  const going = tapped && tapped.from === pathname ? tapped.href : null;

  return (
    <nav className="flex items-center gap-1" aria-busy={going !== null}>
      {links.map((n) => {
        const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            onClick={(e) => {
              // Already there (the loading screen shows the new address at once), or on its way.
              if (pathname === n.href || going === n.href) e.preventDefault();
              else setTapped({ href: n.href, from: pathname });
            }}
            className={
              active || going === n.href
                ? 'rounded-lg bg-brand-soft px-3 py-1.5 text-sm font-medium text-brand-soft-ink'
                : 'rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-ink'
            }
          >
            {n.label}
            <PendingDot />
          </Link>
        );
      })}
    </nav>
  );
}
