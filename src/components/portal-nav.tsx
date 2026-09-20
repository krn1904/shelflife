'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export type NavLink = { href: string; label: string };

/** Portal switcher with an active-state pill, driven by the current path. */
export function PortalNav({ links }: { links: NavLink[] }) {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1">
      {links.map((n) => {
        const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? 'page' : undefined}
            className={
              active
                ? 'rounded-lg bg-brand-soft px-3 py-1.5 text-sm font-medium text-brand-soft-ink'
                : 'rounded-lg px-3 py-1.5 text-sm font-medium text-muted transition hover:bg-surface-2 hover:text-ink'
            }
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
