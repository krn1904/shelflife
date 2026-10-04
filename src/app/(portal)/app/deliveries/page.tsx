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
        <h1 className="text-[1.875rem] font-bold leading-tight tracking-tight sm:text-[2rem]">Deliveries</h1>
        <p className="text-sm text-muted">{site?.name ?? 'No site assigned'}</p>
      </div>

      {justClosed && (
        <p className="mt-4 alert alert-good">
          Delivery closed. Any batch-tracked lines are now on the expiry board.
        </p>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link href="/app/deliveries/new" className="btn btn-primary">
          Receive a delivery
        </Link>
        <Link href="/app/deliveries/docket-test" className="btn btn-ghost">
          Test docket OCR
        </Link>
      </div>

      {open.length > 0 && (
        <>
          <h2 className="mt-8 section-title">
            Still open
          </h2>
          <ul className="mt-2 divide-y divide-line card border-warning/40">
            {open.map((d) => (
              <li key={d.id}>
                <Link href={`/app/deliveries/${d.id}`} className="flex items-baseline gap-3 px-4 py-3 hover:bg-warning-soft">
                  <span className="text-sm font-medium">{d.suppliers?.name ?? 'Unknown supplier'}</span>
                  <span className="text-xs text-muted">
                    started {d.received_at ? new Date(d.received_at).toLocaleString('en-AU') : '—'}
                  </span>
                  <span className="ml-auto text-xs font-medium text-warning">Finish</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-8 section-title">Recent</h2>
      <ul className="mt-2 divide-y divide-line card">
        {closed.map((d) => (
          <li key={d.id} className="flex flex-wrap items-baseline gap-3 px-4 py-3">
            <span className="text-sm font-medium">{d.suppliers?.name ?? 'Unknown supplier'}</span>
            {d.docket_number && (
              <span className="font-mono text-xs text-muted">#{d.docket_number}</span>
            )}
            <span className="ml-auto text-xs text-muted">
              {d.closed_at ? new Date(d.closed_at).toLocaleDateString('en-AU') : '—'}
            </span>
          </li>
        ))}
        {closed.length === 0 && (
          <li className="px-4 py-3 text-sm text-muted">
            No deliveries received yet. The first one from a supplier is typed in by hand;
            after that the app pre-fills the lines from what they sent before.
          </li>
        )}
      </ul>
    </div>
  );
}
