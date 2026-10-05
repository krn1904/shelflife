import type { AppRole, ExpiryActionKind } from '@/lib/supabase/types';

/**
 * The in-app reminder: what a staff member or manager sees when they open ShelfLife and
 * something at their site is due. Shown inside the account, not pushed to a device, so it
 * needs no notification permission and follows the person to whichever device they sign in on.
 *
 * Counts, not product names: naming one item when eleven need pulling is worse than naming
 * none, and the Today list is one tap away.
 */

/** Staff and managers work the floor. Owners and platform admins don't get shift reminders. */
export function remindersShownTo(role: AppRole): boolean {
  return role === 'staff' || role === 'manager';
}

export type ReminderInput = {
  actions: { action: ExpiryActionKind; daysLeft: number }[];
  openFixtures: number;
};

export type ReminderTone = 'critical' | 'warning' | 'neutral';

export type ReminderSummary = {
  pull: number;
  markdown: number;
  check: number;
  overdue: number;
  fixtures: number;
  /** Everything waiting on Today; the number on the Today tab. */
  total: number;
  /** Coloured by the most urgent kind; null when nothing is due, so nothing is shown. */
  tone: ReminderTone | null;
  title: string;
  body: string;
};

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function summariseReminders(input: ReminderInput): ReminderSummary {
  const pull = input.actions.filter((a) => a.action === 'pull').length;
  const markdown = input.actions.filter((a) => a.action === 'markdown').length;
  const check = input.actions.filter((a) => a.action === 'check').length;
  const overdue = input.actions.filter((a) => a.daysLeft < 0).length;
  const fixtures = input.openFixtures;
  const total = pull + markdown + check + fixtures;

  const lastDay = `${plural(pull, 'line', 'lines')} on ${pull === 1 ? 'its' : 'their'} last day`;
  const halfPrice = `${plural(markdown, 'line', 'lines')} to put on half price`;
  const parts: string[] = [];
  if (pull > 0) parts.push(lastDay);
  if (markdown > 0) parts.push(halfPrice);
  if (check > 0) parts.push(`${plural(check, 'line', 'lines')} to check`);
  if (fixtures > 0) parts.push(`${plural(fixtures, 'fixture', 'fixtures')} to walk`);

  // The title leads with the thing that costs money if ignored.
  const title = pull > 0 ? lastDay : markdown > 0 ? halfPrice : "Today's list is ready";
  const tone: ReminderTone | null =
    total === 0 ? null : pull > 0 ? 'critical' : markdown > 0 ? 'warning' : 'neutral';

  return {
    pull,
    markdown,
    check,
    overdue,
    fixtures,
    total,
    tone,
    title,
    body:
      parts.length > 0
        ? parts.join(', ') + (overdue > 0 ? ` · ${overdue} already past date` : '')
        : 'Nothing outstanding.',
  };
}

/**
 * The pop-up shows until it is acknowledged, once a day per account on each device. Keyed
 * by user as well as site, so on a shared store tablet one person's "Later" doesn't hide it
 * from the next. Compared with the site's own date (not the device clock), so a Melbourne
 * store's day turns over at Melbourne midnight.
 */
export function toastStorageKey(userId: string, siteId: string): string {
  return `shelflife:reminder-toast:${userId}:${siteId}`;
}

export function toastDue(acknowledgedOn: string | null, siteToday: string, total: number): boolean {
  return total > 0 && acknowledgedOn !== siteToday;
}

/** Away at least this long and the counts may be stale (the engine runs overnight). */
export const STALE_AFTER_MS = 60_000;

/**
 * Whether coming back to the app should re-read today's list: a tablet left on the Shift
 * screen or a phone resumed from the background shows whatever it rendered last, and the
 * site's day may even have turned over. A quick tab switch doesn't refetch.
 */
export function refreshOnReturn(hiddenAt: number | null, now: number, staleAfterMs = STALE_AFTER_MS): boolean {
  return hiddenAt !== null && now - hiddenAt >= staleAfterMs;
}
