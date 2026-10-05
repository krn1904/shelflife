import { format, parseISO } from 'date-fns';
import { localDate } from '@/lib/expiry/engine';
import type { BoardColumn } from '@/lib/expiry/board';
import type { ExpiryActionKind } from '@/lib/supabase/types';

/** What each Today card is called. */
export const CARD_TITLE: Record<ExpiryActionKind, string> = {
  pull: 'Last day',
  markdown: 'Half price',
  check: 'Check',
};

// Most urgent first: last day, then half price, then early checks.
const CARD_ORDER: Record<ExpiryActionKind, number> = { pull: 0, markdown: 1, check: 2 };

export function byUrgency<T extends { action: ExpiryActionKind; daysLeft: number }>(a: T, b: T): number {
  return CARD_ORDER[a.action] - CARD_ORDER[b.action] || a.daysLeft - b.daysLeft;
}

/** "Expires in 2 days", "Expires today", "Expired 3 days ago". */
export function whenText(daysLeft: number): string {
  const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
  if (daysLeft < 0) return `Expired ${days(-daysLeft)} ago`;
  if (daysLeft === 0) return 'Expires today';
  return `Expires in ${days(daysLeft)}`;
}

/** The one-line instruction under a card's title. Board-only columns just say where it stands. */
export function cardInstruction(
  card: { action: BoardColumn; daysLeft: number; markedDownOn: string | null },
  timeZone: string, // the site's, so the date matches the store's calendar
): string {
  const since = card.markedDownOn ? `On half price since ${format(parseISO(localDate(card.markedDownOn, timeZone)), 'EEE d MMM')}. ` : '';
  if (card.action === 'check') return `${card.daysLeft} days left. Face it up or put it on special.`;
  if (card.action === 'markdown') return `${whenText(card.daysLeft)}. Put it on half price.`;
  if (card.action === 'onHalfPrice') return `${since}${whenText(card.daysLeft)}.`;
  if (card.action === 'comingUp') return `${whenText(card.daysLeft)}. Nothing to do yet.`;
  return `${since}${whenText(card.daysLeft)}. Still on the shelf? Pull it out.`;
}
