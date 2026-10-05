'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Re-reads the page from the server on a tap: the dashboards show what is true when they
 * were loaded, and this is how a manager or admin asks for now. Nothing polls in the
 * background, so an open, idle tab does no work.
 */
export function RefreshButton({ loadedAt }: { loadedAt: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      <span className="text-xs text-muted" aria-live="polite">{pending ? 'Refreshing…' : `Updated ${loadedAt}`}</span>
      <button type="button" className="btn btn-outline" disabled={pending}
        onClick={() => startTransition(() => router.refresh())}>
        Refresh
      </button>
    </span>
  );
}
