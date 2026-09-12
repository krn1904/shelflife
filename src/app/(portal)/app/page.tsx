import Link from 'next/link';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { activeSite, requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { today } from '@/lib/intake/expiry';
import { Stat } from '@/components/stat';
import { DemoJump } from '@/components/demo-jump';
import { demoEnabled } from '@/lib/demo/actions';

export default async function ShiftPage() {
  const session = await requireSession();
  const site = activeSite(session);
  const supabase = await createClient();
  const asOf = today();

  const [{ count: catalogue }, { data: sites }, { count: openDeliveries }, { count: openActions }, { data: expiring }] =
    await Promise.all([
      supabase.from('site_products').select('*', { count: 'exact', head: true }),
      supabase.from('sites').select('name'),
      supabase.from('deliveries').select('*', { count: 'exact', head: true }).eq('status', 'draft'),
      supabase.from('expiry_actions').select('*', { count: 'exact', head: true }).eq('state', 'open'),
      site
        ? supabase
            .from('stock_batches')
            .select('id, expiry_date, qty_remaining, products(name, brand, size)')
            .eq('site_id', site.id)
            .eq('status', 'active')
            .gt('qty_remaining', 0)
            .not('expiry_date', 'is', null)
            .lte('expiry_date', new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))
            .order('expiry_date')
            .limit(10)
        : Promise.resolve({ data: [] as never[] }),
    ]);

  const expiryItems = (expiring ?? [])
    .filter((b): b is typeof b & { expiry_date: string } => !!b.expiry_date)
    .map((b) => ({
      id: b.id,
      name: b.products?.name ?? 'Unknown product',
      detail: [b.products?.brand, b.products?.size].filter(Boolean).join(' · '),
      qty: b.qty_remaining,
      expiryDate: b.expiry_date,
      daysLeft: differenceInCalendarDays(parseISO(b.expiry_date), parseISO(asOf)),
    }));

  return (
    <div>
      <h1 className="text-xl font-semibold">Shift</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {session.fullName ?? session.email} · {sites?.map((s) => s.name).join(', ') || 'no site assigned'}
      </p>

      {(await demoEnabled()) && (
        <div className="mt-6">
          <DemoJump />
        </div>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Ranged products" value={catalogue ?? 0} hint="active at your site" />
        <Stat label="To action today" value={openActions ?? 0} hint="dated stock needing a decision" />
        <Stat label="Open deliveries" value={openDeliveries ?? 0} hint="started but not closed" />
      </div>

      {expiryItems.length > 0 && (
        <section className="mt-6 rounded border border-amber-200 bg-amber-50 p-4">
          <h2 className="text-sm font-semibold text-amber-900">Expiring soon</h2>
          <ul className="mt-2 divide-y divide-amber-200">
            {expiryItems.map((item) => (
              <li key={item.id} className="flex items-baseline justify-between gap-4 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-amber-900">{item.name}</p>
                  {item.detail && (
                    <p className="text-xs text-amber-700">{item.detail}</p>
                  )}
                </div>
                <p className="shrink-0 text-xs tabular-nums text-amber-800">
                  {item.daysLeft < 0
                    ? `${Math.abs(item.daysLeft)}d overdue`
                    : item.daysLeft === 0
                      ? 'Today'
                      : `${item.daysLeft}d left`}
                  {' · '}qty {item.qty}
                </p>
              </li>
            ))}
          </ul>
          <Link href="/manage/expiry" className="mt-2 inline-block text-xs font-medium text-amber-800 underline">
            View full expiry board
          </Link>
        </section>
      )}

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/app/today"
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Today’s list
        </Link>
        <Link
          href="/app/deliveries"
          className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium"
        >
          Receive a delivery
        </Link>
        <Link
          href="/app/waste"
          className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium"
        >
          Scan to waste
        </Link>
        <Link
          href="/app/scan"
          className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium"
        >
          Look up a product
        </Link>
        <Link
          href="/app/settings"
          className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium"
        >
          Notifications
        </Link>
      </div>
    </div>
  );
}
