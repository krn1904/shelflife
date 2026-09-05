import { differenceInCalendarDays, parseISO } from 'date-fns';
import { activeSite, requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { today } from '@/lib/intake/expiry';
import { ACTION_LABEL } from '@/lib/expiry/engine';
import { TodayList, type TodayItem, type FixtureCheck } from './today-list';

export default async function TodayPage() {
  const session = await requireSession();
  const site = activeSite(session);
  const supabase = await createClient();

  if (!site) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Today</h1>
        <p className="mt-2 text-sm text-neutral-500">You are not assigned to a site yet.</p>
      </div>
    );
  }

  const asOf = today();

  const [{ data: actions }, { data: checks }] = await Promise.all([
    supabase
      .from('expiry_actions')
      .select('id, action, due_date, stock_batches(id, qty_remaining, products(name, brand, size))')
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

  const items: TodayItem[] = (actions ?? []).flatMap((row) => {
    const batch = row.stock_batches;
    if (!batch) return [];
    return [{
      id: row.id,
      batchId: batch.id,
      action: row.action,
      actionLabel: ACTION_LABEL[row.action],
      dueDate: row.due_date,
      daysLeft: differenceInCalendarDays(parseISO(row.due_date), parseISO(asOf)),
      qtyRemaining: batch.qty_remaining,
      name: batch.products?.name ?? 'Unknown product',
      detail: [batch.products?.brand, batch.products?.size].filter(Boolean).join(' · '),
    }];
  });

  const fixtures: FixtureCheck[] = (checks ?? []).map((c) => ({
    id: c.id,
    fixture: c.fixture,
    done: c.state !== 'open',
  }));

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Today</h1>
        <p className="text-sm text-neutral-500">{site.name}</p>
      </div>

      <div className="mt-6">
        <TodayList items={items} fixtures={fixtures} />
      </div>
    </div>
  );
}
