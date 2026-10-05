import 'server-only';
import { cache } from 'react';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { activeSite, type Session, type SessionSite } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/intake/expiry';
import { remindersShownTo, summariseReminders, type ReminderSummary } from './reminders';

export type SiteReminders = { userId: string; site: SessionSite; today: string; summary: ReminderSummary };

/**
 * What is due today at the user's site, read with the same site, date and filters as the
 * Today page so the tab badge, the banner and the list never disagree.
 *
 * Returns null for anyone who doesn't get reminders, before querying anything.
 */
export async function loadReminders(session: Session): Promise<SiteReminders | null> {
  if (!remindersShownTo(session.primaryRole)) return null;
  const site = activeSite(session);
  if (!site) return null;
  const { today, summary } = await dueAt(site.id, site.timeZone);
  return { userId: session.userId, site, today, summary };
}

// Keyed on plain values, not the session: the layout and the page each resolve their own
// session object, and `cache` compares arguments by identity. One read per request.
const dueAt = cache(async (siteId: string, timeZone: string) => {
  const today = todayIn(timeZone);
  const supabase = await createClient();
  const [{ data: actions }, { count: openFixtures }] = await Promise.all([
    supabase
      .from('expiry_actions')
      .select('action, due_date')
      .eq('site_id', siteId)
      .eq('state', 'open'),
    supabase
      .from('rotation_checks')
      .select('*', { count: 'exact', head: true })
      .eq('site_id', siteId)
      .eq('check_date', today)
      .eq('state', 'open'),
  ]);

  const summary = summariseReminders({
    actions: (actions ?? []).map((a) => ({
      action: a.action,
      daysLeft: differenceInCalendarDays(parseISO(a.due_date), parseISO(today)),
    })),
    openFixtures: openFixtures ?? 0,
  });
  return { today, summary };
});
