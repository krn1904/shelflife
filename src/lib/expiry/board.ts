import { differenceInCalendarDays, parseISO } from 'date-fns';
import type { ExpiryActionKind } from '@/lib/supabase/types';

/**
 * The expiry board's columns. The first three are exactly the Today list (the nightly
 * reminders); the last two are the rest of the dated stock, so the board can look ahead.
 */
export type BoardColumn = 'pull' | 'markdown' | 'check' | 'onHalfPrice' | 'comingUp';

export const BOARD_COLUMNS: BoardColumn[] = ['pull', 'markdown', 'check', 'onHalfPrice', 'comingUp'];

export const COLUMN_TITLE: Record<BoardColumn, string> = {
  pull: 'Last day',
  markdown: 'Half price',
  check: 'Check',
  onHalfPrice: 'On half price',
  comingUp: 'Coming up',
};

export type BoardBatch = {
  id: string;
  expiryDate: string;
  qtyRemaining: number;
  markedDownOn: string | null;
  name: string;
  detail: string;
  predicted: boolean; // date was proposed, never confirmed at intake
};

/** Today's open reminder for a batch, from the nightly job. */
export type OpenReminder = { id: string; batchId: string; action: ExpiryActionKind };

export type BoardCard = BoardBatch & {
  column: BoardColumn;
  daysLeft: number;
  reminderId: string | null; // set for the three reminder columns
};

export type Board = {
  columns: { column: BoardColumn; cards: BoardCard[] }[];
  laterCount: number;    // dated stock beyond the look-ahead window, not shown as cards
  lookAheadDays: number; // how far "Coming up" reaches
};

/**
 * Sorts dated stock into the board's columns.
 *
 *   open reminder today         → its column (Last day / Half price / Check)
 *   on or past expiry, no reminder → Last day (the nightly job has not caught up)
 *   already marked down         → On half price (waiting for its last day)
 *   within the look-ahead days  → Coming up
 *   further out                 → counted, not shown
 *
 * Soonest expiry first in every column.
 */
export function buildBoard(
  batches: BoardBatch[],
  reminders: OpenReminder[],
  today: string,
  lookAheadDays: number,
): Board {
  const reminderFor = new Map(reminders.map((r) => [r.batchId, r]));
  const asOf = parseISO(today);
  let laterCount = 0;

  const cards = batches.flatMap((batch): BoardCard[] => {
    const daysLeft = differenceInCalendarDays(parseISO(batch.expiryDate), asOf);
    const reminder = reminderFor.get(batch.id);

    let column: BoardColumn;
    if (reminder) column = reminder.action;
    // On or past its date with no reminder yet (the nightly job has not run since, or it
    // failed): still a last-day call, never "nothing to do yet".
    else if (daysLeft <= 0) column = 'pull';
    else if (batch.markedDownOn) column = 'onHalfPrice';
    else if (daysLeft <= lookAheadDays) column = 'comingUp';
    else {
      laterCount += 1;
      return [];
    }
    return [{ ...batch, column, daysLeft, reminderId: reminder?.id ?? null }];
  });

  cards.sort((a, b) => a.daysLeft - b.daysLeft || a.name.localeCompare(b.name));

  return {
    columns: BOARD_COLUMNS.map((column) => ({ column, cards: cards.filter((c) => c.column === column) })),
    laterCount,
    lookAheadDays,
  };
}
