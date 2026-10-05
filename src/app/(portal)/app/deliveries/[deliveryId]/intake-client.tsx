'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import {
  closeDelivery,
  searchProductsForIntake,
  type DocketRow,
  type DocketVerdict,
  type IntakeState,
} from '@/lib/intake/actions';
import { BASIS_NOTE, type ExpiryBasis } from '@/lib/intake/expiry';
import { intakePayload, intakeSummary, trackingOf } from '@/lib/intake/plan';
import { linePosition, stepLine } from '@/lib/intake/walk';
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
  rows: DocketRow[];
  verdicts: DocketVerdict[];
};

type Product = Pick<SuggestedLine, 'productId' | 'name' | 'brand' | 'size' | 'trackingMode' | 'proposal'>;

/**
 * One line of the delivery. With a product it is a catalogue item; without one it is a new
 * item taken as the docket prints it, added to the catalogue when the delivery closes.
 */
type Row = {
  key: string;
  product: Product | null;
  /** The name a new item is added under; starts as the docket's own wording. */
  name: string;
  suggestion: Product | null;
  newTracking: TrackingMode;
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

const TRACKING_LABEL: Record<TrackingMode, string> = {
  batch: 'Dated stock',
  rotation: 'Rotation stock',
  none: 'Not tracked',
};

function describe(p: { brand: string | null; size: string | null }) {
  return [p.brand, p.size].filter(Boolean).join(' · ');
}

function fromProduct(product: Product, extra: Partial<Row> = {}): Row {
  return {
    key: product.productId,
    product,
    name: product.name,
    suggestion: null,
    newTracking: 'batch',
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

function fromDocket(row: DocketRow): Row {
  return {
    key: row.key,
    product: row.product,
    name: row.name,
    suggestion: row.suggestion,
    newTracking: 'batch',
    ticked: true,
    qty: row.qtyReceived,
    expiry: row.product?.proposal.date ?? null,
    confirmed: false,
    docketed: row.qtyDocketed,
    fromDocket: true,
    docketText: row.docketText,
    unsure: row.unsure,
  };
}

/**
 * Working down the docket, not around the store.
 *
 * Everything is local state until "Close delivery" — a store room has patchy signal, and
 * a per-keystroke save would spend the whole minute this flow is allowed. When the docket
 * was read, every row on it is a line: linked to the catalogue when it is plainly a known
 * product, otherwise taken as printed and marked to double-check. Without a docket, the
 * lines are predicted from this supplier's last deliveries.
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
  const [rows, setRows] = useState<Row[]>(() =>
    docket ? docket.rows.map(fromDocket) : suggested.map((s) => fromProduct(s, { qty: s.qtyDocketed })),
  );
  // The row a catalogue search is picking a product for, if any.
  const [linking, setLinking] = useState<string | null>(null);
  const [docketNumber, setDocketNumber] = useState('');
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<SuggestedLine[]>([]);
  const [searching, startSearch] = useTransition();
  // One line at a time by default, like reading down the paper; "Show all lines" is the list.
  const [walking, setWalking] = useState(true);
  const [at, setAt] = useState(0);
  const [state, formAction, closing] = useActionState<IntakeState, FormData>(closeDelivery, {
    status: 'idle',
  });

  const { received, undated, short, unnamed, newItems } = intakeSummary(rows);
  const payload = useMemo(() => JSON.stringify(intakePayload(rows, docket !== null)), [rows, docket]);

  function update(key: string, patch: Partial<Row>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function link(key: string, product: Product) {
    update(key, {
      product,
      suggestion: null,
      expiry: product.proposal.date,
      confirmed: false,
    });
  }

  /** Not the catalogue product it was matched to: back to the docket's own wording. */
  function unlink(row: Row) {
    update(row.key, {
      product: null,
      suggestion: row.product,
      name: row.docketText ? row.name : row.product?.name ?? row.name,
      expiry: null,
      confirmed: false,
    });
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

  function findFor(row: Row) {
    setLinking(row.key);
    // Search from the row's words, without sizes, codes and counts.
    runSearch(row.name.replace(/[^a-z\s]/gi, ' ').replace(/\s+/g, ' ').trim().split(' ').slice(0, 2).join(' '));
  }

  function choose(product: SuggestedLine) {
    if (linking) {
      link(linking, product);
    } else {
      setRows((prev) => [
        ...prev,
        fromProduct(product, { key: `add-${product.productId}-${prev.length}`, docketed: docket ? 0 : null }),
      ]);
      setAt(rows.length);
    }
    setLinking(null);
    setTerm('');
    setResults([]);
  }

  /** Copies the date from the nearest dated line above — sibling sizes often match. */
  function copyPrevious(index: number) {
    const above = rows.slice(0, index).reverse().find((r) => trackingOf(r) === 'batch' && r.expiry);
    if (above?.expiry) update(rows[index].key, { expiry: above.expiry, confirmed: true });
  }

  const linkingRow = rows.find((r) => r.key === linking) ?? null;
  const position = linePosition(at, rows.length);
  const current = position ? { row: rows[position.line - 1], index: position.line - 1 } : null;

  /** One line's controls; `big` is the one-at-a-time focus card, with thumb-sized steppers. */
  function lineBody(row: Row, index: number, big: boolean) {
    const got = row.ticked ? row.qty : 0;
    const gap = row.docketed === null ? 0 : got - row.docketed;
    const tracking = trackingOf(row);
    return (
      <>
        <div className={`flex flex-wrap items-start gap-3 ${big ? 'p-5' : 'px-4 py-3'}`}>
          <input
            type="checkbox"
            checked={row.ticked}
            onChange={(e) => update(row.key, { ticked: e.target.checked })}
            aria-label={`Received ${row.name}`}
            className="mt-1.5 size-5"
          />
          {/* On a phone, and in the focus card, the name takes its own row and the counts sit underneath. */}
          <div className={`min-w-0 flex-1 space-y-1 ${big ? 'basis-[calc(100%-2.5rem)]' : 'max-sm:basis-[calc(100%-2.5rem)]'}`}>
            {row.product ? (
              <>
                <span className={`block font-semibold ${big ? 'text-xl leading-tight' : 'truncate text-[0.9375rem]'}`}>{row.product.name}</span>
                <span className="block text-xs text-muted">
                  {describe(row.product)}{describe(row.product) ? ' · ' : ''}in your catalogue
                </span>
              </>
            ) : (
              <>
                <input
                  value={row.name}
                  onChange={(e) => update(row.key, { name: e.target.value })}
                  aria-label={`Name of docket line ${index + 1}`}
                  className="field px-2 py-1 text-sm font-medium"
                  maxLength={120}
                />
                <span className="block text-xs text-warning">
                  New item — not in your catalogue. Check the name; it is added as written.
                </span>
              </>
            )}
            {row.docketText && (
              <span className="block truncate font-mono text-xs text-faint" title={row.docketText}>
                Docket: {row.docketText}
              </span>
            )}
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {!row.product && row.suggestion && (
                <button type="button" onClick={() => link(row.key, row.suggestion!)} className="btn btn-outline btn-sm">
                  Is it {row.suggestion.name}? Use that
                </button>
              )}
              {!row.product && (
                <button type="button" onClick={() => findFor(row)} className="text-muted underline">
                  Find in catalogue
                </button>
              )}
              {row.product && row.fromDocket && (
                <button type="button" onClick={() => unlink(row)} className="text-muted underline">
                  Not this product?
                </button>
              )}
              {!row.product && (
                <label className="flex items-center gap-1 text-muted">
                  Kind
                  <select
                    value={row.newTracking}
                    onChange={(e) => update(row.key, { newTracking: e.target.value as TrackingMode })}
                    className="field w-auto px-1.5 py-0.5 text-xs"
                  >
                    {(Object.keys(TRACKING_LABEL) as TrackingMode[]).map((mode) => (
                      <option key={mode} value={mode}>{TRACKING_LABEL[mode]}</option>
                    ))}
                  </select>
                </label>
              )}
            </span>
          </div>

          {row.docketed !== null && (
            <span className={`flex gap-1 text-xs ${big ? 'items-center pl-8' : 'items-center max-sm:pl-8 sm:flex-col sm:items-end sm:pt-1'}`}>
              <span className="font-mono text-muted">docket {row.docketed}</span>
              {gap < 0 && <span className="badge badge-warning font-mono">short {-gap}</span>}
              {gap > 0 && <span className="badge badge-neutral">over {gap}</span>}
            </span>
          )}

          <span className={`flex items-center gap-1 rounded ${big ? 'ml-auto' : 'max-sm:ml-auto'} ${row.unsure && row.ticked ? 'bg-warning-soft p-1' : ''}`}>
            <button
              type="button"
              onClick={() => update(row.key, { qty: Math.max(0, row.qty - 1), unsure: false })}
              className={`btn btn-outline p-0 leading-none ${big ? 'size-14 text-2xl' : 'size-11 text-lg'}`}
              aria-label={`One fewer ${row.name}`}
              disabled={!row.ticked}
            >
              −
            </button>
            <input
              value={row.qty}
              onChange={(e) => update(row.key, { qty: Math.max(0, Number(e.target.value) || 0), unsure: false })}
              inputMode="numeric"
              aria-label={`Quantity of ${row.name}`}
              disabled={!row.ticked}
              className={`field px-2 py-1 text-center font-mono tabular-nums ${big ? 'w-20 text-2xl font-bold' : 'w-16'}`}
            />
            <button
              type="button"
              onClick={() => update(row.key, { qty: row.qty + 1, unsure: false })}
              className={`btn btn-outline p-0 leading-none ${big ? 'size-14 text-2xl' : 'size-11 text-lg'}`}
              aria-label={`One more ${row.name}`}
              disabled={!row.ticked}
            >
              +
            </button>
          </span>
        </div>

        {row.ticked && row.unsure && (
          <p className="border-t border-line px-4 py-1.5 pl-12 text-xs text-warning">
            The reader was not sure of this count. Check it against the docket.
          </p>
        )}
        {!row.ticked && row.fromDocket && (
          <p className="border-t border-line px-4 py-1.5 pl-12 text-xs text-muted">
            Recorded as not delivered.
          </p>
        )}

        {row.ticked && tracking === 'batch' && (
          <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2 pl-12">
            <input
              type="date"
              value={row.expiry ?? ''}
              onChange={(e) => update(row.key, { expiry: e.target.value || null, confirmed: true })}
              aria-label={`Expiry for ${row.name}`}
              className="field w-auto px-2 py-1 font-mono"
            />
            {row.confirmed ? (
              <span className="text-xs font-medium text-good">Confirmed</span>
            ) : row.product ? (
              <>
                <span className="text-xs text-muted">{BASIS_NOTE[row.product.proposal.basis]}</span>
                {row.expiry && (
                  <button
                    type="button"
                    onClick={() => update(row.key, { confirmed: true })}
                    className="btn btn-outline btn-sm"
                  >
                    Looks right
                  </button>
                )}
              </>
            ) : (
              <span className="text-xs text-muted">New item: enter the date on the pack.</span>
            )}
            {index > 0 && (
              <button type="button" onClick={() => copyPrevious(index)} className="text-xs text-muted underline">
                Same as previous line
              </button>
            )}
          </div>
        )}

        {row.ticked && tracking !== 'batch' && (
          <p className="border-t border-line px-4 py-2 pl-12 text-xs text-muted">
            {tracking === 'rotation'
              ? 'Rotation stock — checked on the daily fixture list, no date needed.'
              : 'Not expiry-tracked — quantity only.'}
          </p>
        )}
      </>
    );
  }


  return (
    <div className="space-y-8">
      <section>
        <h2 className="section-title">1 · The docket</h2>
        {docket ? (
          <p className="mt-1 text-sm text-muted">
            Read with {docket.engine === 'textract' ? 'AWS Textract' : 'the free reader'}. Check each line against the
            paper docket: amber marks what to double-check.
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
            ? 'Every line on the docket. Items already in your catalogue are linked; the rest are taken as the docket prints them and added to your organisation\'s products when you close. Untick anything that did not arrive.'
            : historyNote}
        </p>

        {rows.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-3">
            {walking && position && (
              <span className="font-mono text-sm text-muted">Line {position.line} of {position.of}</span>
            )}
            {walking && position && (
              <span aria-hidden className="h-1 min-w-24 flex-1 rounded-full bg-line">
                <span
                  className="block h-1 rounded-full bg-brand"
                  style={{ width: `${(position.line / position.of) * 100}%` }}
                />
              </span>
            )}
            <button
              type="button"
              onClick={() => setWalking((w) => !w)}
              className="btn btn-ghost btn-sm ml-auto"
            >
              {walking ? 'Show all lines' : 'One line at a time'}
            </button>
          </div>
        )}

        {walking && current ? (
          <div className="mt-3 space-y-3">
            <div className={`card overflow-hidden rounded-[1.25rem] ${current.row.ticked ? '' : 'opacity-80'}`}>
              {lineBody(current.row, current.index, true)}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setAt(stepLine(current.index, -1, rows.length))}
                disabled={current.index === 0}
                className="btn btn-outline min-h-13 px-5"
                aria-label="Previous line"
              >
                ←
              </button>
              {position?.last ? (
                <a href="#close-delivery" className="btn btn-primary min-h-13 flex-1">
                  All lines checked · review and close
                </a>
              ) : (
                <button
                  type="button"
                  onClick={() => setAt(stepLine(current.index, 1, rows.length))}
                  className="btn btn-primary min-h-13 flex-1"
                >
                  Next line
                </button>
              )}
            </div>

            <ol className="card divide-y divide-line overflow-hidden" aria-label="All lines">
              {rows.map((row, index) => {
                const dated = trackingOf(row) === 'batch';
                const gap = row.docketed === null ? 0 : (row.ticked ? row.qty : 0) - row.docketed;
                return (
                  <li key={row.key}>
                    <button
                      type="button"
                      onClick={() => setAt(index)}
                      aria-current={index === current.index ? 'step' : undefined}
                      className={`flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-surface-2 ${
                        index === current.index ? 'bg-surface-2 font-semibold' : ''
                      }`}
                    >
                      <span className="w-5 font-mono text-xs text-faint">{index + 1}</span>
                      <span className={`min-w-0 flex-1 truncate ${row.ticked ? '' : 'text-faint line-through'}`}>
                        {row.product?.name ?? (row.name || 'Unnamed new item')}
                      </span>
                      <span className={`font-mono text-xs ${gap < 0 ? 'text-warning' : 'text-muted'}`}>
                        {!row.ticked
                          ? 'not delivered'
                          : row.docketed !== null && gap !== 0
                            ? `${row.qty} of ${row.docketed}`
                            : row.qty}
                        {row.ticked && dated && (row.confirmed ? ' · ✓ date' : row.expiry ? ' · date?' : ' · no date')}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : (
          <ul className="card mt-3 divide-y divide-line overflow-hidden">
            {rows.map((row, index) => {
              return (
                <li key={row.key} className={row.ticked ? '' : 'bg-surface-2 opacity-70'}>
                  {lineBody(row, index, false)}
                </li>
              );
            })}

            {rows.length === 0 && (
              <li className="px-4 py-3 text-sm text-muted">
                {docket
                  ? 'No product lines were found on the docket. Add the lines by hand below.'
                  : 'Nothing pre-filled. Add the lines from the docket below.'}
              </li>
            )}
          </ul>
        )}
      </section>

      <section>
        <h2 className="section-title">
          {linkingRow ? 'Which catalogue product is this?' : docket ? '3 · Anything the reader missed' : '3 · Anything else on the docket'}
        </h2>
        {linkingRow && (
          <p className="mt-1 text-xs text-muted">
            For “{linkingRow.name}”.{' '}
            <button type="button" className="underline" onClick={() => { setLinking(null); setTerm(''); setResults([]); }}>
              cancel
            </button>
          </p>
        )}
        <input
          value={term}
          onChange={(e) => runSearch(e.target.value)}
          placeholder="Search the catalogue"
          aria-label="Search the catalogue"
          className="field mt-2"
        />
        {searching && <p className="mt-2 text-xs text-muted">Searching…</p>}
        {results.length > 0 && (
          <ul className="card mt-2 divide-y divide-line overflow-hidden">
            {results.map((r) => (
              <li key={r.productId}>
                <button
                  type="button"
                  onClick={() => choose(r)}
                  className="flex w-full items-baseline gap-3 px-4 py-2 text-left hover:bg-surface-2"
                >
                  <span className="text-sm">{r.name}</span>
                  <span className="text-xs text-muted">{describe(r)}</span>
                  <span className="ml-auto text-xs text-muted">{linkingRow ? 'This one' : 'Add'}</span>
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

      <form id="close-delivery" action={formAction} className="scroll-mt-20 space-y-3 border-t border-line pt-6">
        <input type="hidden" name="delivery_id" value={deliveryId} />
        <input type="hidden" name="docket_number" value={docketNumber} />
        <input type="hidden" name="lines" value={payload} />

        {newItems.length > 0 && (
          <p className="alert alert-warning">
            {newItems.length} new {newItems.length === 1 ? 'item is' : 'items are'} added to your organisation’s
            products as written when you close. Check {newItems.length === 1 ? 'its name' : 'their names'} first.
          </p>
        )}
        {short.length > 0 && (
          <p className="alert alert-warning">
            {short.length} {short.length === 1 ? 'line is' : 'lines are'} short of the docket. They are recorded
            as delivered short.
          </p>
        )}
        {undated.length > 0 && (
          <p className="alert alert-warning">
            {undated.length} dated{' '}
            {undated.length === 1 ? 'line has' : 'lines have'} no date yet. Closing now records
            the stock but nothing will surface before it expires.
          </p>
        )}

        {state.status === 'error' && (
          <p className="alert alert-critical">
            {state.message}
          </p>
        )}

        <div className="flex flex-wrap items-center gap-4">
          <button
            type="submit"
            disabled={closing || received.length === 0 || unnamed.length > 0}
            className="btn btn-primary min-h-13 w-full sm:w-auto"
          >
            {closing ? 'Closing…' : `Close delivery from ${supplierName}`}
          </button>
          <span className="text-sm text-muted">
            {unnamed.length > 0
              ? 'Give every new item a name first.'
              : `${received.length} ${received.length === 1 ? 'line' : 'lines'} received`}
          </span>
        </div>
      </form>
    </div>
  );
}
