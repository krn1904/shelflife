import Link from 'next/link';
import { subMonths } from 'date-fns';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { today } from '@/lib/intake/expiry';
import { siteLeague, wasteByMonth, wasteByReason, type WasteRow } from '@/lib/analytics/aggregate';
import { WASTE_REASON_LABEL } from '@/lib/expiry/waste-reasons';
import { formatAud } from '@/lib/charts/tokens';
import { HorizontalBars } from '@/components/charts/bar-chart';
import { TrendChart } from '@/components/charts/trend-chart';
import { Stat } from '@/components/stat';

const WINDOW_MONTHS = 6;

export default async function OwnerPage() {
  const session = await requireRole('owner');
  const supabase = await createClient();
  const asOf = today();
  const since = subMonths(new Date(asOf), WINDOW_MONTHS - 1).toISOString();

  // RLS scopes every one of these to the sites this owner can see, so there is no
  // explicit site filter — an owner with a null site_id gets their whole org.
  const [{ data: events }, { data: sites }, { count: activeBatches }, { count: openActions }] =
    await Promise.all([
      supabase
        .from('waste_events')
        .select('wasted_at, reason, qty, value_aud, site_id')
        .gte('wasted_at', since),
      supabase.from('sites').select('id, name').order('name'),
      supabase.from('stock_batches').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      supabase.from('expiry_actions').select('*', { count: 'exact', head: true }).eq('state', 'open'),
    ]);

  const rows: WasteRow[] = (events ?? []).map((e) => ({
    wastedAt: e.wasted_at,
    reason: e.reason,
    qty: e.qty,
    valueAud: e.value_aud,
    siteId: e.site_id,
  }));

  const league = siteLeague(sites ?? [], rows);
  const byMonth = wasteByMonth(rows, WINDOW_MONTHS, asOf);
  const byReason = wasteByReason(rows);
  const total = rows.reduce((sum, r) => sum + (r.valueAud ?? 0), 0);
  const thisMonth = byMonth[byMonth.length - 1]?.valueAud ?? 0;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Group</h1>
        <p className="text-sm text-neutral-500">
          {session.memberships[0]?.orgName} · {sites?.length ?? 0}{' '}
          {sites?.length === 1 ? 'site' : 'sites'}
        </p>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-4">
        <Stat label="Waste this month" value={formatAud(thisMonth)} />
        <Stat label={`Last ${WINDOW_MONTHS} months`} value={formatAud(total)} />
        <Stat label="Active batches" value={activeBatches ?? 0} hint="dated stock on shelf" />
        <Stat label="Open actions" value={openActions ?? 0} hint="across all sites" />
      </div>

      <section className="mt-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
            Waste across the group
          </h2>
          <Link href="/owner/export" prefetch={false} className="text-sm underline">
            Download CSV
          </Link>
        </div>
        <div className="mt-2 rounded border border-neutral-200 p-3">
          <TrendChart
            data={byMonth.map((m) => ({ label: m.label, value: m.valueAud }))}
            emptyNote="No waste recorded across any site in this window."
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          By site
        </h2>
        <p className="mt-1 text-xs text-neutral-500">
          Every site is listed, including those that wasted nothing — a missing site would
          read as unmeasured rather than as doing well.
        </p>
        <div className="mt-2 rounded border border-neutral-200 p-3">
          <HorizontalBars
            data={league.map((s) => ({ label: s.name, value: s.valueAud }))}
            emptyNote="No sites to compare yet."
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          By reason
        </h2>
        <div className="mt-2 rounded border border-neutral-200 p-3">
          <HorizontalBars
            data={byReason.map((r) => ({
              label: WASTE_REASON_LABEL[r.reason],
              value: r.valueAud,
            }))}
            emptyNote="Nothing written off yet."
          />
        </div>
      </section>
    </div>
  );
}
