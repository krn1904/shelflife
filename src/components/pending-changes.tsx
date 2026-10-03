'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { allEntries, drain, forget } from '@/lib/offline/outbox';
import { pendingCount, stuck, type OutboxEntry } from '@/lib/offline/queue';
import { replayOutboxEntry } from '@/lib/offline/actions';
import { singleFlight } from '@/lib/offline/single-flight';

const POLL_MS = 20_000;

/**
 * The persistent "N changes pending" strip.
 *
 * Staff need to know the difference between "saved" and "saved on this phone", because
 * those two look identical until the phone is closed. A failed sync says why rather than
 * disappearing — a queue that silently drops work is worse than no queue at all.
 */
export function PendingChanges() {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const router = useRouter();

  const refresh = useCallback(async () => {
    setEntries(await allEntries());
  }, []);

  // `syncing` is only the label. Whether a drain is running is kept outside React state, so
  // `sync` keeps one identity and the effect below installs its listeners exactly once.
  const [drainOnce] = useState(() =>
    singleFlight(async () => {
      setSyncing(true);
      try {
        return await drain(async (entry) => replayOutboxEntry(entry.clientId, entry.kind, entry.payload));
      } finally {
        setSyncing(false);
      }
    }),
  );

  const sync = useCallback(async () => {
    if (!navigator.onLine) return;
    const result = await drainOnce();
    if (!result) return; // a sync was already running
    await refresh();
    // Server data has moved, so the page behind this strip is now stale.
    if (result.sent > 0) router.refresh();
  }, [drainOnce, refresh, router]);

  useEffect(() => {
    // 'online' is the signal that matters; the poll is a backstop for the cases browsers
    // get wrong — waking from sleep, a captive portal, a flaky mobile handover.
    const onOnline = () => void sync();
    window.addEventListener('online', onOnline);
    const timer = setInterval(() => void sync(), POLL_MS);

    // The first read is deferred to the next tick rather than run in the effect body, so
    // mounting the strip cannot cascade a second render before the first has painted.
    const kickoff = setTimeout(() => {
      void refresh();
      void sync();
    }, 0);

    return () => {
      window.removeEventListener('online', onOnline);
      clearInterval(timer);
      clearTimeout(kickoff);
    };
    // sync/refresh are stable via useCallback; re-running this on every render would
    // reinstall the interval continuously.
  }, [refresh, sync]);

  const pending = pendingCount(entries);
  const failed = stuck(entries);

  if (pending === 0 && failed.length === 0) return null;

  return (
    <div className="border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
        {pending > 0 && (
          <span>
            {pending} {pending === 1 ? 'change' : 'changes'} saved on this device
            {syncing ? ', syncing…' : ', waiting for signal'}
          </span>
        )}

        {failed.length > 0 && (
          <span className="text-red-800">
            {failed.length} could not be saved: {failed[0].lastError ?? 'unknown reason'}
          </span>
        )}

        <button
          type="button"
          onClick={() => void sync()}
          disabled={syncing}
          className="ml-auto underline disabled:opacity-50"
        >
          Try now
        </button>

        {failed.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              for (const entry of failed) await forget(entry.clientId);
              await refresh();
            }}
            className="underline"
          >
            Discard the {failed.length === 1 ? 'failed one' : 'failed ones'}
          </button>
        )}
      </div>
    </div>
  );
}
