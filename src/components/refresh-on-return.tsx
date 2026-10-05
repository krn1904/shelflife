'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { refreshOnReturn } from '@/lib/expiry/reminders';

/**
 * Re-reads the page when someone comes back to ShelfLife after a while, so the reminder
 * banner and the Today count aren't yesterday's. Event-driven only: it notes when the tab
 * was hidden and decides on return, so an open, idle tab does no work.
 */
export function RefreshOnReturn() {
  const router = useRouter();

  useEffect(() => {
    let hiddenAt: number | null = null;

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
      } else if (refreshOnReturn(hiddenAt, Date.now())) {
        hiddenAt = null;
        router.refresh();
      }
    };
    // A page restored from the back/forward cache never re-rendered on the server.
    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) router.refresh();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [router]);

  return null;
}
