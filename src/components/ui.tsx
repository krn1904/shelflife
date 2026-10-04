import Link from 'next/link';
import type { ReactNode } from 'react';

/** The heading block every portal page opens with: title, optional subtitle and right-aligned slot. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-[1.875rem] font-bold leading-tight tracking-tight sm:text-[2rem]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function SectionTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-2 flex items-baseline justify-between gap-3">
      <h2 className="section-title">{children}</h2>
      {actions}
    </div>
  );
}

/** A prominent link tile for a page's primary navigation choices. */
export function QuickAction({
  href,
  title,
  hint,
  prefetch,
}: {
  href: string;
  title: string;
  hint?: string;
  prefetch?: boolean;
}) {
  return (
    <Link
      href={href}
      prefetch={prefetch}
      className="card group flex min-h-11 flex-col gap-1 p-4 transition hover:border-line-strong"
    >
      <span className="flex items-center justify-between text-[0.9375rem] font-semibold">
        {title}
        <span aria-hidden className="text-faint transition group-hover:translate-x-0.5 group-hover:text-brand-text">
          →
        </span>
      </span>
      {hint && <span className="text-xs text-muted">{hint}</span>}
    </Link>
  );
}
