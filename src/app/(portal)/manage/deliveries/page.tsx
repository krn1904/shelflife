import Link from 'next/link';
import { activeSite, requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { firstParam } from '@/lib/search-params';
import { PageHeader, SectionTitle } from '@/components/ui';
import { Stat } from '@/components/stat';
import {
  atSite,
  deliveryTotals,
  openFor,
  RANGES,
  rangeStart,
  reviewFilters,
  type RangeKey,
} from '@/lib/deliveries/review';

// Enough for a busy site's quarter; the date range, not paging, is what narrows it.
const LIST_LIMIT = 300;

const RANGE_LABEL: Record<RangeKey, string> = { '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days' };

/**
 * Deliveries as staff recorded them, for the manager to check: what is still open, and what
 * arrived short of its docket. Everything a row links to is read-only here.
 */
export default async function ManageDeliveriesPage(props: PageProps<'/manage/deliveries'>) {
  const session = await requireRole('manager');
  const params = await props.searchParams;
  const site = activeSite(session, firstParam(params.site));
  const filters = reviewFilters(params);
  const supabase = await createClient();
  const now = new Date();

  if (!site) {
    return (
      <div>
        <PageHeader title="Deliveries" subtitle="No site assigned" />
      </div>
    );
  }

  let closedQuery = supabase
    .from('deliveries')
    .select('id, docket_number, closed_at, received_by, supplier_id, suppliers(name), delivery_lines(qty_docketed, qty_received)')
    .eq('site_id', site.id)
    .eq('status', 'closed')
    .gte('closed_at', rangeStart(filters.range, now))
    .order('closed_at', { ascending: false })
    .limit(LIST_LIMIT);
  if (filters.supplierId) closedQuery = closedQuery.eq('supplier_id', filters.supplierId);

  const [{ data: open }, { data: closed }, { data: suppliers }] = await Promise.all([
    supabase
      .from('deliveries')
      .select('id, received_at, created_at, received_by, suppliers(name)')
      .eq('site_id', site.id)
      .eq('status', 'draft')
      .order('created_at', { ascending: false }),
    closedQuery,
    supabase.from('suppliers').select('id, name').eq('org_id', site.orgId).order('name'),
  ]);

  const timeZone = site.timeZone;
  const receiverIds = [...new Set([...(open ?? []), ...(closed ?? [])].flatMap((d) => (d.received_by ? [d.received_by] : [])))];
  const { data: people } = receiverIds.length > 0
    ? await supabase.from('profiles').select('id, full_name').in('id', receiverIds)
    : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  const who = (id: string | null) => (id ? nameOf.get(id) ?? 'Someone at this site' : '—');

  const rows = (closed ?? []).map((d) => ({ ...d, totals: deliveryTotals(d.delivery_lines ?? []) }));
  const listed = filters.shortOnly ? rows.filter((r) => r.totals.short > 0) : rows;
  const shortDeliveries = rows.filter((r) => r.totals.short > 0).length;
  const unitsShort = rows.reduce((sum, r) => sum + r.totals.unitsShort, 0);
  const siteSites = session.sites.filter((s) => s.orgId === site.orgId);

  return (
    <div className="space-y-8">
      <PageHeader title="Deliveries" subtitle={`What staff received at ${site.name}`} />

      <form className="card flex flex-wrap items-end gap-3 p-4 text-sm" action="/manage/deliveries">
        {siteSites.length > 1 && (
          <label className="space-y-1">
            <span className="block text-xs text-muted">Site</span>
            <select name="site" defaultValue={site.id} className="field w-auto">
              {siteSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
        )}
        <label className="space-y-1">
          <span className="block text-xs text-muted">Closed</span>
          <select name="range" defaultValue={filters.range} className="field w-auto">
            {(Object.keys(RANGES) as RangeKey[]).map((r) => <option key={r} value={r}>{RANGE_LABEL[r]}</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className="block text-xs text-muted">Supplier</span>
          <select name="supplier" defaultValue={filters.supplierId ?? ''} className="field w-auto">
            <option value="">Every supplier</option>
            {(suppliers ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 pb-2">
          <input type="checkbox" name="short" value="1" defaultChecked={filters.shortOnly} />
          Only short deliveries
        </label>
        <button type="submit" className="btn btn-outline">Show</button>
      </form>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Still open" value={(open ?? []).length} tone={(open ?? []).length ? 'critical' : 'default'} hint="started, not closed" />
        <Stat label="Closed" value={rows.length} hint={RANGE_LABEL[filters.range].toLowerCase()} />
        <Stat label="Arrived short" value={shortDeliveries} tone={shortDeliveries ? 'critical' : 'default'}
          hint={`${unitsShort} ${unitsShort === 1 ? 'unit' : 'units'} not delivered`} />
      </div>

      {(open ?? []).length > 0 && (
        <section>
          <SectionTitle>Still open</SectionTitle>
          <ul className="card divide-y divide-line overflow-hidden">
            {(open ?? []).map((d) => (
              <li key={d.id}>
                <Link href={`/manage/deliveries/${d.id}`} className="flex flex-wrap items-baseline gap-3 px-4 py-3 text-sm hover:bg-surface-2">
                  <span className="font-medium">{d.suppliers?.name ?? 'Unknown supplier'}</span>
                  <span className="text-xs text-muted">started by {who(d.received_by)}</span>
                  <span className="badge bg-warning-soft text-warning ml-auto">
                    open {openFor(d.received_at ?? d.created_at, now)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <SectionTitle>Closed</SectionTitle>
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
              <tr>
                <th className="px-4 py-2.5 font-medium">Closed</th>
                <th className="px-4 py-2.5 font-medium">Supplier</th>
                <th className="px-4 py-2.5 font-medium">Received by</th>
                <th className="px-4 py-2.5 text-right font-medium">Lines</th>
                <th className="px-4 py-2.5 font-medium">Against the docket</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {listed.map((d) => (
                <tr key={d.id} className="hover:bg-surface-2">
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted">
                    <Link href={`/manage/deliveries/${d.id}`} className="hover:text-ink">{atSite(d.closed_at, timeZone)}</Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <Link href={`/manage/deliveries/${d.id}`} className="font-medium hover:underline">
                      {d.suppliers?.name ?? 'Unknown supplier'}
                    </Link>
                    {d.docket_number && <span className="ml-2 font-mono text-xs text-faint">#{d.docket_number}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{who(d.received_by)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{d.totals.lines}</td>
                  <td className="px-4 py-2.5">
                    {d.totals.short > 0 ? (
                      <span className="badge bg-warning-soft text-warning">
                        {d.totals.short} short{d.totals.missing > 0 ? ` · ${d.totals.missing} not delivered` : ''}
                      </span>
                    ) : (
                      <span className="text-xs text-good">as docketed</span>
                    )}
                  </td>
                </tr>
              ))}
              {listed.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-muted">
                    {filters.shortOnly ? 'No short deliveries in this range.' : 'Nothing closed in this range.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length === LIST_LIMIT && (
          <p className="mt-2 text-xs text-muted">Showing the latest {LIST_LIMIT}. Narrow the range or supplier to see older ones.</p>
        )}
      </section>
    </div>
  );
}
