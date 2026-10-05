import { addDays, format, parseISO } from 'date-fns';

/** "Within 7 days" ends here — the same line `bucketFor` draws between `soon` and `watch`. */
export const SOON_DAYS = 7;

/**
 * The last expiry date that still "needs attention" (overdue, today, or within 7 days), so
 * the database can count those batches instead of the page downloading them all.
 */
export function attentionUntil(asOf: string): string {
  return format(addDays(parseISO(asOf), SOON_DAYS), 'yyyy-MM-dd');
}
