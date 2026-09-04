import Link from 'next/link';
import { requireRole } from '@/lib/auth/session';
import { resolveSite } from '@/lib/auth/site';
import { createClient } from '@/lib/supabase/server';
import type { TrackingMode } from '@/lib/supabase/types';
import { AddProduct } from './add-product';

const MODE_LABEL: Record<TrackingMode, string> = {
  rotation: 'Rotation',
  batch: 'Date tracked',
  none: 'Untracked',
};

const MODE_HINT: Record<TrackingMode, string> = {
  rotation: 'Checked on the daily fixture list; no dates recorded at intake',
  batch: 'Expiry captured once per delivery line',
  none: 'Quantity only',
};

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ site?: string; q?: string }>;
}) {
  const session = await requireRole('manager');
  const { site: siteParam, q } = await searchParams;
  const site = resolveSite(session, siteParam);
  if (!site) return <p className="text-sm text-neutral-500">No site assigned.</p>;

  const supabase = await createClient();
  const query = supabase
    .from('site_products')
    .select('id, par_level, fixture, active, tracking_mode_override, products(id, name, brand, size, barcode, category, tracking_mode, default_shelf_life_days)')
    .eq('site_id', site.id)
    .limit(200);

  const rows = (await query).data ?? [];

  const search = (q ?? '').trim().toLowerCase();
  const visible = search
    ? rows.filter((r) =>
        [r.products?.name, r.products?.brand, r.products?.barcode]
          .some((v) => v?.toLowerCase().includes(search)))
    : rows;

  const counts = rows.reduce<Record<TrackingMode, number>>(
    (acc, r) => {
      const mode = (r.tracking_mode_override ?? r.products?.tracking_mode ?? 'batch') as TrackingMode;
      acc[mode] += 1;
      return acc;
    },
    { rotation: 0, batch: 0, none: 0 },
  );

  const trackedShare = rows.length ? Math.round((counts.batch / rows.length) * 100) : 0;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Products</h1>
        {session.sites.length > 1 && (
          <nav className="flex gap-2 text-sm">
            {session.sites.map((s) => (
              <Link
                key={s.id}
                href={`/manage/products?site=${s.id}`}
                className={s.id === site.id ? 'font-medium underline' : 'text-neutral-500 hover:text-neutral-900'}
              >
                {s.name}
              </Link>
            ))}
          </nav>
        )}
      </div>

      <p className="mt-1 text-sm text-neutral-500">
        {rows.length} ranged at {site.name} · <strong>{trackedShare}%</strong> need a date at intake
        ({counts.rotation} on the rotation list, {counts.none} untracked)
      </p>

      <AddProduct siteId={site.id} />

      <form className="mt-6" action="/manage/products">
        <input type="hidden" name="site" value={site.id} />
        <input
          name="q" defaultValue={q ?? ''} placeholder="Search name, brand or barcode"
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
      </form>

      <table className="mt-4 w-full border-collapse overflow-hidden rounded border border-neutral-200 text-sm">
        <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th className="px-3 py-2">Product</th>
            <th className="px-3 py-2">Barcode</th>
            <th className="px-3 py-2">Tracking</th>
            <th className="px-3 py-2">Shelf life</th>
            <th className="px-3 py-2">Par</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {visible.map((r) => {
            const mode = (r.tracking_mode_override ?? r.products?.tracking_mode ?? 'batch') as TrackingMode;
            return (
              <tr key={r.id} className={r.active ? '' : 'opacity-50'}>
                <td className="px-3 py-2">
                  <div>{r.products?.name}</div>
                  <div className="text-xs text-neutral-500">{r.products?.brand} {r.products?.size}</div>
                </td>
                <td className="px-3 py-2 font-mono text-xs text-neutral-500">{r.products?.barcode}</td>
                <td className="px-3 py-2">
                  <span title={MODE_HINT[mode]}>{MODE_LABEL[mode]}</span>
                  {r.tracking_mode_override && <span className="ml-1 text-xs text-neutral-400">(override)</span>}
                </td>
                <td className="px-3 py-2 tabular-nums text-neutral-500">
                  {r.products?.default_shelf_life_days ? `${r.products.default_shelf_life_days}d` : '—'}
                </td>
                <td className="px-3 py-2 tabular-nums">{r.par_level ?? '—'}</td>
              </tr>
            );
          })}
          {visible.length === 0 && (
            <tr><td colSpan={5} className="px-3 py-4 text-neutral-500">Nothing matches that search.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
