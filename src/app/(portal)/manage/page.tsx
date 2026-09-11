import Link from 'next/link';
import { differenceInCalendarDays, parseISO, subMonths } from 'date-fns';
import { activeSite, requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { today } from '@/lib/intake/expiry';
import { bucketFor } from '@/lib/analytics/aggregate';
import { formatAud } from '@/lib/charts/tokens';
import { Stat } from '@/components/stat';

const ACTIVITY_LIMIT = 8;

export default async function ManagePage() {
  const session = await requireRole('manager');
  const site = activeSite(session);
  if (!site) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Store</h1>
        <p className="mt-2 text-sm text-neutral-500">You are not assigned to a store yet.</p>
      </div>
    );
  }

  const supabase = await createClient();
  const asOf = today();
  const monthStart = subMonths(new Date(asOf), 1).toISOString();

  const [{ count: ranged }, { data: batches }, { data: waste }, { count: openDeliveries }, { data: recent }] =
    await Promise.all([
      supabase.from('site_products').select('*', { count: 'exact', head: true }).eq('site_id', site.id),
      supabase
        .from('stock_batches')
        .select('expiry_date')
        .eq('site_id', site.id)
        .eq('status', 'active')
        .gt('qty_remaining', 0)
        .not('expiry_date', 'is', null),
      supabase.from('waste_events').select('value_aud').eq('site_id', site.id).gte('wasted_at', monthStart),
      supabase.from('deliveries').select('*', { count: 'exact', head: true }).eq('site_id', site.id).eq('status', 'draft'),
      supabase
        .from('deliveries')
        .select('id, closed_at, docket_number, suppliers(name)')
        .eq('site_id', site.id)
        .eq('status', 'closed')
        .order('closed_at', { ascending: false })
        .limit(ACTIVITY_LIMIT),
    ]);

  const urgent = (batches ?? []).filter((b) => {
    if (!b.expiry_date) return false;
    const bucket = bucketFor(differenceInCalendarDays(parseISO(b.expiry_date), parseISO(asOf)));
    return bucket === 'overdue' || bucket === 'today' || bucket === 'soon';
  }).length;

  const wasteThisMonth = (waste ?? []).reduce((sum, w) => sum + (w.value_aud ?? 0), 0);

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Store</h1>
        <p className="text-sm text-neutral-500">{site.name}</p>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Needs attention" value={urgent} hint="expiring within 7 days" />
        <Stat label="Waste (30 days)" value={formatAud(wasteThisMonth)} />
        <Stat label="Open deliveries" value={openDeliveries ?? 0} />
        <Stat label="Ranged products" value={ranged ?? 0} />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/manage/expiry"
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Expiry board
        </Link>
        <Link
          href="/manage/waste"
          className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium"
        >
          Waste
        </Link>
        <Link
          href="/manage/products"
          className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium"
        >
          Products &amp; ranging
        </Link>
      </div>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">
        Recent deliveries
      </h2>
      <ul className="mt-2 divide-y divide-neutral-200 rounded border border-neutral-200">
        {(recent ?? []).map((d) => (
          <li key={d.id} className="flex flex-wrap items-baseline gap-3 px-4 py-2 text-sm">
            <span className="font-medium">{d.suppliers?.name ?? 'Unknown supplier'}</span>
            {d.docket_number && (
              <span className="font-mono text-xs text-neutral-500">#{d.docket_number}</span>
            )}
            <span className="ml-auto text-xs text-neutral-500">
              {d.closed_at ? new Date(d.closed_at).toLocaleDateString('en-AU') : '—'}
            </span>
          </li>
        ))}
        {(recent ?? []).length === 0 && (
          <li className="px-4 py-2 text-sm text-neutral-500">Nothing received yet.</li>
        )}
      </ul>
    </div>
  );
}
