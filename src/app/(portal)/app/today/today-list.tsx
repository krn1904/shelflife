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
export function TodayList({ items, fixtures }: { items: TodayItem[]; fixtures: FixtureCheck[] }) {
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
  const visible = cards.filter((c) => !isHidden(c.key));

  return (
    <div className="space-y-8">
      {error && (
        <p role="alert" className="rounded-lg border border-critical bg-critical-soft px-3 py-2 text-sm text-critical-ink">
          {error}
        </p>
      )}

      <section>
        <SectionTitle actions={<Link href="/app/board" className="text-sm text-muted hover:text-ink">Expiry board →</Link>}>
          Dated stock ({visible.length})
        </SectionTitle>
        <ul className="space-y-2">
          {visible.map((card) => (
            <ReminderCard key={card.key} card={card} onAnswer={answer} />
          ))}
          {visible.length === 0 && (
            <li className="card px-4 py-3 text-sm text-muted">
              Nothing dated needs attention. The list is rebuilt overnight.
            </li>
          )}
        </ul>
      </section>

      <section>
        <SectionTitle>Fixtures to check</SectionTitle>
        <p className="-mt-1 mb-2 text-xs text-muted">
          Short-life stock is rotated by eye, so these are a walk-past rather than a scan.
        </p>
        <ul className="card divide-y divide-line">
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
                  className="size-5 accent-brand"
                />
                <span className={`text-sm ${done ? 'text-faint line-through' : ''}`}>{f.fixture}</span>
              </li>
            );
          })}
          {fixtures.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted">
              No fixtures set up. A manager assigns one to each rotation product from the Site
              portal, and the list builds itself overnight.
            </li>
          )}
        </ul>
      </section>
    </div>
  );
}
