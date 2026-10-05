import Link from 'next/link';
import { format } from 'date-fns';
import { PageHeader } from '@/components/ui';
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
      <PageHeader title="Deliveries" subtitle={site?.name ?? 'No site assigned'} />

      {justClosed && (
        <p className="mt-4 alert alert-good">
          Delivery closed. Any batch-tracked lines are now on the expiry board.
        </p>
      )}

      <div className="mt-6">
        <Link href="/app/deliveries/new" className="btn btn-primary">
          Receive a delivery
        </Link>
      </div>

      {open.length > 0 && (
        <>
          <h2 className="mt-8 section-title">
            Still open
          </h2>
          <ul className="mt-2 divide-y divide-line card overflow-hidden border-warning/40">
            {open.map((d) => (
              <li key={d.id}>
                <Link href={`/app/deliveries/${d.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{d.suppliers?.name ?? 'Unknown supplier'}</span>
                    <span className="block font-mono text-xs text-muted">
                      started {d.received_at ? format(new Date(d.received_at), 'dd/MM HH:mm') : '—'}
                    </span>
                  </span>
                  <span className="badge badge-warning">Finish →</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="mt-8 section-title">Recent</h2>
      <ul className="mt-2 divide-y divide-line card overflow-hidden">
        {closed.map((d) => (
          <li key={d.id} className="flex items-center gap-3 px-4 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-semibold">{d.suppliers?.name ?? 'Unknown supplier'}</span>
              {d.docket_number && (
                <span className="block truncate font-mono text-xs text-muted">#{d.docket_number}</span>
              )}
            </span>
            <span className="font-mono text-xs text-muted">
              {d.closed_at ? format(new Date(d.closed_at), 'dd/MM/yyyy') : '—'}
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
