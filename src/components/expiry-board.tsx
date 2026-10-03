'use client';

import { COLUMN_TITLE, type Board, type BoardColumn } from '@/lib/expiry/board';
import { ReminderCard, useBatchAnswers, type ReminderCardData } from '@/components/reminder-card';

// A coloured mark beside each written heading; colour is never the only cue.
const ACCENT: Record<BoardColumn, string> = {
  pull: 'bg-critical',
  markdown: 'bg-warning',
  check: 'bg-brand',
  onHalfPrice: 'bg-warning-soft border border-warning',
  comingUp: 'bg-good',
};

// What needs an answer today (the Today list), then what is coming.
const GROUPS: { title: string; columns: BoardColumn[]; grid: string }[] = [
  { title: 'Needs an answer today', columns: ['pull', 'markdown', 'check'], grid: 'md:grid-cols-3' },
  { title: 'Looking ahead', columns: ['onHalfPrice', 'comingUp'], grid: 'md:grid-cols-2' },
];

/**
 * Every dated batch at the site, by what it needs. The first three columns are the
 * Today list and take the same one-tap answers; the last two look ahead, and a card
 * there can be marked sold out if the stock went early.
 */
export function ExpiryBoard({ board }: { board: Board }) {
  const { isHidden, error, answer } = useBatchAnswers();

  return (
    <div className="space-y-8">
      {error && (
        <p role="alert" className="rounded-lg border border-critical bg-critical-soft px-3 py-2 text-sm text-critical-ink">
          {error}
        </p>
      )}

      {/* Two groups, each its own row of columns: a long column only ever sits beside
          its own group's columns, and the second group starts under its own heading. */}
      {GROUPS.map((group) => (
        <div key={group.title} className="space-y-3">
          <h2 className="section-title">{group.title}</h2>
          <div className={`grid items-start gap-4 ${group.grid}`}>
            {group.columns.map((column) => {
              const cards = board.columns.find((c) => c.column === column)?.cards ?? [];
              const visible: ReminderCardData[] = cards
                .map((c) => ({ ...c, key: c.id, batchId: c.id, kind: c.column }))
                .filter((c) => !isHidden(c.key));
              return (
                <section key={column} aria-label={COLUMN_TITLE[column]}>
                  <header className="mb-2 flex items-center gap-2">
                    <span aria-hidden className={`inline-block size-3 rounded-sm ${ACCENT[column]}`} />
                    <h3 className="text-sm font-semibold">{COLUMN_TITLE[column]}</h3>
                    <span className="ml-auto text-xs tabular-nums text-muted">{visible.length}</span>
                  </header>
                  <ul className="space-y-2">
                    {visible.map((card) => (
                      <ReminderCard key={card.key} card={card} onAnswer={answer} compact />
                    ))}
                    {visible.length === 0 && <li className="card px-3 py-2.5 text-xs text-muted">Nothing here.</li>}
                  </ul>
                  {column === 'comingUp' && (
                    <p className="mt-2 text-xs text-muted">
                      The next {board.lookAheadDays} days.
                      {board.laterCount > 0 && ` ${board.laterCount} more dated ${board.laterCount === 1 ? 'batch expires' : 'batches expire'} later.`}
                    </p>
                  )}
                </section>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
