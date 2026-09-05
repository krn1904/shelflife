import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns';
import type { ExpirySource } from '@/lib/supabase/types';

// A shelf life outside this range is a data-entry accident, not a product. Observed
// history that falls outside it is ignored in favour of the catalogue default.
const MIN_PLAUSIBLE_DAYS = 1;
const MAX_PLAUSIBLE_DAYS = 3650;

export type ExpiryBasis = 'supplier-history' | 'catalogue-default' | 'none';

export type ExpiryProposal = {
  date: string | null;
  source: ExpirySource;
  basis: ExpiryBasis;
};

export type PreviousArrival = {
  receivedOn: string;
  expiryDate: string;
};

export const BASIS_NOTE: Record<ExpiryBasis, string> = {
  'supplier-history': 'from what this supplier sent last time',
  'catalogue-default': 'from the catalogue shelf life',
  none: 'no date to propose — enter it',
};

/**
 * Proposes the expiry for a docket line so staff confirm a date rather than type one.
 * This is the number the whole intake speed target rests on: a delivery has to close in
 * under a minute, and typing a date per line makes that impossible.
 *
 * The best evidence is what this supplier actually sent last time. We use its *observed
 * shelf life* — expiry minus arrival — rather than the previous expiry date itself: the
 * same product delivered three months later expires three months later, and reproposing
 * a stale date would be confidently wrong. Implausible history is discarded rather than
 * trusted, so one typo in a past delivery cannot poison every future proposal.
 */
export function proposeExpiry(input: {
  receivedOn: string;
  defaultShelfLifeDays: number | null;
  previous?: PreviousArrival | null;
}): ExpiryProposal {
  const receivedOn = parseISO(input.receivedOn);

  if (input.previous) {
    const observed = differenceInCalendarDays(
      parseISO(input.previous.expiryDate),
      parseISO(input.previous.receivedOn),
    );
    if (observed >= MIN_PLAUSIBLE_DAYS && observed <= MAX_PLAUSIBLE_DAYS) {
      return {
        date: format(addDays(receivedOn, observed), 'yyyy-MM-dd'),
        source: 'predicted',
        basis: 'supplier-history',
      };
    }
  }

  const fallback = input.defaultShelfLifeDays;
  if (fallback !== null && fallback >= MIN_PLAUSIBLE_DAYS && fallback <= MAX_PLAUSIBLE_DAYS) {
    return {
      date: format(addDays(receivedOn, fallback), 'yyyy-MM-dd'),
      source: 'predicted',
      basis: 'catalogue-default',
    };
  }

  // Nothing to go on. 'manual' rather than 'predicted' so a date typed here is never
  // mistaken for one the system stood behind.
  return { date: null, source: 'manual', basis: 'none' };
}

/** Today at the site, as the date-only string the whole intake flow passes around. */
export function today(): string {
  return format(new Date(), 'yyyy-MM-dd');
}
