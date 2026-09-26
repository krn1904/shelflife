import Link from 'next/link';
import { activeSite, requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { firstParam } from '@/lib/search-params';

const RECENT_LIMIT = 20;

export default async function DeliveriesPage(props: PageProps<'/app/deliveries'>) {
  const session = await requireSession();
  const params = await props.searchParams;
  const site = activeSite(session, firstParam(params.site));
  const justClosed = firstParam(params.closed);
  const supabase = await createClient();

  const { data: deliveries } = site
    ? await supabase
        .from('deliveries')
        .select('id, docket_number, status, received_at, closed_at, suppliers(name)')
        .eq('site_id', site.id)
        .order('received_at', { ascending: false })
        .limit(RECENT_LIMIT)
    : { data: [] };

  const open = (deliveries ?? []).filter((d) => d.status === 'draft');
  const closed = (deliveries ?? []).filter((d) => d.status === 'closed');

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Deliveries</h1>
        <p className="text-sm text-neutral-500">{site?.name ?? 'No site assigned'}</p>
      </div>

      {justClosed && (
        <p className="mt-4 rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          Delivery closed. Any batch-tracked lines are now on the expiry board.
        </p>
      )}

      <Link
        href="/app/deliveries/new"
        className="mt-6 inline-block rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
      >
        Receive a delivery
      </Link>
      <Link href="/app/deliveries/docket-test" className="ml-3 text-sm text-neutral-500 underline">
        Test docket OCR
      </Link>

      {open.length > 0 && (
        <>
          <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">
            Still open
          </h2>
          <ul className="mt-2 divide-y divide-neutral-200 rounded border border-amber-300">
            {open.map((d) => (
              <li key={d.id}>
                <Link href={`/app/deliveries/${d.id}`} className="flex items-baseline gap-3 px-4 py-3 hover:bg-amber-50">
                  <span className="text-sm font-medium">{d.suppliers?.name ?? 'Unknown supplier'}</span>
                  <span className="text-xs text-neutral-500">
                    started {d.received_at ? new Date(d.received_at).toLocaleString('en-AU') : '—'}
                  </span>
                  <span className="ml-auto text-xs font-medium text-amber-700">Finish</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">Recent</h2>
      <ul className="mt-2 divide-y divide-neutral-200 rounded border border-neutral-200">
        {closed.map((d) => (
          <li key={d.id} className="flex flex-wrap items-baseline gap-3 px-4 py-3">
            <span className="text-sm font-medium">{d.suppliers?.name ?? 'Unknown supplier'}</span>
            {d.docket_number && (
              <span className="font-mono text-xs text-neutral-500">#{d.docket_number}</span>
            )}
            <span className="ml-auto text-xs text-neutral-500">
              {d.closed_at ? new Date(d.closed_at).toLocaleDateString('en-AU') : '—'}
            </span>
          </li>
        ))}
        {closed.length === 0 && (
          <li className="px-4 py-3 text-sm text-neutral-500">
            No deliveries received yet. The first one from a supplier is typed in by hand;
            after that the app pre-fills the lines from what they sent before.
          </li>
        )}
      </ul>
    </div>
  );
}
