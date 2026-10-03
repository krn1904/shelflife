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

const TONE: Record<BoardColumn, string> = {
  pull: 'border-critical bg-critical-soft',
  markdown: 'border-warning bg-warning-soft',
  check: '',
  onHalfPrice: '',
  comingUp: '',
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

/** One card and its answers. Last-day cards also ask how many are being binned. */
export function ReminderCard({
  card,
  onAnswer,
  compact = false,
}: {
  card: ReminderCardData;
  onAnswer: (card: ReminderCardData, step: BatchStep, qty?: number | null) => void;
  compact?: boolean; // tighter layout for board columns
}) {
  const [left, setLeft] = useState(String(card.qtyRemaining));
  const leftCount = Number(left);
  const leftValid = left !== '' && Number.isInteger(leftCount) && leftCount >= 0 && leftCount <= card.qtyRemaining;
  const button = compact ? 'btn px-2.5 py-1.5 text-xs' : 'btn';

  return (
    <li className={`card ${compact ? 'px-3 py-2.5' : 'px-4 py-3'} ${TONE[card.kind]}`}>
      {compact ? (
        // Narrow board column: name, then brand · size · stock on one line beneath.
        <>
          <p className="text-sm font-medium">{card.name}</p>
          <p className="text-xs text-muted">
            {[card.detail, `${card.qtyRemaining} in stock`].filter(Boolean).join(' · ')}
          </p>
        </>
      ) : (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-sm font-semibold">{COLUMN_TITLE[card.kind]}</span>
          <span className="text-sm font-medium">{card.name}</span>
          {card.detail && <span className="text-xs text-muted">{card.detail}</span>}
          <span className="ml-auto text-xs text-muted">{card.qtyRemaining} in stock</span>
        </div>
      )}
      <p className={`mt-1 text-muted ${compact ? 'text-xs' : 'text-sm'}`}>{cardInstruction({ action: card.kind, ...card })}</p>
      {card.predicted && <p className="mt-1 text-xs text-warning">Date never confirmed</p>}

      <div className={`${compact ? 'mt-2' : 'mt-3'} flex flex-wrap items-center gap-2`}>
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
                className={`field ${compact ? 'w-16 py-1' : 'w-20'}`}
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
