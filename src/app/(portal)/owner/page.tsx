import Link from 'next/link';
import { subMonths } from 'date-fns';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { today } from '@/lib/intake/expiry';
import { siteLeague, wasteByMonth, type WasteRow } from '@/lib/analytics/aggregate';
import { formatAud } from '@/lib/charts/tokens';
import { HorizontalBars } from '@/components/charts/bar-chart';
import { TrendChart } from '@/components/charts/trend-chart';
import { Stat } from '@/components/stat';
import { PageHeader, SectionTitle } from '@/components/ui';

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
  const total = rows.reduce((sum, r) => sum + (r.valueAud ?? 0), 0);
  const thisMonth = byMonth[byMonth.length - 1]?.valueAud ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Group"
        subtitle={`${session.memberships[0]?.orgName} · ${sites?.length ?? 0} ${
          sites?.length === 1 ? 'site' : 'sites'
        }`}
        actions={
          <Link href="/owner/export" prefetch={false} className="btn btn-outline">
            Download CSV
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Waste this month" value={formatAud(thisMonth)} tone={thisMonth ? 'brand' : 'default'} />
        <Stat label={`Last ${WINDOW_MONTHS} months`} value={formatAud(total)} />
        <Stat label="Active batches" value={activeBatches ?? 0} hint="dated stock on shelf" />
        <Stat label="Open actions" value={openActions ?? 0} hint="across all sites" />
      </div>

      <section>
        <SectionTitle>Waste across the group</SectionTitle>
        <div className="card p-4">
          <TrendChart
            data={byMonth.map((m) => ({ label: m.label, value: m.valueAud }))}
            emptyNote="No waste recorded across any site in this window."
          />
        </div>
      </section>

      <section>
        <SectionTitle>By site</SectionTitle>
        <p className="-mt-1 mb-2 text-xs text-muted">
          Every site is listed, including those that wasted nothing — a missing site would
          read as unmeasured rather than as doing well.
        </p>
        <div className="card p-4">
          <HorizontalBars
            data={league.map((s) => ({ label: s.name, value: s.valueAud }))}
            emptyNote="No sites to compare yet."
          />
        </div>
      </section>

    </div>
  );
}
