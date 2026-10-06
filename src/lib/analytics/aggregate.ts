import { format, parseISO, startOfMonth, subMonths } from 'date-fns';
import type { WasteReason } from '@/lib/supabase/types';

/**
 * Aggregation for the dashboards, kept pure so the arithmetic behind a dollar figure is
 * testable without a database. Money on a screen that nobody can check is how a portfolio
 * piece becomes an embarrassment.
 */

export type WasteRow = {
  wastedAt: string;
  reason: WasteReason;
  qty: number;
  valueAud: number | null;
  siteId: string;
};

export type MonthTotal = { month: string; label: string; valueAud: number };

/**
 * A dollar total per month over a fixed window, **including the months with no waste**.
 *
 * Dropping empty months is the classic version of this chart being wrong: a quiet month
 * would vanish and the line would join two distant points as though nothing happened in
 * between, reading as a smooth trend rather than a gap.
 */
export function wasteByMonth(rows: WasteRow[], months: number, asOf: string): MonthTotal[] {
  const end = startOfMonth(parseISO(asOf));
  const buckets = new Map<string, MonthTotal>();

  for (let i = months - 1; i >= 0; i--) {
    const month = subMonths(end, i);
    const key = format(month, 'yyyy-MM');
    buckets.set(key, { month: key, label: format(month, 'MMM'), valueAud: 0 });
  }

  for (const row of rows) {
    const key = format(startOfMonth(parseISO(row.wastedAt)), 'yyyy-MM');
    const bucket = buckets.get(key);
    if (bucket) bucket.valueAud += row.valueAud ?? 0;
  }

  return [...buckets.values()];
}

export type SiteTotal = { siteId: string; name: string; valueAud: number; events: number };

/**
 * Waste per site, worst first, with every site present even when it wasted nothing.
 *
 * A league table that silently omits the sites doing well tells the opposite story from
 * the true one — the reader assumes the missing sites simply were not measured.
 */
export function siteLeague(
  sites: { id: string; name: string }[],
  rows: WasteRow[],
): SiteTotal[] {
  const totals = new Map<string, SiteTotal>(
    sites.map((s) => [s.id, { siteId: s.id, name: s.name, valueAud: 0, events: 0 }]),
  );

  for (const row of rows) {
    const site = totals.get(row.siteId);
    if (!site) continue; // waste from a site this user cannot see; RLS should prevent it
    site.valueAud += row.valueAud ?? 0;
    site.events += 1;
  }

  return [...totals.values()].sort((a, b) => b.valueAud - a.valueAud || a.name.localeCompare(b.name));
}

export type ExpiryBucket = 'overdue' | 'today' | 'soon' | 'watch';

/** The urgency band a given days-remaining falls in; the seed checks use it to cover every band. */
export function bucketFor(daysLeft: number): ExpiryBucket {
  if (daysLeft < 0) return 'overdue';
  if (daysLeft === 0) return 'today';
  if (daysLeft <= 7) return 'soon';
  return 'watch';
}
