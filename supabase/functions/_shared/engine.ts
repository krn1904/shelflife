import { differenceInCalendarDays, parseISO } from 'date-fns';

/**
 * The expiry engine's decision logic, kept as plain functions with no database and no
 * Deno in sight. The scheduled Edge Function is a thin wrapper: it reads rows, calls
 * these, and writes the result. That is what makes the rules testable — the function
 * itself cannot be run here, but everything it decides can.
 */

export type ExpiryActionKind = 'check' | 'markdown' | 'pull';

/**
 * The T-30/14/7/3/1 ladder, most urgent first.
 *
 * The action escalates with the date because the useful response does: a month out you
 * face it forward, a week out you discount it, a day out it comes off the shelf. Ordered
 * most-urgent-first so the first match wins.
 */
const LADDER: { withinDays: number; action: ExpiryActionKind }[] = [
  { withinDays: 1, action: 'pull' },
  { withinDays: 3, action: 'markdown' },
  { withinDays: 7, action: 'markdown' },
  { withinDays: 14, action: 'check' },
  { withinDays: 30, action: 'check' },
];

export const HORIZON_DAYS = LADDER[LADDER.length - 1].withinDays;

export const ACTION_LABEL: Record<ExpiryActionKind, string> = {
  check: 'Check',
  markdown: 'Mark down',
  pull: 'Pull',
};

export type BatchRow = {
  id: string;
  orgId: string;
  siteId: string;
  expiryDate: string | null;
};

export type PlannedAction = {
  batchId: string;
  orgId: string;
  siteId: string;
  action: ExpiryActionKind;
  dueDate: string;
  daysLeft: number;
};

/**
 * Exactly one action per batch — the most urgent tier it currently qualifies for.
 *
 * Not one per threshold: a batch that has crossed 30, 14 and 7 needs one instruction,
 * not three. This pairs with the partial unique index on (batch_id) where state = 'open',
 * so a re-run cannot stack duplicates.
 */
export function planExpiryActions(batches: BatchRow[], today: string): PlannedAction[] {
  const asOf = parseISO(today);

  return batches.flatMap((batch) => {
    // A batch with no date was never given one at intake. It cannot be scheduled, and
    // inventing a date for it would be worse than leaving it off the list.
    if (!batch.expiryDate) return [];

    const daysLeft = differenceInCalendarDays(parseISO(batch.expiryDate), asOf);

    // Already expired: always a pull, however far past.
    const tier =
      daysLeft < 0
        ? { withinDays: 0, action: 'pull' as const }
        : LADDER.find((step) => daysLeft <= step.withinDays);

    if (!tier) return []; // beyond the horizon — nothing to say about it yet

    return [{
      batchId: batch.id,
      orgId: batch.orgId,
      siteId: batch.siteId,
      action: tier.action,
      dueDate: batch.expiryDate,
      daysLeft,
    }];
  });
}

export type FixtureRow = { orgId: string; siteId: string; fixture: string };

export type PlannedRotationCheck = {
  orgId: string;
  siteId: string;
  fixture: string;
  checkDate: string;
};

/**
 * One check per fixture per site per day. Rotation stock carries no dates, so the daily
 * tick-list is the whole mechanism for it — the point of the rotation mode is that staff
 * look at the fridge rather than scan every bottle in it.
 */
export function planRotationChecks(
  fixtures: FixtureRow[],
  today: string,
): PlannedRotationCheck[] {
  const seen = new Set<string>();
  const planned: PlannedRotationCheck[] = [];

  for (const row of fixtures) {
    const fixture = row.fixture.trim();
    if (fixture === '') continue; // unfixtured stock has no shelf to go and look at

    const key = `${row.siteId}::${fixture}`;
    if (seen.has(key)) continue;
    seen.add(key);

    planned.push({ orgId: row.orgId, siteId: row.siteId, fixture, checkDate: today });
  }

  return planned;
}

/** How the whole run reports itself into job_runs. */
export type JobResult = {
  ok: boolean;
  processed: number;
  skipped: number;
  reason: string | null;
};
