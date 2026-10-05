import { subMonths } from 'date-fns';
import { activeSite, requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { todayIn } from '@/lib/intake/expiry';
import { wasteByMonth, type WasteRow } from '@/lib/analytics/aggregate';
import { WASTE_REASON_LABEL } from '@/lib/expiry/waste-reasons';
import { formatAud } from '@/lib/charts/tokens';
import { TrendChart } from '@/components/charts/trend-chart';
import { Stat } from '@/components/stat';
import { firstParam } from '@/lib/search-params';

const WINDOW_MONTHS = 6;
const LOG_LIMIT = 50;

export default async function WastePage(props: PageProps<'/manage/waste'>) {
  const session = await requireRole('manager');
  const params = await props.searchParams;
  const site = activeSite(session, firstParam(params.site));
  const supabase = await createClient();
  // The site's calendar; with no site there is nothing to count, so any zone will do.
  const asOf = todayIn(site?.timeZone ?? 'UTC');
  const since = subMonths(new Date(asOf), WINDOW_MONTHS - 1).toISOString();

  const { data: events } = site
    ? await supabase
        .from('waste_events')
        .select('id, wasted_at, reason, qty, value_aud, site_id, note, products(name, brand, size)')
        .eq('site_id', site.id)
        .gte('wasted_at', since)
        .order('wasted_at', { ascending: false })
    : { data: [] };

  const rows: WasteRow[] = (events ?? []).map((e) => ({
    wastedAt: e.wasted_at,
    reason: e.reason,
    qty: e.qty,
    valueAud: e.value_aud,
    siteId: e.site_id,
  }));

  const byMonth = wasteByMonth(rows, WINDOW_MONTHS, asOf);
  const total = rows.reduce((sum, r) => sum + (r.valueAud ?? 0), 0);
  const units = rows.reduce((sum, r) => sum + r.qty, 0);
  const thisMonth = byMonth[byMonth.length - 1]?.valueAud ?? 0;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[1.875rem] font-bold leading-tight tracking-tight sm:text-[2rem]">Waste</h1>
        <p className="text-sm text-muted">
          {site?.name ?? 'No site'} · last {WINDOW_MONTHS} months
        </p>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="This month" value={formatAud(thisMonth)} />
        <Stat label={`Last ${WINDOW_MONTHS} months`} value={formatAud(total)} />
        <Stat label="Units written off" value={units} hint={`${rows.length} events`} />
      </div>

      <section className="mt-8">
        <h2 className="section-title">
          Waste by month
        </h2>
        <div className="mt-2 card p-3">
          <TrendChart
            data={byMonth.map((m) => ({ label: m.label, value: m.valueAud }))}
            emptyNote="No waste recorded in this window. That is either very good news or nobody is recording it."
          />
        </div>
      </section>


      <section className="mt-8">
        <h2 className="section-title">
          Recent write-offs
        </h2>
        <div className="mt-2 overflow-x-auto card">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="border-b border-line text-left text-xs font-semibold text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {(events ?? []).slice(0, LOG_LIMIT).map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 whitespace-nowrap text-muted">
                    {new Date(e.wasted_at).toLocaleDateString('en-AU')}
                  </td>
                  <td className="px-3 py-2">
                    {e.products?.name ?? 'Unknown'}
                    <span className="ml-2 text-xs text-muted">
                      {[e.products?.brand, e.products?.size].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted">{WASTE_REASON_LABEL[e.reason]}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{e.qty}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {e.value_aud === null ? '—' : formatAud(e.value_aud)}
                  </td>
                </tr>
              ))}
              {(events ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-muted">
                    Nothing written off in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {(events ?? []).length > LOG_LIMIT && (
          <p className="mt-2 text-xs text-muted">
            Showing the most recent {LOG_LIMIT} of {(events ?? []).length}.
          </p>
        )}
      </section>
    </div>
  );
}
