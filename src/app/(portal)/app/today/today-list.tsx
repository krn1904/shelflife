'use client';

import { useState, useTransition } from 'react';
import { setRotationCheckState } from '@/lib/expiry/actions';
import { sendOrQueue } from '@/lib/offline/send';
import { CARD_TITLE, cardInstruction } from '@/lib/expiry/today';
import { SectionTitle } from '@/components/ui';
import type { BatchStep, ExpiryActionKind } from '@/lib/supabase/types';

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

const TONE: Record<ExpiryActionKind, string> = {
  pull: 'border-critical bg-critical-soft',
  markdown: 'border-warning bg-warning-soft',
  check: '',
};

/**
 * The shift's whole list: dated stock that needs an answer, then fixtures to walk past.
 *
 * Every answer is one tap (plus a count when binning). It works without signal: the
 * answer is kept on the phone and sent when the connection returns.
 */
export function TodayList({ items, fixtures }: { items: TodayItem[]; fixtures: FixtureCheck[] }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function answer(item: TodayItem, step: BatchStep, qty: number | null = null) {
    // Hide at once: staff are at the shelf, and a card that lingers gets tapped twice.
    setHidden((prev) => new Set(prev).add(item.id));
    setError(null);
    startTransition(async () => {
      const result = await sendOrQueue('batch-step', { batch_id: item.batchId, step, qty });
      if (result.status === 'error') {
        setError(`${item.name}: ${result.message}`);
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
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
        <p role="alert" className="rounded-lg border border-critical bg-critical-soft px-3 py-2 text-sm text-critical-ink">
          {error}
        </p>
      )}

      <section>
        <SectionTitle>Dated stock ({visible.length})</SectionTitle>
        <ul className="space-y-2">
          {visible.map((item) => (
            <ReminderCard key={item.id} item={item} onAnswer={answer} />
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

/** One reminder and its answers. Last-day cards also ask how many are being binned. */
function ReminderCard({
  item,
  onAnswer,
}: {
  item: TodayItem;
  onAnswer: (item: TodayItem, step: BatchStep, qty?: number | null) => void;
}) {
  const [left, setLeft] = useState(String(item.qtyRemaining));
  const leftCount = Number(left);
  const leftValid = left !== '' && Number.isInteger(leftCount) && leftCount >= 0 && leftCount <= item.qtyRemaining;

  return (
    <li className={`card px-4 py-3 ${TONE[item.action]}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm font-semibold">{CARD_TITLE[item.action]}</span>
        <span className="text-sm">{item.name}</span>
        {item.detail && <span className="text-xs text-muted">{item.detail}</span>}
        <span className="ml-auto text-xs text-muted">{item.qtyRemaining} in stock</span>
      </div>
      <p className="mt-1 text-sm text-muted">{cardInstruction(item)}</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {item.action === 'check' && (
          <button type="button" className="btn btn-primary" onClick={() => onAnswer(item, 'checked')}>
            Checked
          </button>
        )}

        {item.action === 'markdown' && (
          <>
            <button type="button" className="btn btn-primary" onClick={() => onAnswer(item, 'marked_down')}>
              Reduced price
            </button>
            <button type="button" className="btn btn-outline" onClick={() => onAnswer(item, 'sold')}>
              Gone (sold)
            </button>
          </>
        )}

        {item.action === 'pull' && (
          <>
            <label className="flex items-center gap-2 text-sm">
              Left on shelf
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={item.qtyRemaining}
                value={left}
                onChange={(e) => setLeft(e.target.value)}
                className="field w-20"
                aria-label={`How many ${item.name} are left on the shelf`}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!leftValid}
              onClick={() => onAnswer(item, 'pulled', leftCount)}
            >
              Pulled out
            </button>
            <button type="button" className="btn btn-outline" onClick={() => onAnswer(item, 'sold')}>
              Sold (none left)
            </button>
          </>
        )}
      </div>
    </li>
  );
}
