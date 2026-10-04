import { bucketFor } from '@/lib/analytics/aggregate';
import type { ExpiryActionKind } from '@/lib/supabase/types';

/**
 * How dated stock is shown, in one place, so the Today list and the expiry board can never
 * disagree about what "2 days" looks like.
 */

/** A `.pill-*` modifier from globals.css. */
export type PillTone = 'critical' | 'warning' | 'neutral' | 'quiet';

/** The pill for a number of days left on the expiry board: by bucket. */
export function daysLeftTone(daysLeft: number): PillTone {
  const bucket = bucketFor(daysLeft);
  if (bucket === 'overdue') return 'critical';
  if (bucket === 'today') return 'warning';
  if (bucket === 'soon') return 'neutral';
  return 'quiet';
}

/** The pill for an action on the Today list: what staff have to do decides the colour. */
export function actionTone(action: ExpiryActionKind): PillTone {
  if (action === 'pull') return 'critical';
  if (action === 'markdown') return 'warning';
  return 'neutral';
}

/** Short form for a pill: "−1", "0", "7". */
export function daysLeftShort(daysLeft: number): string {
  return daysLeft < 0 ? `−${Math.abs(daysLeft)}` : String(daysLeft);
}

/** Sentence form: "expired 1 day ago", "expires today", "expires in 2 days". */
export function daysLeftText(daysLeft: number): string {
  const n = Math.abs(daysLeft);
  const days = `${n} ${n === 1 ? 'day' : 'days'}`;
  if (daysLeft < 0) return `expired ${days} ago`;
  if (daysLeft === 0) return 'expires today';
  return `expires in ${days}`;
}

const ACTION_RANK: Record<ExpiryActionKind, number> = { pull: 0, markdown: 1, check: 2 };

/**
 * The order staff work the list in: anything to pull off the shelf first, then markdowns,
 * then checks; within each, the soonest date first. The head of this list is "Next up".
 */
export function orderForShift<T extends { action: ExpiryActionKind; dueDate: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) => ACTION_RANK[a.action] - ACTION_RANK[b.action] || a.dueDate.localeCompare(b.dueDate),
  );
}
