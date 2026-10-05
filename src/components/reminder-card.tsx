'use client';

import { useState, useTransition } from 'react';
import { sendOrQueue } from '@/lib/offline/send';
import { cardInstruction } from '@/lib/expiry/today';
import { COLUMN_TITLE, type BoardColumn } from '@/lib/expiry/board';
import type { BatchStep } from '@/lib/supabase/types';

/** What a card needs, whether it sits on the Today list or the expiry board. */
export type ReminderCardData = {
  key: string;            // unique on the screen (reminder id, or batch id on the board)
  batchId: string;
  kind: BoardColumn;
  daysLeft: number;
  qtyRemaining: number;
  markedDownOn: string | null;
  name: string;
  detail: string;
  predicted?: boolean;    // date never confirmed at intake
};

// The status pill: dark text on a bright fill for what needs doing today, quieter for
// what is only being watched. The written title always sits inside it.
const PILL: Record<BoardColumn, string> = {
  pull: 'pill-critical',
  markdown: 'pill-warning',
  check: 'pill-neutral',
  onHalfPrice: 'pill-neutral',
  comingUp: 'pill-quiet',
};

/**
 * Sends answers for cards and hides each one at once (staff are at the shelf; a card
 * that lingers gets tapped twice). Works offline through the outbox. Brings the card
 * back with a message if the server refuses.
 */
export function useBatchAnswers() {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function answer(card: ReminderCardData, step: BatchStep, qty: number | null = null) {
    setHidden((prev) => new Set(prev).add(card.key));
    setError(null);
    startTransition(async () => {
      const result = await sendOrQueue('batch-step', { batch_id: card.batchId, step, qty });
      if (result.status === 'error') {
        setError(`${card.name}: ${result.message}`);
        setHidden((prev) => {
          const next = new Set(prev);
          next.delete(card.key);
          return next;
        });
      }
    });
  }

  return { isHidden: (key: string) => hidden.has(key), error, setError, answer };
}

/**
 * One card and its answers. Last-day cards also ask how many are being binned.
 * `featured` is Today's "Next up"; `compact` fits a narrow board column.
 */
export function ReminderCard({
  card,
  onAnswer,
  timeZone,
  compact = false,
  featured = false,
}: {
  card: ReminderCardData;
  onAnswer: (card: ReminderCardData, step: BatchStep, qty?: number | null) => void;
  timeZone: string; // the site's, for "on half price since <date>"
  compact?: boolean; // tighter layout for board columns
  featured?: boolean; // the larger "Next up" card on Today
}) {
  const [left, setLeft] = useState(String(card.qtyRemaining));
  const leftCount = Number(left);
  const leftValid = left !== '' && Number.isInteger(leftCount) && leftCount >= 0 && leftCount <= card.qtyRemaining;
  const button = compact ? 'btn btn-sm' : featured ? 'btn min-h-12' : 'btn';

  return (
    <li className={`card ${compact ? 'px-3 py-2.5' : featured ? 'rounded-[1.125rem] p-5' : 'px-4 py-3'}`}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={`pill ${PILL[card.kind]}`}>{COLUMN_TITLE[card.kind].toUpperCase()}</span>
        <span className={`font-mono text-muted ${compact ? 'text-[0.6875rem]' : 'text-xs'} ml-auto`}>
          {card.qtyRemaining} in stock
        </span>
      </div>
      <p className={`mt-2 font-semibold leading-tight ${compact ? 'text-sm' : featured ? 'text-[1.375rem] tracking-tight' : 'text-[0.9375rem]'}`}>
        {card.name}
      </p>
      {card.detail && <p className="text-xs text-muted">{card.detail}</p>}
      <p className={`mt-1 text-muted ${compact ? 'text-xs' : 'text-sm'}`}>{cardInstruction({ action: card.kind, ...card }, timeZone)}</p>
      {card.predicted && <p className="mt-1 text-xs font-semibold text-warning">Date never confirmed</p>}

      <div className={`${compact ? 'mt-2' : 'mt-4'} flex flex-wrap items-center gap-2`}>
        {card.kind === 'check' && (
          <button type="button" className={`${button} btn-primary`} onClick={() => onAnswer(card, 'checked')}>
            Checked
          </button>
        )}

        {card.kind === 'markdown' && (
          <>
            <button type="button" className={`${button} btn-primary`} onClick={() => onAnswer(card, 'marked_down')}>
              Reduced price
            </button>
            <button type="button" className={`${button} btn-outline`} onClick={() => onAnswer(card, 'sold')}>
              Gone (sold)
            </button>
          </>
        )}

        {card.kind === 'pull' && (
          <>
            <label className="flex items-center gap-2 text-sm">
              Left on shelf
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={card.qtyRemaining}
                value={left}
                onChange={(e) => setLeft(e.target.value)}
                className={`field font-mono ${compact ? 'min-h-9 w-16 py-1' : 'w-20'}`}
                aria-label={`How many ${card.name} are left on the shelf`}
              />
            </label>
            <button
              type="button"
              className={`${button} btn-primary`}
              disabled={!leftValid}
              onClick={() => onAnswer(card, 'pulled', leftCount)}
            >
              Pulled out
            </button>
            <button type="button" className={`${button} btn-outline`} onClick={() => onAnswer(card, 'sold')}>
              Sold (none left)
            </button>
          </>
        )}

        {/* Nothing is due yet, but stock can sell out early. */}
        {(card.kind === 'onHalfPrice' || card.kind === 'comingUp') && (
          <button type="button" className={`${button} btn-ghost`} onClick={() => onAnswer(card, 'sold')}>
            Sold out
          </button>
        )}
      </div>
    </li>
  );
}
