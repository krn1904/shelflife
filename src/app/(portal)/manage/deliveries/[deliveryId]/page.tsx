import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { PageHeader, SectionTitle } from '@/components/ui';
import { Stat } from '@/components/stat';
import { atSite, deliveryTotals, lineStatus, type LineStatus } from '@/lib/deliveries/review';
import { readingFrom } from '@/lib/intake/docket/reading';
import { firstParam } from '@/lib/search-params';
import { LineEditor } from './line-editor';

const STATUS: Record<LineStatus, { label: string; className: string }> = {
  ok: { label: 'as docketed', className: 'text-xs text-good' },
  short: { label: 'short', className: 'badge bg-warning-soft text-warning' },
  missing: { label: 'not delivered', className: 'badge bg-critical-soft text-critical' },
  over: { label: 'over', className: 'badge badge-neutral' },
};

const SOURCE_LABEL: Record<'predicted' | 'confirmed' | 'manual', string> = {
  predicted: 'proposed',
  confirmed: 'checked',
  manual: 'typed in',
};

// Long enough to look at the photo; the link is not meant to be kept.
const PHOTO_LINK_SECONDS = 15 * 60;

/**
 * One delivery as staff recorded it. The saved lines are the record: the docket reading is
 * shown as it was read, never matched against today's catalogue again, which may have
 * changed since. With ?edit=1 a manager corrects the lines; what staff first entered stays
 * visible beside each correction.
 */
export default async function ManageDeliveryPage(props: PageProps<'/manage/deliveries/[deliveryId]'>) {
  const session = await requireRole('manager');
  const { deliveryId } = await props.params;
  const editing = firstParam((await props.searchParams).edit) === '1';
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
  const [{ data: lines }, photo] = await Promise.all([
    supabase
      .from('delivery_lines')
      .select(`id, qty_docketed, qty_received, staff_qty_docketed, staff_qty_received, corrected_at, corrected_by,
        products(id, name, brand, size, org_id, reviewed_at, tracking_mode),
        stock_batches(id, expiry_date, expiry_source, qty_received, qty_remaining)`)
      .eq('delivery_id', delivery.id),
    delivery.docket_photo_path
      ? supabase.storage.from('dockets').createSignedUrl(delivery.docket_photo_path, PHOTO_LINK_SECONDS)
      : Promise.resolve({ data: null }),
  ]);

  const peopleIds = [...new Set([delivery.received_by, ...(lines ?? []).map((l) => l.corrected_by)].flatMap((id) => (id ? [id] : [])))];
  const { data: people } = peopleIds.length > 0
    ? await supabase.from('profiles').select('id, full_name').in('id', peopleIds)
    : { data: [] };
  const nameOf = (id: string | null) => (people ?? []).find((p) => p.id === id)?.full_name ?? null;

  const sorted = [...(lines ?? [])].sort((a, b) => (a.products?.name ?? '').localeCompare(b.products?.name ?? ''));
  const totals = deliveryTotals(sorted);
  const reading = readingFrom(delivery.docket_reading);
  const open = delivery.status === 'draft';
  const newProducts = sorted.flatMap((l) => (l.products?.org_id ? [l.products] : []));
  const toReview = newProducts.filter((p) => !p.reviewed_at).length;
  const corrected = sorted.filter((l) => l.corrected_at).length;
  const sortedBatches = (l: (typeof sorted)[number]) =>
    [...(l.stock_batches ?? [])].sort((a, b) => (a.expiry_date ?? '').localeCompare(b.expiry_date ?? ''));

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
          Received by {nameOf(delivery.received_by) ?? 'someone at this site'} · started {atSite(delivery.received_at ?? delivery.created_at, timeZone)}
          {delivery.closed_at && <> · closed {atSite(delivery.closed_at, timeZone)}</>}
          {reading && <> · docket read with {reading.engine === 'textract' ? 'AWS Textract' : 'the free reader'}</>}
          {corrected > 0 && <> · {corrected} {corrected === 1 ? 'line' : 'lines'} corrected by a manager</>}
        </p>
      </div>

      {open ? (
        <p className="rounded-xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-warning">
          Still being received: its lines are saved when staff close it.{' '}
          <Link href={`/app/deliveries/${delivery.id}`} className="underline">Open the intake screen</Link>
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Lines" value={totals.lines} />
          <Stat label="Units received" value={totals.received} hint={`${totals.docketed} on the docket`} />
          <Stat label="Short lines" value={totals.short} tone={totals.short ? 'critical' : 'default'}
            hint={totals.unitsShort ? `${totals.unitsShort} units not delivered` : undefined} />
          <Stat label="New items" value={newProducts.length} tone={toReview ? 'critical' : 'default'}
            hint={toReview ? `${toReview} to review` : "added from this organisation's dockets"} />
        </div>
      )}

      {!open && editing && (
        <section>
          <SectionTitle actions={<Link href={`/manage/deliveries/${delivery.id}`} className="btn btn-outline btn-sm">Done</Link>}>
            Correct what was received
          </SectionTitle>
          <p className="mb-3 text-sm text-muted">
            Each line saves on its own, and its stock and expiry dates move with it. Stock already written
            off or sold cannot be taken back off the delivery.
          </p>
          <ul className="space-y-3">
            {sorted.map((l) => (
              <li key={l.id} className="card p-4">
                <div className="mb-3 flex flex-wrap items-baseline gap-2">
                  <span className="font-medium">{l.products?.name ?? 'Unknown product'}</span>
                  <span className="text-xs text-muted">{[l.products?.brand, l.products?.size].filter(Boolean).join(' · ')}</span>
                  {l.products?.org_id && (
                    <Link href={`/manage/products/${l.products.id}?site=${delivery.site_id}&from=${delivery.id}`}
                      className="badge badge-brand ml-auto">
                      {l.products.reviewed_at ? 'new from a docket' : 'review this product'}
                    </Link>
                  )}
                </div>
                {/* Remounts with the saved figures after each save. */}
                <LineEditor
                  key={`${l.id}:${l.corrected_at ?? ''}`}
                  line={{
                    id: l.id,
                    qtyDocketed: l.qty_docketed,
                    qtyReceived: l.qty_received,
                    trackingMode: l.products?.tracking_mode ?? 'none',
                    // Stock that already left the shelf keeps the line on the delivery.
                    keepsStock: (l.stock_batches ?? []).some((b) => b.qty_remaining < b.qty_received)
                      || (l.products?.tracking_mode !== 'batch' && (l.stock_batches ?? []).length > 0),
                    // A product no longer dated keeps its old batches, closed out and not editable.
                    batches: l.products?.tracking_mode !== 'batch' ? [] : sortedBatches(l).map((b) => ({
                      id: b.id,
                      expiryDate: b.expiry_date,
                      qty: b.qty_received,
                      used: b.qty_received - b.qty_remaining,
                    })),
                  }}
                />
              </li>
            ))}
            {sorted.length === 0 && <li className="card px-4 py-6 text-center text-sm text-muted">No lines were recorded.</li>}
          </ul>
        </section>
      )}

      {!open && !editing && (
        <section>
          <SectionTitle actions={sorted.length > 0 && (
            <Link href={`/manage/deliveries/${delivery.id}?edit=1`} className="btn btn-outline btn-sm">Correct this delivery</Link>
          )}>
            What was received
          </SectionTitle>
          <div className="card overflow-x-auto">
            {/* Phones keep the verdict and expiry in view; the raw counts join from `sm` up. */}
            <table className="w-full text-sm sm:min-w-[40rem]">
              <thead className="border-b border-line text-left text-xs font-semibold text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Product</th>
                  <th className="px-4 py-2.5 font-medium">Against the docket</th>
                  <th className="px-4 py-2.5 text-right font-medium max-sm:hidden">Docket</th>
                  <th className="px-4 py-2.5 text-right font-medium max-sm:hidden">Received</th>
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
                        {l.products?.org_id && (
                          <Link href={`/manage/products/${l.products.id}?site=${delivery.site_id}&from=${delivery.id}`}
                            className={`badge ml-2 ${l.products.reviewed_at ? 'badge-brand' : 'bg-warning-soft text-warning'}`}>
                            {l.products.reviewed_at ? 'new from a docket' : 'new · review'}
                          </Link>
                        )}
                        <span className="block text-xs text-muted">
                          {[l.products?.brand, l.products?.size].filter(Boolean).join(' · ')}
                        </span>
                        {l.corrected_at && (
                          <span className="block text-xs text-brand-text">
                            Corrected by {nameOf(l.corrected_by) ?? 'a manager'} {atSite(l.corrected_at, timeZone)}
                            {' '}· staff entered {l.staff_qty_received ?? l.qty_received} of {l.staff_qty_docketed ?? l.qty_docketed}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">
                        <span className={status.className}>
                          {status.label}{gap !== 0 && l.qty_received > 0 ? ` ${Math.abs(gap)}` : ''}
                        </span>
                        <span className="block font-mono text-xs text-muted sm:hidden">
                          {l.qty_received} of {l.qty_docketed}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums max-sm:hidden">{l.qty_docketed}</td>
                      <td className="px-4 py-2.5 text-right font-mono tabular-nums max-sm:hidden">{l.qty_received}</td>
                      <td className="px-4 py-2.5 text-xs">
                        {l.products?.tracking_mode !== 'batch' ? (
                          <span className="text-faint">{l.products?.tracking_mode === 'rotation' ? 'rotation stock' : 'not tracked'}</span>
                        ) : (l.stock_batches ?? []).length === 0 ? (
                          <span className="text-warning">{l.qty_received > 0 ? 'no date entered' : '—'}</span>
                        ) : (
                          <ul className="space-y-0.5">
                            {sortedBatches(l).map((b) => (
                              <li key={b.id}>
                                {b.expiry_date ? atSite(`${b.expiry_date}T12:00:00Z`, timeZone, false) : '—'}
                                <span className={b.expiry_source === 'predicted' ? 'text-muted' : 'text-good'}>
                                  {' '}· {SOURCE_LABEL[b.expiry_source]}
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
              <div className="mt-2 overflow-x-auto card">
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
