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

const ACTIVITY_LIMIT = 8;

export default async function ManagePage() {
  const session = await requireRole('manager');
  const site = activeSite(session);
  const supabase = await createClient();
  // The site's calendar; with no site there is nothing to count, so any zone will do.
  const asOf = todayIn(site?.timeZone ?? 'UTC');
  const monthStart = subMonths(new Date(asOf), 1).toISOString();

  const [{ count: ranged }, { count: urgentCount }, { data: waste }, { count: openDeliveries }, { data: recent }, reminders] =
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
      supabase
        .from('deliveries')
        .select('id, closed_at, docket_number, suppliers(name)')
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(ACTIVITY_LIMIT),
      loadReminders(session),
    ]);

  const urgent = urgentCount ?? 0;

  const wasteThisMonth = (waste ?? []).reduce((sum, w) => sum + (w.value_aud ?? 0), 0);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Site"
        subtitle={site?.name ?? 'No site assigned'}
        actions={
          <a href="/manage/expiry" className="btn btn-primary">
            Expiry board
          </a>
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
          <QuickAction href="/manage/deliveries" title="Deliveries" hint="What staff received, and what came short" />
          <QuickAction href="/manage/waste" title="Waste" hint="Log and review write-offs" />
          <QuickAction href="/manage/products" title="Products & ranging" hint="Par levels, fixtures, tracking modes" />
          <QuickAction href="/manage/expiry" title="Expiry board" hint="Everything dated, by days left" />
          <QuickAction href="/manage/reminders" title="Reminder settings" hint="When staff are told to check, discount or pull" />
          <QuickAction href="/manage/people" title="People" hint="Add or remove the people who work here" />
        </div>
      </div>

      <div>
        <SectionTitle actions={<Link href="/manage/deliveries" className="text-sm text-muted hover:text-ink">All deliveries →</Link>}>
          Recent deliveries
        </SectionTitle>
        <ul className="card divide-y divide-line overflow-hidden">
          {(recent ?? []).map((d) => (
            <li key={d.id}>
              <Link href={`/manage/deliveries/${d.id}`} className="flex flex-wrap items-baseline gap-3 px-4 py-2.5 text-sm hover:bg-surface-2">
                <span className="font-medium">{d.suppliers?.name ?? 'Unknown supplier'}</span>
                {d.docket_number && (
                  <span className="font-mono text-xs text-faint">#{d.docket_number}</span>
                )}
                <span className="ml-auto text-xs text-muted">
                  {d.closed_at ? new Date(d.closed_at).toLocaleDateString('en-AU') : '—'}
                </span>
              </Link>
            </li>
          ))}
          {(recent ?? []).length === 0 && (
            <li className="px-4 py-6 text-center text-sm text-muted">Nothing received yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
