import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { activeSite, requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/intake/expiry';
import { PageHeader } from '@/components/ui';
import { byUrgency } from '@/lib/expiry/today';
import { TodayList, type TodayItem, type FixtureCheck } from './today-list';

export default async function TodayPage() {
  const session = await requireSession();
  const site = activeSite(session);
  const supabase = await createClient();

  if (!site) {
    return (
      <div>
        <PageHeader title="Today" />
        <p className="mt-2 text-sm text-muted">You are not assigned to a site yet.</p>
      </div>
    );
  }

  const asOf = todayIn(site.timeZone);

  const [{ data: actions }, { data: checks }] = await Promise.all([
    supabase
      .from('expiry_actions')
      .select('id, action, due_date, stock_batches(id, qty_remaining, marked_down_at, products(name, brand, size))')
      .eq('site_id', site.id)
      .eq('state', 'open')
      .order('due_date'),
    supabase
      .from('rotation_checks')
      .select('id, fixture, state')
      .eq('site_id', site.id)
      .eq('check_date', asOf)
      .order('fixture'),
  ]);

  const items: TodayItem[] = (actions ?? [])
    .flatMap((row) => {
      const batch = row.stock_batches;
      if (!batch) return [];
      return [{
        id: row.id,
        batchId: batch.id,
        action: row.action,
        daysLeft: differenceInCalendarDays(parseISO(row.due_date), parseISO(asOf)),
        qtyRemaining: batch.qty_remaining,
        markedDownOn: batch.marked_down_at,
        name: batch.products?.name ?? 'Unknown product',
        detail: [batch.products?.brand, batch.products?.size].filter(Boolean).join(' · '),
      }];
    })
    .sort(byUrgency);

  const fixtures: FixtureCheck[] = (checks ?? []).map((c) => ({
    id: c.id,
    fixture: c.fixture,
    done: c.state !== 'open',
  }));

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader title="Today" subtitle={`${site.name} · ${format(parseISO(asOf), 'EEE d MMM')}`} />
      <TodayList items={items} fixtures={fixtures} timeZone={site.timeZone} />
    </div>
  );
}
