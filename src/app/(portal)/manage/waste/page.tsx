import { subMonths } from 'date-fns';
import { activeSite, requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { today } from '@/lib/intake/expiry';
import { wasteByMonth, wasteByReason, type WasteRow } from '@/lib/analytics/aggregate';
import { WASTE_REASON_LABEL } from '@/lib/expiry/waste-reasons';
import { formatAud } from '@/lib/charts/tokens';
import { HorizontalBars } from '@/components/charts/bar-chart';
import { TrendChart } from '@/components/charts/trend-chart';
import { Stat } from '@/components/stat';

const WINDOW_MONTHS = 6;
const LOG_LIMIT = 50;

export default async function WastePage() {
  const session = await requireRole('manager');
  const site = activeSite(session);
  const supabase = await createClient();
  const asOf = today();
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

  const byReason = wasteByReason(rows);
  const byMonth = wasteByMonth(rows, WINDOW_MONTHS, asOf);
  const total = rows.reduce((sum, r) => sum + (r.valueAud ?? 0), 0);
  const units = rows.reduce((sum, r) => sum + r.qty, 0);
  const thisMonth = byMonth[byMonth.length - 1]?.valueAud ?? 0;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Waste</h1>
        <p className="text-sm text-neutral-500">
          {site?.name ?? 'No site'} · last {WINDOW_MONTHS} months
        </p>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="This month" value={formatAud(thisMonth)} />
        <Stat label={`Last ${WINDOW_MONTHS} months`} value={formatAud(total)} />
        <Stat label="Units written off" value={units} hint={`${rows.length} events`} />
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Waste by month
        </h2>
        <div className="mt-2 rounded border border-neutral-200 p-3">
          <TrendChart
            data={byMonth.map((m) => ({ label: m.label, value: m.valueAud }))}
            emptyNote="No waste recorded in this window. That is either very good news or nobody is recording it."
          />
        </div>
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Where it goes
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

      <section className="mt-8">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Recent write-offs
        </h2>
        <div className="mt-2 overflow-x-auto rounded border border-neutral-200">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <tr>
                <th className="px-3 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Product</th>
                <th className="px-3 py-2 font-medium">Reason</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {(events ?? []).slice(0, LOG_LIMIT).map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 whitespace-nowrap text-neutral-600">
                    {new Date(e.wasted_at).toLocaleDateString('en-AU')}
                  </td>
                  <td className="px-3 py-2">
                    {e.products?.name ?? 'Unknown'}
                    <span className="ml-2 text-xs text-neutral-500">
                      {[e.products?.brand, e.products?.size].filter(Boolean).join(' · ')}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-neutral-600">{WASTE_REASON_LABEL[e.reason]}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{e.qty}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {e.value_aud === null ? '—' : formatAud(e.value_aud)}
                  </td>
                </tr>
              ))}
              {(events ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="px-3 py-3 text-neutral-500">
                    Nothing written off in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {(events ?? []).length > LOG_LIMIT && (
          <p className="mt-2 text-xs text-neutral-500">
            Showing the most recent {LOG_LIMIT} of {(events ?? []).length}.
          </p>
        )}
      </section>
    </div>
  );
}
