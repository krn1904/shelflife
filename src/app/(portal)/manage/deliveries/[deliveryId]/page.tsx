import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, SectionTitle } from '@/components/ui';
import { Stat } from '@/components/stat';
import { atSite, deliveryTotals, lineStatus, type LineStatus } from '@/lib/deliveries/review';
import { readingFrom } from '@/lib/intake/docket/reading';

const STATUS: Record<LineStatus, { label: string; className: string }> = {
  ok: { label: 'as docketed', className: 'text-xs text-good' },
  short: { label: 'short', className: 'badge bg-warning-soft text-warning' },
  missing: { label: 'not delivered', className: 'badge bg-critical-soft text-critical' },
  over: { label: 'over', className: 'badge badge-neutral' },
};

// Long enough to look at the photo; the link is not meant to be kept.
const PHOTO_LINK_SECONDS = 15 * 60;

/**
 * One delivery as staff recorded it. The saved lines are the record: the docket reading is
 * shown as it was read, never matched against today's catalogue again, which may have
 * changed since.
 */
export default async function ManageDeliveryPage(props: PageProps<'/manage/deliveries/[deliveryId]'>) {
  const session = await requireRole('manager');
  const { deliveryId } = await props.params;
  const supabase = await createClient();

  // RLS limits this to the manager's own sites: someone else's delivery reads as not found.
  const { data: delivery } = await supabase
    .from('deliveries')
    .select('id, site_id, status, docket_number, docket_photo_path, docket_reading, received_by, received_at, created_at, closed_at, suppliers(name), sites(name, timezone)')
    .eq('id', deliveryId)
    .maybeSingle();
  if (!delivery) notFound();

  // The joined site, or the same site from the session if the join came back empty.
  const timeZone = delivery.sites?.timezone ?? session.sites.find((s) => s.id === delivery.site_id)?.timeZone ?? 'UTC';
  const [{ data: lines }, { data: receiver }, photo] = await Promise.all([
    supabase
      .from('delivery_lines')
      .select('id, qty_docketed, qty_received, products(name, brand, size, org_id, tracking_mode), stock_batches(id, expiry_date, expiry_source, qty_received)')
      .eq('delivery_id', delivery.id),
    delivery.received_by
      ? supabase.from('profiles').select('full_name').eq('id', delivery.received_by).maybeSingle()
      : Promise.resolve({ data: null }),
    delivery.docket_photo_path
      ? supabase.storage.from('dockets').createSignedUrl(delivery.docket_photo_path, PHOTO_LINK_SECONDS)
      : Promise.resolve({ data: null }),
  ]);

  const sorted = [...(lines ?? [])].sort((a, b) => (a.products?.name ?? '').localeCompare(b.products?.name ?? ''));
  const totals = deliveryTotals(sorted);
  const reading = readingFrom(delivery.docket_reading);
  const open = delivery.status === 'draft';
  const newItems = sorted.filter((l) => l.products?.org_id).length;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/manage/deliveries" className="text-sm text-muted hover:text-ink">← Deliveries</Link>
        <div className="mt-3">
          <PageHeader
            title={delivery.suppliers?.name ?? 'Unknown supplier'}
            subtitle={
              <span className="flex flex-wrap items-center gap-2">
                <span>{delivery.sites?.name}</span>
                {delivery.docket_number && <span className="font-mono">#{delivery.docket_number}</span>}
                <span className={`badge ${open ? 'bg-warning-soft text-warning' : 'badge-neutral'}`}>{open ? 'open' : 'closed'}</span>
              </span>
            }
          />
        </div>
        <p className="mt-2 text-sm text-muted">
          Received by {receiver?.full_name ?? 'someone at this site'} · started {atSite(delivery.received_at ?? delivery.created_at, timeZone)}
          {delivery.closed_at && <> · closed {atSite(delivery.closed_at, timeZone)}</>}
          {reading && <> · docket read with {reading.engine === 'textract' ? 'AWS Textract' : 'the free reader'}</>}
        </p>
      </div>

      {open ? (
        <p className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          Still being received: its lines are saved when staff close it.{' '}
          <Link href={`/app/deliveries/${delivery.id}`} className="underline">Open the intake screen</Link>
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-4">
          <Stat label="Lines" value={totals.lines} />
          <Stat label="Units received" value={totals.received} hint={`${totals.docketed} on the docket`} />
          <Stat label="Short lines" value={totals.short} tone={totals.short ? 'critical' : 'default'}
            hint={totals.unitsShort ? `${totals.unitsShort} units not delivered` : undefined} />
          <Stat label="New items" value={newItems} hint="added from this organisation's dockets" />
        </div>
      )}

      {!open && (
        <section>
          <SectionTitle>What was received</SectionTitle>
          <div className="card overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-faint">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Product</th>
                  <th className="px-4 py-2.5 text-right font-medium">Docket</th>
                  <th className="px-4 py-2.5 text-right font-medium">Received</th>
                  <th className="px-4 py-2.5 font-medium">Against the docket</th>
                  <th className="px-4 py-2.5 font-medium">Expiry</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {sorted.map((l) => {
                  const status = STATUS[lineStatus(l.qty_docketed, l.qty_received)];
                  const gap = l.qty_received - l.qty_docketed;
                  return (
                    <tr key={l.id} className="align-top">
                      <td className="px-4 py-2.5">
                        <span className="font-medium">{l.products?.name ?? 'Unknown product'}</span>
                        {l.products?.org_id && <span className="badge badge-brand ml-2">new from a docket</span>}
                        <span className="block text-xs text-muted">
                          {[l.products?.brand, l.products?.size].filter(Boolean).join(' · ')}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{l.qty_docketed}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{l.qty_received}</td>
                      <td className="px-4 py-2.5">
                        <span className={status.className}>
                          {status.label}{gap !== 0 && l.qty_received > 0 ? ` ${Math.abs(gap)}` : ''}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-xs">
                        {l.products?.tracking_mode !== 'batch' ? (
                          <span className="text-faint">{l.products?.tracking_mode === 'rotation' ? 'rotation stock' : 'not tracked'}</span>
                        ) : (l.stock_batches ?? []).length === 0 ? (
                          <span className="text-warning">{l.qty_received > 0 ? 'no date entered' : '—'}</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {(l.stock_batches ?? []).map((b) => (
                              <li key={b.id}>
                                {b.expiry_date ? atSite(`${b.expiry_date}T12:00:00Z`, timeZone, false) : '—'}
                                <span className={b.expiry_source === 'confirmed' ? 'text-good' : 'text-muted'}>
                                  {' '}· {b.expiry_source === 'confirmed' ? 'checked' : 'proposed'}
                                </span>
                                {(l.stock_batches ?? []).length > 1 && <span className="text-faint"> · {b.qty_received}</span>}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {sorted.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-6 text-center text-muted">No lines were recorded.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <SectionTitle>The docket</SectionTitle>
        {photo?.data?.signedUrl ? (
          <a href={photo.data.signedUrl} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element -- a short-lived signed URL, not an optimisable asset */}
            <img src={photo.data.signedUrl} alt="The docket photo staff took" className="max-h-[32rem] max-w-full rounded border border-line" />
          </a>
        ) : (
          <p className="text-sm text-muted">No docket photo was taken.</p>
        )}

        {reading && (
          <details className="card mt-4 p-4 text-sm">
            <summary className="cursor-pointer font-medium">What the reader found</summary>
            <p className="mt-2 text-xs text-muted">As read when the delivery was received.</p>
            {reading.table ? (
              <div className="mt-2 overflow-x-auto rounded border border-line">
                <table className="w-max min-w-full text-xs">
                  <tbody className="divide-y divide-line">
                    {reading.table.map((row, r) => (
                      <tr key={r} className={row.some((c) => c.header) ? 'bg-surface-2 font-medium' : ''}>
                        {row.map((cell, c) => (
                          <td key={c} className="border-r border-line px-2 py-1 last:border-r-0">{cell.text}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <ol className="mt-2 space-y-0.5 font-mono text-xs">
                {reading.text.map((t, i) => <li key={i}>{t}</li>)}
              </ol>
            )}
          </details>
        )}
      </section>
    </div>
  );
}
