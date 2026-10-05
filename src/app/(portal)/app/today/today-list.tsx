'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { setRotationCheckState } from '@/lib/expiry/actions';
import { SectionTitle } from '@/components/ui';
import { ReminderCard, useBatchAnswers, type ReminderCardData } from '@/components/reminder-card';
import type { ExpiryActionKind } from '@/lib/supabase/types';

export type TodayItem = {
  id: string;
  batchId: string;
  action: ExpiryActionKind;
  daysLeft: number;
  qtyRemaining: number;
  markedDownOn: string | null;
  name: string;
  detail: string;
};

export type FixtureCheck = { id: string; fixture: string; done: boolean };

/**
 * The shift's whole list: dated stock that needs an answer, then fixtures to walk past.
 *
 * Every answer is one tap (plus a count when binning). It works without signal: the
 * answer is kept on the phone and sent when the connection returns.
 */
export function TodayList({ items, fixtures, timeZone }: { items: TodayItem[]; fixtures: FixtureCheck[]; timeZone: string }) {
  const { isHidden, error, setError, answer } = useBatchAnswers();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

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

  const cards: ReminderCardData[] = items.map((i) => ({ ...i, key: i.id, kind: i.action }));
  // Items arrive most urgent first, so the head of the list is what to do next.
  const [next, ...rest] = cards.filter((c) => !isHidden(c.key));

  return (
    <div className="space-y-7">
      {error && <p role="alert" className="alert alert-critical">{error}</p>}

      <section aria-labelledby="next-up">
        <SectionTitle actions={<Link href="/app/board" className="text-sm font-semibold text-muted hover:text-ink">Expiry board →</Link>}>
          <span id="next-up">Next up</span>
        </SectionTitle>
        {next ? (
          <ul>
            <ReminderCard key={next.key} card={next} onAnswer={answer} timeZone={timeZone} featured />
          </ul>
        ) : (
          <p className="card px-5 py-6 text-sm text-muted">
            Nothing dated needs attention. The list is rebuilt overnight.
          </p>
        )}
      </section>

      {rest.length > 0 && (
        <section aria-labelledby="then">
          <SectionTitle>
            <span id="then">Then · <span className="font-mono">{rest.length}</span></span>
          </SectionTitle>
          <ul className="space-y-2">
            {rest.map((card) => (
              <ReminderCard key={card.key} card={card} onAnswer={answer} timeZone={timeZone} />
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="walk-past">
        <SectionTitle><span id="walk-past">Walk past</span></SectionTitle>
        <p className="-mt-1 mb-3 text-xs text-muted">
          Short-life stock is rotated by eye, so these are a walk-past rather than a scan.
        </p>
        {fixtures.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {fixtures.map((f) => {
              const done = f.done || ticked.has(f.id);
              return (
                <label
                  key={f.id}
                  className={`flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold ${
                    done ? 'bg-brand-soft text-brand-soft-ink' : 'border border-line-strong'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={done}
                    disabled={done}
                    onChange={() => tickFixture(f.id)}
                    aria-label={`Checked ${f.fixture}`}
                    className="size-[18px]"
                  />
                  {f.fixture}
                </label>
              );
            })}
          </div>
        ) : (
          <p className="card px-4 py-3 text-sm text-muted">
            No fixtures set up. A manager assigns one to each rotation product from the Site
            portal, and the list builds itself overnight.
          </p>
        )}
      </section>
    </div>
  );
}
