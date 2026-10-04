'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { setActionState, setRotationCheckState } from '@/lib/expiry/actions';
import type { ExpiryActionKind } from '@/lib/supabase/types';
import { actionTone, daysLeftShort, daysLeftText, orderForShift } from '@/lib/expiry/display';

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
  const [focusId, setFocusId] = useState<string | null>(null);
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


  const visible = orderForShift(items.filter((i) => !hidden.has(i.id)));
  // A tapped row is promoted to the focus card; otherwise the head of the shift order is.
  const next = visible.find((i) => i.id === focusId) ?? visible[0];
  const rest = visible.filter((i) => i !== next);

  const total = items.length + fixtures.length;
  const done = items.length - visible.length + fixtures.filter((f) => f.done || ticked.has(f.id)).length;

  return (
    <div className="space-y-7">
      {total > 0 && (
        <div className="space-y-2">
          <p className="font-mono text-sm text-muted">
            {done} of {total} done
          </p>
          <div className="flex gap-1" aria-hidden>
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={`h-1 flex-1 rounded-full ${i < done ? 'bg-brand' : 'bg-line'}`} />
            ))}
          </div>
        </div>
      )}

      {error && <p role="alert" className="alert alert-critical">{error}</p>}

      <section aria-labelledby="next-up">
        <h2 id="next-up" className="section-title mb-2 px-1">Next up</h2>
        {next ? (
          <article className="card flex flex-col gap-4 rounded-[1.125rem] p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`pill pill-${actionTone(next.action)}`}>{next.actionLabel.toUpperCase()}</span>
              <span className={`font-mono text-sm ${next.daysLeft < 0 ? 'text-critical' : 'text-muted'}`}>
                {daysLeftText(next.daysLeft)}
              </span>
            </div>
            <div>
              <p className="text-[1.375rem] font-bold leading-tight tracking-tight">{next.name}</p>
              <p className="mt-1 text-sm text-muted">
                {next.detail && <>{next.detail} · </>}
                <span className="font-mono">{next.qtyRemaining}</span> on shelf
              </p>
            </div>
            {next.action === 'pull' && (
              <Link href={`/app/waste?batch=${next.batchId}`} className="btn btn-primary min-h-12">
                Pull &amp; record waste
              </Link>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => resolve(next.id, 'done')}
                className={`btn min-h-12 flex-1 ${next.action === 'pull' ? 'btn-outline' : 'btn-primary'}`}
              >
                Done
              </button>
              <button type="button" onClick={() => resolve(next.id, 'dismissed')} className="btn btn-ghost min-h-12 flex-1">
                Not here
              </button>
            </div>
          </article>
        ) : (
          <p className="card px-5 py-6 text-sm text-muted">
            Nothing dated needs attention. The engine reruns overnight.
          </p>
        )}
      </section>

      {rest.length > 0 && (
        <section aria-labelledby="then">
          <h2 id="then" className="section-title mb-2 px-1">Then · {rest.length}</h2>
          <ul className="card divide-y divide-line overflow-hidden">
            {rest.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => setFocusId(item.id)}
                  className="flex min-h-15 w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-surface-2"
                >
                  <span className={`pill pill-${actionTone(item.action)}`}>{daysLeftShort(item.daysLeft)}d</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[0.9375rem] font-semibold">{item.name}</span>
                    <span className="block text-xs text-muted">
                      {item.actionLabel} · <span className="font-mono">{item.qtyRemaining}</span> left
                    </span>
                  </span>
                  <svg aria-hidden width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-faint">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="walk-past">
        <h2 id="walk-past" className="section-title px-1">Walk past</h2>
        <p className="mb-3 mt-1 px-1 text-xs text-muted">
          Short-life stock is rotated by eye, so these are a walk-past rather than a scan.
        </p>

        {fixtures.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {fixtures.map((f) => {
              const isDone = f.done || ticked.has(f.id);
              return (
                <label
                  key={f.id}
                  className={`flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold ${
                    isDone ? 'bg-brand-soft text-brand-soft-ink' : 'border border-line-strong'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isDone}
                    disabled={isDone}
                    onChange={() => tickFixture(f.id)}
                    aria-label={`Checked ${f.fixture}`}
                    className="size-[18px] accent-[var(--brand)]"
                  />
                  {f.fixture}
                </label>
              );
            })}
          </div>
        ) : (
          <p className="card px-4 py-3 text-sm text-muted">
            No fixtures set up. A manager assigns one to each rotation product from the
            Site portal, and the list builds itself overnight.
          </p>
        )}
      </section>
    </div>
  );
}
