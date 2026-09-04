'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { jumpDemoDays } from '@/lib/demo/actions';

const JUMP_DAYS = 7;

/**
 * The demo's single best trick: skip a week and watch the board fill up.
 *
 * It shifts the data, not the clock, so the expiry engine is never told it is a demo and
 * does in front of the visitor exactly what it does in production at 2am.
 */
export function DemoJump() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div className="rounded border border-dashed border-neutral-400 bg-neutral-50 px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">Demo mode</p>
          <p className="text-xs text-neutral-600">
            Jump the calendar forward to watch stock cross the expiry thresholds. The engine
            is not told anything — only the dates move.
          </p>
        </div>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError(null);
              const result = await jumpDemoDays(JUMP_DAYS);
              if (result.status === 'error') setError(result.message);
              else router.refresh();
            })
          }
          className="ml-auto rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {pending ? 'Moving…' : `Jump ${JUMP_DAYS} days forward`}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
      {!error && (
        <p className="mt-2 text-xs text-neutral-500">
          Re-run the expiry engine afterwards to rebuild today’s list.
        </p>
      )}
    </div>
  );
}
