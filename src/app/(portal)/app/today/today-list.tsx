'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { setActionState, setRotationCheckState } from '@/lib/expiry/actions';
import type { ExpiryActionKind } from '@/lib/supabase/types';

export type TodayItem = {
  id: string;
  batchId: string;
  action: ExpiryActionKind;
  actionLabel: string;
  dueDate: string;
  daysLeft: number;
  qtyRemaining: number;
  name: string;
  detail: string;
};

export type FixtureCheck = { id: string; fixture: string; done: boolean };

const TONE: Record<ExpiryActionKind, string> = {
  pull: 'border-red-300 bg-red-50',
  markdown: 'border-amber-300 bg-amber-50',
  check: 'border-neutral-200',
};

function whenText(daysLeft: number): string {
  if (daysLeft < 0) return `${Math.abs(daysLeft)} ${Math.abs(daysLeft) === 1 ? 'day' : 'days'} ago`;
  if (daysLeft === 0) return 'today';
  return `in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`;
}

/**
 * The shift's whole list in one screen: dated stock that needs a decision, then the
 * fixtures to walk past. Rotation stock has no dates at all, so without the second list
 * it would simply never be surfaced — that is the trade the tracking modes make.
 */
export function TodayList({
  items,
  fixtures,
}: {
  items: TodayItem[];
  fixtures: FixtureCheck[];
}) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function resolve(id: string, state: 'done' | 'dismissed') {
    // Hide it immediately — staff are standing at the shelf, and waiting on a round trip
    // before the row disappears is how a list gets double-actioned.
    setHidden((prev) => new Set(prev).add(id));
    startTransition(async () => {
      const result = await setActionState(id, state);
      if (result.status === 'error') {
        setError(result.message);
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    });
  }

  function tickFixture(id: string) {
    setTicked((prev) => new Set(prev).add(id));
    startTransition(async () => {
      const result = await setRotationCheckState(id, 'done');
      if (result.status === 'error') {
        setError(result.message);
        setTicked((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      }
    });
  }

  const visible = items.filter((i) => !hidden.has(i.id));

  return (
    <div className="space-y-8">
      {error && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      )}

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Dated stock ({visible.length})
        </h2>

        <ul className="mt-2 space-y-2">
          {visible.map((item) => (
            <li key={item.id} className={`rounded border px-4 py-3 ${TONE[item.action]}`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="text-sm font-semibold">{item.actionLabel}</span>
                <span className="text-sm">{item.name}</span>
                <span className="text-xs text-neutral-500">{item.detail}</span>
                <span className="ml-auto text-xs text-neutral-600">
                  {item.qtyRemaining} left · expires {whenText(item.daysLeft)}
                </span>
              </div>

              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => resolve(item.id, 'done')}
                  className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white"
                >
                  Done
                </button>
                {item.action === 'pull' && (
                  <Link
                    href={`/app/waste?batch=${item.batchId}`}
                    className="rounded border border-neutral-400 px-3 py-1.5 text-xs font-medium"
                  >
                    Pull &amp; record waste
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => resolve(item.id, 'dismissed')}
                  className="rounded px-3 py-1.5 text-xs text-neutral-600 underline"
                >
                  Not here
                </button>
              </div>
            </li>
          ))}

          {visible.length === 0 && (
            <li className="rounded border border-neutral-200 px-4 py-3 text-sm text-neutral-500">
              Nothing dated needs attention. The engine reruns overnight.
            </li>
          )}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Fixtures to check
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Short-life stock is rotated by eye, so these are a walk-past rather than a scan.
        </p>

        <ul className="mt-2 divide-y divide-neutral-200 rounded border border-neutral-200">
          {fixtures.map((f) => {
            const done = f.done || ticked.has(f.id);
            return (
              <li key={f.id} className="flex items-center gap-3 px-4 py-3">
                <input
                  type="checkbox"
                  checked={done}
                  disabled={done}
                  onChange={() => tickFixture(f.id)}
                  aria-label={`Checked ${f.fixture}`}
                  className="size-5"
                />
                <span className={`text-sm ${done ? 'text-neutral-400 line-through' : ''}`}>
                  {f.fixture}
                </span>
              </li>
            );
          })}

          {fixtures.length === 0 && (
            <li className="px-4 py-3 text-sm text-neutral-500">
              No fixtures set up. A manager assigns one to each rotation product from the
              Site portal, and the list builds itself overnight.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
