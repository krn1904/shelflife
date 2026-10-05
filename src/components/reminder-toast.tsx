'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { toastDue, toastStorageKey } from '@/lib/expiry/reminders';

function readShownOn(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null; // private window or blocked storage: show it, just not remembered
  }
}

function writeShownOn(key: string, day: string) {
  try {
    localStorage.setItem(key, day);
  } catch {
    // Nothing to do; worst case it shows again next time.
  }
}

/**
 * A pop-up when the app opens with something due, until it is acknowledged once that day
 * on this device. Recorded on Open or Later, not on show: a remount or a quick navigation
 * away must not use up the day's reminder unseen. No timers, so an idle tab does nothing.
 */
export function ReminderToast({
  userId,
  siteId,
  siteToday,
  total,
  title,
  href,
}: {
  userId: string;
  siteId: string;
  siteToday: string; // the site's own date, so the day turns over at the store's midnight
  total: number;
  title: string;
  href: string;
}) {
  const [open, setOpen] = useState(false);

  // Decided after mount, because storage is browser-only. The dependencies are props,
  // never the `open` state this effect sets.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-off read of browser storage
    setOpen(toastDue(readShownOn(toastStorageKey(userId, siteId)), siteToday, total));
  }, [userId, siteId, siteToday, total]);

  function acknowledge() {
    writeShownOn(toastStorageKey(userId, siteId), siteToday);
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-label="Due today"
      className="card fixed inset-x-4 bottom-24 z-30 mx-auto max-w-sm border-brand p-4 shadow-lg sm:bottom-6"
    >
      <div className="text-sm font-semibold">{title}</div>
      <p className="mt-1 text-xs text-muted">
        {total} {total === 1 ? 'thing' : 'things'} on today’s list.
      </p>
      <div className="mt-3 flex gap-2">
        <Link href={href} className="btn btn-primary btn-sm" onClick={acknowledge}>
          Open
        </Link>
        <button type="button" className="btn btn-ghost btn-sm" onClick={acknowledge}>
          Later
        </button>
      </div>
    </div>
  );
}
