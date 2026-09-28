'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import {
  closeDelivery,
  searchProductsForIntake,
  type DocketIntakeLine,
  type DocketVerdict,
  type IntakeState,
  type UnmatchedRow,
} from '@/lib/intake/actions';
import { BASIS_NOTE, type ExpiryBasis } from '@/lib/intake/expiry';
import { DocketPhoto } from './docket-photo';
import type { TrackingMode } from '@/lib/supabase/types';

export type SuggestedLine = {
  productId: string;
  name: string;
  brand: string | null;
  size: string | null;
  trackingMode: TrackingMode;
  qtyDocketed: number;
  seenInDeliveries: number;
  proposal: { date: string | null; basis: ExpiryBasis };
};

/** The docket as read, when this delivery was started from one. */
export type DocketView = {
  engine: 'textract' | 'tesseract';
  lines: DocketIntakeLine[];
  unmatched: UnmatchedRow[];
  verdicts: DocketVerdict[];
};

type Product = Pick<SuggestedLine, 'productId' | 'name' | 'brand' | 'size' | 'trackingMode' | 'proposal'>;

type DraftLine = Product & {
  ticked: boolean;
  qty: number;
  expiry: string | null;
  confirmed: boolean;
  /** What the docket said arrived; null when no docket was read. */
  docketed: number | null;
  fromDocket: boolean;
  docketText: string | null;
  unsure: boolean;
};

function describe(line: { brand: string | null; size: string | null }) {
  return [line.brand, line.size].filter(Boolean).join(' · ');
}

function draft(product: Product, extra: Partial<DraftLine> = {}): DraftLine {
  return {
    ...product,
    ticked: true,
    qty: 1,
    expiry: product.proposal.date,
    confirmed: false,
    docketed: null,
    fromDocket: false,
    docketText: null,
    unsure: false,
    ...extra,
  };
}

/**
 * Working down the docket, not around the store.
 *
 * Everything is local state until "Close delivery" — a store room has patchy signal, and
 * a per-keystroke save would spend the whole minute this flow is allowed. When the docket
 * was read, the list is what it says arrived; otherwise it is predicted from this
 * supplier's last deliveries. Either way the operator ticks, counts and dates.
 */
export function IntakeClient({
  deliveryId,
  orgId,
  siteId,
  supplierName,
  docketPhotoPath,
  suggested,
  historyNote,
  docket,
}: {
  deliveryId: string;
  orgId: string;
  siteId: string;
  supplierName: string;
  docketPhotoPath: string | null;
  suggested: SuggestedLine[];
  historyNote: string;
  docket: DocketView | null;
}) {
  const [lines, setLines] = useState<DraftLine[]>(() =>
    docket
      ? docket.lines.map((l) => draft(l, {
          qty: l.qtyReceived,
          docketed: l.qtyDocketed,
          fromDocket: true,
          docketText: l.docketText,
          unsure: l.unsure,
        }))
      : suggested.map((s) => draft(s, { qty: s.qtyDocketed })),
  );
  const [unmatched, setUnmatched] = useState<UnmatchedRow[]>(docket?.unmatched ?? []);
  const [attaching, setAttaching] = useState<UnmatchedRow | null>(null);
  const [docketNumber, setDocketNumber] = useState('');
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<SuggestedLine[]>([]);
  const [searching, startSearch] = useTransition();
  const [state, formAction, closing] = useActionState<IntakeState, FormData>(closeDelivery, {
    status: 'idle',
  });

  // An unticked docket line still goes in, as 0 received: that is the short-delivery record.
  const recorded = lines.filter((l) => (l.ticked && l.qty > 0) || (l.fromDocket && (l.docketed ?? 0) > 0));
  const received = recorded.filter((l) => l.ticked && l.qty > 0);
  const undated = received.filter((l) => l.trackingMode === 'batch' && !l.expiry);
  const short = recorded.filter((l) => l.docketed !== null && (l.ticked ? l.qty : 0) < l.docketed);

  const payload = useMemo(
    () =>
      JSON.stringify(
        recorded.map((l) => ({
          product_id: l.productId,
          qty_received: l.ticked ? l.qty : 0,
          qty_docketed: docket ? l.docketed ?? 0 : null,
          expiry_date: l.trackingMode === 'batch' && l.ticked ? l.expiry : null,
          confirmed: l.confirmed,
        })),
      ),
    [recorded, docket],
  );

  function update(productId: string, patch: Partial<DraftLine>) {
    setLines((prev) => prev.map((l) => (l.productId === productId ? { ...l, ...patch } : l)));
  }

  function runSearch(next: string) {
    setTerm(next);
    startSearch(async () => {
      const { products } = await searchProductsForIntake(deliveryId, next);
      setResults(
        products.map((p) => ({
          productId: p.productId,
          name: p.name,
          brand: p.brand,
          size: p.size,
          trackingMode: p.trackingMode,
          qtyDocketed: 1,
          seenInDeliveries: 0,
          proposal: p.proposal,
        })),
      );
    });
  }

  /** Adds a product by hand, or as the product an unmatched docket row turned out to be. */
  function addLine(product: SuggestedLine) {
    const row = attaching;
    const existing = lines.find((l) => l.productId === product.productId);
    if (existing) {
      // Already on the list: the docket row's quantity joins it rather than a second line.
      if (row) {
        update(product.productId, {
          qty: existing.qty + (row.qty ?? 0),
          docketed: (existing.docketed ?? 0) + (row.qty ?? 0),
          fromDocket: true,
          ticked: true,
        });
      }
    } else {
      setLines((prev) => [
        ...prev,
        draft(product, row
          ? { qty: row.qty ?? 0, docketed: row.qty ?? 0, fromDocket: true, docketText: row.text, unsure: row.qty === null }
          : { qty: 1, docketed: docket ? 0 : null }),
      ]);
    }
    if (row) setUnmatched((all) => all.filter((r) => r.key !== row.key));
    setAttaching(null);
    setTerm('');
    setResults([]);
  }

  /** A docket line matched to the wrong product goes back to be matched by hand. */
  function unmatch(line: DraftLine) {
    setLines((prev) => prev.filter((l) => l.productId !== line.productId));
    setUnmatched((all) => [
      ...all,
      { key: `line-${line.productId}`, text: line.docketText ?? line.name, qty: line.docketed },
    ]);
  }

  function attach(row: UnmatchedRow) {
    setAttaching(row);
    // Start the search from the row's words, without its codes and numbers.
    runSearch(row.text.replace(/[^a-z\s]/gi, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 3).join(' '));
  }

  /** Copies the date from the nearest batch line above — sibling sizes often match. */
  function copyPrevious(index: number) {
    const above = lines.slice(0, index).reverse().find((l) => l.trackingMode === 'batch' && l.expiry);
    if (above?.expiry) update(lines[index].productId, { expiry: above.expiry, confirmed: true });
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="section-title">1 · The docket</h2>
        {docket ? (
          <p className="mt-1 text-sm text-muted">
            Read with {docket.engine === 'textract' ? 'AWS Textract' : 'the free reader'}. Check each line against the
            paper docket: amber counts are ones the reader was unsure of.
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted">
            Photograph it first. It is the evidence for any dispute, and what invoice
            reconciliation will read later.
          </p>
        )}
        <div className="mt-3">
          <DocketPhoto
            deliveryId={deliveryId}
            orgId={orgId}
            siteId={siteId}
            existingPath={docketPhotoPath}
          />
        </div>
        <label htmlFor="docket_number" className="mt-4 block text-sm font-medium">
          Docket number <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="docket_number"
          value={docketNumber}
          onChange={(e) => setDocketNumber(e.target.value)}
          className="field mt-1 sm:max-w-64"
        />
      </section>

      <section>
        <h2 className="section-title">2 · What came</h2>
        <p className="mt-1 text-sm text-muted">
          {docket
            ? 'Each line is a product on the docket. Untick anything that did not arrive, and correct the count where it differs.'
            : historyNote}
        </p>

        <ul className="card mt-3 divide-y divide-line overflow-hidden">
          {lines.map((line, index) => {
            const got = line.ticked ? line.qty : 0;
            const gap = line.docketed === null ? 0 : got - line.docketed;
            return (
              <li key={line.productId} className={line.ticked ? '' : 'bg-surface-2 opacity-70'}>
                <div className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={line.ticked}
                    onChange={(e) => update(line.productId, { ticked: e.target.checked })}
                    aria-label={`Received ${line.name}`}
                    className="size-5"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{line.name}</span>
                    <span className="block text-xs text-muted">{describe(line)}</span>
                    {line.docketText && (
                      <span className="flex items-baseline gap-2 text-xs">
                        <span className="min-w-0 truncate font-mono text-faint" title={line.docketText}>
                          Docket: {line.docketText}
                        </span>
                        <button type="button" onClick={() => unmatch(line)} className="shrink-0 text-muted underline">
                          Wrong product?
                        </button>
                      </span>
                    )}
                  </span>

                  {line.docketed !== null && (
                    <span className="flex flex-col items-end gap-1 text-xs">
                      <span className="text-muted">docket {line.docketed}</span>
                      {gap < 0 && <span className="badge bg-warning-soft text-warning">short {-gap}</span>}
                      {gap > 0 && <span className="badge badge-neutral">over {gap}</span>}
                    </span>
                  )}

                  <span className={`flex items-center gap-1 rounded ${line.unsure && line.ticked ? 'bg-warning-soft p-1' : ''}`}>
                    <button
                      type="button"
                      onClick={() => update(line.productId, { qty: Math.max(0, line.qty - 1), unsure: false })}
                      className="btn btn-outline size-8 p-0 text-lg leading-none"
                      aria-label={`One fewer ${line.name}`}
                      disabled={!line.ticked}
                    >
                      −
                    </button>
                    <input
                      value={line.qty}
                      onChange={(e) =>
                        update(line.productId, { qty: Math.max(0, Number(e.target.value) || 0), unsure: false })
                      }
                      inputMode="numeric"
                      aria-label={`Quantity of ${line.name}`}
                      disabled={!line.ticked}
                      className="field w-14 px-2 py-1 text-center tabular-nums"
                    />
                    <button
                      type="button"
                      onClick={() => update(line.productId, { qty: line.qty + 1, unsure: false })}
                      className="btn btn-outline size-8 p-0 text-lg leading-none"
                      aria-label={`One more ${line.name}`}
                      disabled={!line.ticked}
                    >
                      +
                    </button>
                  </span>
                </div>

                {line.ticked && line.unsure && (
                  <p className="border-t border-line px-4 py-1.5 pl-12 text-xs text-warning">
                    The reader was not sure of this count. Check it against the docket.
                  </p>
                )}
                {!line.ticked && line.fromDocket && (
                  <p className="border-t border-line px-4 py-1.5 pl-12 text-xs text-muted">
                    Recorded as not delivered.
                  </p>
                )}

                {line.ticked && line.trackingMode === 'batch' && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2 pl-12">
                    <input
                      type="date"
                      value={line.expiry ?? ''}
                      onChange={(e) =>
                        update(line.productId, { expiry: e.target.value || null, confirmed: true })
                      }
                      aria-label={`Expiry for ${line.name}`}
                      className="field w-auto px-2 py-1"
                    />
                    {line.confirmed ? (
                      <span className="text-xs font-medium text-good">Confirmed</span>
                    ) : (
                      <>
                        <span className="text-xs text-muted">
                          {BASIS_NOTE[line.proposal.basis]}
                        </span>
                        {line.expiry && (
                          <button
                            type="button"
                            onClick={() => update(line.productId, { confirmed: true })}
                            className="btn btn-outline px-2 py-1 text-xs"
                          >
                            Looks right
                          </button>
                        )}
                      </>
                    )}
                    {index > 0 && (
                      <button
                        type="button"
                        onClick={() => copyPrevious(index)}
                        className="text-xs text-muted underline"
                      >
                        Same as previous line
                      </button>
                    )}
                  </div>
                )}

                {line.ticked && line.trackingMode !== 'batch' && (
                  <p className="border-t border-line px-4 py-2 pl-12 text-xs text-muted">
                    {line.trackingMode === 'rotation'
                      ? 'Rotation stock — checked on the daily fixture list, no date needed.'
                      : 'Not expiry-tracked — quantity only.'}
                  </p>
                )}
              </li>
            );
          })}

          {lines.length === 0 && (
            <li className="px-4 py-3 text-sm text-muted">
              {docket
                ? 'No catalogue products were recognised on the docket. Match its rows below, or add the lines by hand.'
                : 'Nothing pre-filled. Add the lines from the docket below.'}
            </li>
          )}
        </ul>
      </section>

      {unmatched.length > 0 && (
        <section>
          <h2 className="section-title">On the docket, not matched to a product</h2>
          <p className="mt-1 text-sm text-muted">
            Find the product each row is, or leave it out if it is not stock (a crate, a deposit, a note).
          </p>
          <ul className="card mt-3 divide-y divide-line overflow-hidden">
            {unmatched.map((row) => (
              <li key={row.key} className={`flex flex-wrap items-center gap-3 px-4 py-2.5 ${attaching?.key === row.key ? 'bg-brand-soft' : ''}`}>
                <span className="min-w-0 flex-1 font-mono text-xs">{row.text}</span>
                <span className="text-xs text-muted">qty {row.qty ?? '?'}</span>
                <button type="button" className="btn btn-outline px-2 py-1 text-xs" onClick={() => attach(row)}>
                  Find product
                </button>
                <button type="button" className="btn btn-ghost px-2 py-1 text-xs"
                  onClick={() => { setUnmatched((all) => all.filter((r) => r.key !== row.key)); if (attaching?.key === row.key) setAttaching(null); }}>
                  Leave out
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="section-title">
          {attaching ? 'Which product is this row?' : docket ? '3 · Anything the reader missed' : '3 · Anything else on the docket'}
        </h2>
        {attaching && (
          <p className="mt-1 font-mono text-xs text-muted">
            {attaching.text}{' '}
            <button type="button" className="ml-2 font-sans underline" onClick={() => { setAttaching(null); setTerm(''); setResults([]); }}>
              cancel
            </button>
          </p>
        )}
        <input
          value={term}
          onChange={(e) => runSearch(e.target.value)}
          placeholder="Search the catalogue"
          aria-label="Search for a product to add"
          className="field mt-2"
        />
        {searching && <p className="mt-2 text-xs text-muted">Searching…</p>}
        {results.length > 0 && (
          <ul className="card mt-2 divide-y divide-line overflow-hidden">
            {results.map((r) => (
              <li key={r.productId}>
                <button
                  type="button"
                  onClick={() => addLine(r)}
                  className="flex w-full items-baseline gap-3 px-4 py-2 text-left hover:bg-surface-2"
                >
                  <span className="text-sm">{r.name}</span>
                  <span className="text-xs text-muted">{describe(r)}</span>
                  <span className="ml-auto text-xs text-muted">{attaching ? 'This one' : 'Add'}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {docket && docket.verdicts.length > 0 && (
        <details className="card p-4 text-sm">
          <summary className="cursor-pointer font-medium">What the docket said</summary>
          <p className="mt-2 text-xs text-muted">Every row the reader found, and what was done with it.</p>
          <ol className="mt-2 divide-y divide-line font-mono text-xs">
            {docket.verdicts.map((v, i) => (
              <li key={i} className={`flex gap-3 py-1.5 ${v.kept === 'dropped' ? 'text-faint' : ''}`}>
                <span className="w-40 shrink-0 font-sans">
                  {v.kept === 'kept' && <span className="text-good">product line</span>}
                  {v.kept === 'joined' && <span className="text-good">{v.reason}</span>}
                  {v.kept === 'dropped' && <span>skipped · {v.reason}</span>}
                </span>
                <span className="whitespace-pre-wrap break-all">{v.text}</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      <form action={formAction} className="space-y-3 border-t border-line pt-6">
        <input type="hidden" name="delivery_id" value={deliveryId} />
        <input type="hidden" name="docket_number" value={docketNumber} />
        <input type="hidden" name="lines" value={payload} />

        {short.length > 0 && (
          <p className="rounded border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
            {short.length} {short.length === 1 ? 'line is' : 'lines are'} short of the docket. They are recorded
            as delivered short.
          </p>
        )}
        {undated.length > 0 && (
          <p className="rounded border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning">
            {undated.length} batch-tracked{' '}
            {undated.length === 1 ? 'line has' : 'lines have'} no date yet. Closing now records
            the stock but nothing will surface before it expires.
          </p>
        )}
        {unmatched.length > 0 && (
          <p className="text-sm text-muted">
            {unmatched.length} docket {unmatched.length === 1 ? 'row is' : 'rows are'} not matched and will not be recorded.
          </p>
        )}

        {state.status === 'error' && (
          <p className="rounded border border-critical/30 bg-critical-soft px-3 py-2 text-sm text-critical">
            {state.message}
          </p>
        )}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={closing || received.length === 0}
            className="btn btn-primary"
          >
            {closing ? 'Closing…' : `Close delivery from ${supplierName}`}
          </button>
          <span className="text-sm text-muted">
            {received.length} {received.length === 1 ? 'line' : 'lines'} received
          </span>
        </div>
      </form>
    </div>
  );
}
