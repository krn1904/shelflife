/**
 * How a manager reads back a delivery staff received: which lines came short, over or not at
 * all, what that adds up to per delivery, and which deliveries a list shows. Free of the
 * database so it can be tested.
 */

export type LineStatus = 'ok' | 'short' | 'over' | 'missing';

/** Received against what the docket said: nothing at all is "missing", not merely short. */
export function lineStatus(docketed: number, received: number): LineStatus {
  if (received === 0 && docketed > 0) return 'missing';
  if (received < docketed) return 'short';
  if (received > docketed) return 'over';
  return 'ok';
}

export type LineCounts = { qty_docketed: number; qty_received: number };

export type DeliveryTotals = {
  lines: number;
  docketed: number;
  received: number;
  /** Lines that came short, including those that did not arrive at all. */
  short: number;
  missing: number;
  over: number;
  /** Units the docket claimed that did not arrive. */
  unitsShort: number;
};

export function deliveryTotals(lines: LineCounts[]): DeliveryTotals {
  const totals: DeliveryTotals = { lines: lines.length, docketed: 0, received: 0, short: 0, missing: 0, over: 0, unitsShort: 0 };
  for (const l of lines) {
    totals.docketed += l.qty_docketed;
    totals.received += l.qty_received;
    const status = lineStatus(l.qty_docketed, l.qty_received);
    if (status === 'short' || status === 'missing') {
      totals.short += 1;
      totals.unitsShort += l.qty_docketed - l.qty_received;
    }
    if (status === 'missing') totals.missing += 1;
    if (status === 'over') totals.over += 1;
  }
  return totals;
}

// ---------------------------------------------------------------------------------------
// The list's filters, read from the URL

export const RANGES = { '7d': 7, '30d': 30, '90d': 90 } as const;
export type RangeKey = keyof typeof RANGES;

export type ReviewFilters = {
  range: RangeKey;
  /** Only deliveries with a short or missing line. */
  shortOnly: boolean;
  supplierId: string | null;
};

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Anything unrecognised falls back to the default rather than failing: it is only a filter. */
export function reviewFilters(params: Params): ReviewFilters {
  const range = first(params.range);
  const supplier = first(params.supplier);
  return {
    range: range && range in RANGES ? (range as RangeKey) : '30d',
    shortOnly: first(params.short) === '1',
    supplierId: supplier && UUID.test(supplier) ? supplier : null,
  };
}

/** The start of the range as an ISO timestamp, counted back from `now` in whole days. */
export function rangeStart(range: RangeKey, now: Date): string {
  return new Date(now.getTime() - RANGES[range] * 24 * 60 * 60 * 1000).toISOString();
}

/** How long a delivery has been open, the way a manager would say it. */
export function openFor(startedAt: string, now: Date): string {
  const minutes = Math.max(0, Math.floor((now.getTime() - new Date(startedAt).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} days`;
}

/** A timestamp in the site's own timezone: the server runs in UTC, the store does not. */
export function atSite(iso: string | null, timeZone: string, withTime = true): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-AU', {
    timeZone,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }).format(new Date(iso));
}
