import Link from 'next/link';
import { subMonths } from 'date-fns';
import { activeSite, requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/intake/expiry';
import { attentionUntil } from '@/lib/expiry/display';
import { formatAud } from '@/lib/charts/tokens';
import { Stat } from '@/components/stat';
import { PageHeader, SectionTitle, QuickAction } from '@/components/ui';
import { loadReminders } from '@/lib/expiry/reminders-data';
import { ReminderBanner } from '@/components/reminder-banner';
import { newItemsToReview } from '@/lib/deliveries/review-queue';
import { RefreshButton } from '@/components/refresh-button';
import { loadActivity } from '@/lib/activity/feed-data';
import { clockAt, whenAgo } from '@/lib/activity/feed';
import { atSite } from '@/lib/deliveries/review';


export default async function ManagePage() {
  const session = await requireRole('manager');
  const site = activeSite(session);
  const supabase = await createClient();
  // The site's calendar; with no site there is nothing to count, so any zone will do.
  const asOf = todayIn(site?.timeZone ?? 'UTC');
  const monthStart = subMonths(new Date(asOf), 1).toISOString();

  const now = new Date();
  const [{ count: ranged }, { count: urgentCount }, { data: waste }, { count: openDeliveries }, activity, reminders, toReview] =
    await Promise.all([
      supabase.from('site_products').select('*', { count: 'exact', head: true }),
      // Counted by the database: every dated batch used to be downloaded just to count these.
      supabase
        .from('stock_batches')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active')
        .gt('qty_remaining', 0)
        .lte('expiry_date', attentionUntil(asOf)),
      supabase.from('waste_events').select('value_aud').gte('wasted_at', monthStart),
      supabase.from('deliveries').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
      site ? loadActivity(supabase, site.id, now) : Promise.resolve([]),
      loadReminders(session),
      site ? newItemsToReview(supabase, site.id) : Promise.resolve([]),
    ]);
  const unreviewed = toReview.length;

  const urgent = urgentCount ?? 0;

  const wasteThisMonth = (waste ?? []).reduce((sum, w) => sum + (w.value_aud ?? 0), 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Site"
        subtitle={site?.name ?? 'No site assigned'}
        actions={
          <>
            <RefreshButton loadedAt={clockAt(now, site?.timeZone ?? 'UTC')} />
            <a href="/manage/expiry" className="btn btn-primary">
              Expiry board
            </a>
          </>
        }
      />

      <ReminderBanner reminders={reminders} href="/manage/expiry" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Needs attention" value={urgent} tone={urgent ? 'critical' : 'default'} hint="expiring within 7 days" />
        <Stat label="Waste (30 days)" value={formatAud(wasteThisMonth)} />
        <Stat label="Open deliveries" value={openDeliveries ?? 0} />
        <Stat label="Ranged products" value={ranged ?? 0} />
      </div>

      <div>
        <SectionTitle>Manage</SectionTitle>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickAction href="/manage/deliveries" title="Deliveries"
            hint={unreviewed ? `Correct what staff received; ${unreviewed} new ${unreviewed === 1 ? 'item' : 'items'} to review` : 'What staff received; correct any mistakes'} />
          <QuickAction href="/manage/waste" title="Waste" hint="Log and review write-offs" />
          <QuickAction href="/manage/products" title="Products & ranging" hint="Par levels, fixtures, tracking modes" />
          <QuickAction href="/manage/expiry" title="Expiry board" hint="Everything dated, by days left" />
          <QuickAction href="/manage/reminders" title="Reminder settings" hint="When staff are told to check, discount or pull" />
          <QuickAction href="/manage/messages" title="Message staff" hint="Send a note; see who has read it" />
          <QuickAction href="/manage/people" title="People" hint="Add or remove the people who work here" />
        </div>
      </div>

      <div>
        <SectionTitle actions={<Link href="/manage/deliveries" className="text-sm text-muted hover:text-ink">All deliveries →</Link>}>
          Recent activity
        </SectionTitle>
        <ul className="card divide-y divide-line overflow-hidden">
          {activity.map((item) => {
            const line = (
              <>
                <span className="min-w-0">
                  <span className="font-medium">{item.actor ?? 'Someone'}</span> {item.text}
                </span>
                <span className="ml-auto shrink-0 text-xs text-muted">
                  {whenAgo(item.at, now, (iso) => atSite(iso, site?.timeZone ?? 'UTC', false))}
                </span>
              </>
            );
            return (
              <li key={item.id}>
                {item.href ? (
                  <Link href={item.href} className="flex items-baseline gap-3 px-4 py-2.5 text-sm hover:bg-surface-2">{line}</Link>
                ) : (
                  <div className="flex items-baseline gap-3 px-4 py-2.5 text-sm">{line}</div>
                )}
              </li>
            );
          })}
          {activity.length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">Nothing in the last week.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
