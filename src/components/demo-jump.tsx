'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { jumpDemoDays } from '@/lib/demo/actions';

const JUMP_DAYS = 7;

/**
 * The demo's single best trick: skip a week and watch the board fill up.
 *
 * It shifts the data, not the clock, so the expiry engine is never told it is a demo and
 * does in front of the visitor exactly what it does in production at 3am.
 */
export function DemoJump() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  return (
    <div className="rounded-[0.875rem] border border-dashed border-line-strong bg-surface px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Demo mode</p>
          <p className="text-xs text-muted">
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
          className="btn btn-outline ml-auto"
        >
          {pending ? 'Moving…' : `Jump ${JUMP_DAYS} days forward`}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-critical-ink">{error}</p>}
      {!error && (
        <p className="mt-2 text-xs text-faint">
          Re-run the expiry engine afterwards to rebuild today’s list.
        </p>
      )}
    </div>
  );
}
