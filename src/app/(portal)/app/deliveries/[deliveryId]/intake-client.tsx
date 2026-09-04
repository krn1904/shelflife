'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import {
  closeDelivery,
  searchProductsForIntake,
  type IntakeState,
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

type DraftLine = SuggestedLine & {
  ticked: boolean;
  qty: number;
  expiry: string | null;
  confirmed: boolean;
};

function describe(line: { brand: string | null; size: string | null }) {
  return [line.brand, line.size].filter(Boolean).join(' · ');
}

/**
 * Working down the docket, not around the store.
 *
 * Everything is local state until "Close delivery" — a store room has patchy signal, and
 * a per-keystroke save would spend the whole minute this flow is allowed. Lines start
 * ticked because the pre-filled list is a prediction of what arrived: untick the misses.
 */
export function IntakeClient({
  deliveryId,
  orgId,
  siteId,
  supplierName,
  docketPhotoPath,
  suggested,
  historyNote,
}: {
  deliveryId: string;
  orgId: string;
  siteId: string;
  supplierName: string;
  docketPhotoPath: string | null;
  suggested: SuggestedLine[];
  historyNote: string;
}) {
  const [lines, setLines] = useState<DraftLine[]>(() =>
    suggested.map((s) => ({
      ...s,
      ticked: true,
      qty: s.qtyDocketed,
      expiry: s.proposal.date,
      confirmed: false,
    })),
  );
  const [docketNumber, setDocketNumber] = useState('');
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<SuggestedLine[]>([]);
  const [searching, startSearch] = useTransition();
  const [state, formAction, closing] = useActionState<IntakeState, FormData>(closeDelivery, {
    status: 'idle',
  });

  const active = lines.filter((l) => l.ticked && l.qty > 0);
  const undated = active.filter((l) => l.trackingMode === 'batch' && !l.expiry);

  const payload = useMemo(
    () =>
      JSON.stringify(
        active.map((l) => ({
          product_id: l.productId,
          qty_received: l.qty,
          expiry_date: l.trackingMode === 'batch' ? l.expiry : null,
          confirmed: l.confirmed,
        })),
      ),
    [active],
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

  function addLine(line: SuggestedLine) {
    if (lines.some((l) => l.productId === line.productId)) return;
    setLines((prev) => [
      ...prev,
      { ...line, ticked: true, qty: 1, expiry: line.proposal.date, confirmed: false },
    ]);
    setTerm('');
    setResults([]);
  }

  /** Copies the date from the nearest batch line above — sibling sizes often match. */
  function copyPrevious(index: number) {
    const above = lines.slice(0, index).reverse().find((l) => l.trackingMode === 'batch' && l.expiry);
    if (above?.expiry) update(lines[index].productId, { expiry: above.expiry, confirmed: true });
  }

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          1 · The docket
        </h2>
        <p className="mt-1 text-sm text-neutral-500">
          Photograph it first. It is the evidence for any dispute, and what invoice
          reconciliation will read later.
        </p>
        <div className="mt-3">
          <DocketPhoto
            deliveryId={deliveryId}
            orgId={orgId}
            siteId={siteId}
            existingPath={docketPhotoPath}
          />
        </div>
        <label htmlFor="docket_number" className="mt-4 block text-sm font-medium">
          Docket number <span className="font-normal text-neutral-500">(optional)</span>
        </label>
        <input
          id="docket_number"
          value={docketNumber}
          onChange={(e) => setDocketNumber(e.target.value)}
          className="mt-1 w-full rounded border border-neutral-300 px-3 py-2 text-sm sm:max-w-64"
        />
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          2 · What came
        </h2>
        <p className="mt-1 text-sm text-neutral-500">{historyNote}</p>

        <ul className="mt-3 divide-y divide-neutral-200 rounded border border-neutral-200">
          {lines.map((line, index) => (
            <li key={line.productId} className={line.ticked ? '' : 'bg-neutral-50 opacity-60'}>
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
                  <span className="block text-xs text-neutral-500">{describe(line)}</span>
                </span>

                <span className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => update(line.productId, { qty: Math.max(0, line.qty - 1) })}
                    className="size-8 rounded border border-neutral-300 text-lg leading-none"
                    aria-label={`One fewer ${line.name}`}
                  >
                    −
                  </button>
                  <input
                    value={line.qty}
                    onChange={(e) =>
                      update(line.productId, { qty: Math.max(0, Number(e.target.value) || 0) })
                    }
                    inputMode="numeric"
                    aria-label={`Quantity of ${line.name}`}
                    className="w-14 rounded border border-neutral-300 px-2 py-1 text-center text-sm tabular-nums"
                  />
                  <button
                    type="button"
                    onClick={() => update(line.productId, { qty: line.qty + 1 })}
                    className="size-8 rounded border border-neutral-300 text-lg leading-none"
                    aria-label={`One more ${line.name}`}
                  >
                    +
                  </button>
                </span>
              </div>

              {line.ticked && line.trackingMode === 'batch' && (
                <div className="flex flex-wrap items-center gap-2 border-t border-neutral-100 px-4 py-2 pl-12">
                  <input
                    type="date"
                    value={line.expiry ?? ''}
                    onChange={(e) =>
                      update(line.productId, { expiry: e.target.value || null, confirmed: true })
                    }
                    aria-label={`Expiry for ${line.name}`}
                    className="rounded border border-neutral-300 px-2 py-1 text-sm"
                  />
                  {line.confirmed ? (
                    <span className="text-xs font-medium text-green-700">Confirmed</span>
                  ) : (
                    <>
                      <span className="text-xs text-neutral-500">
                        {BASIS_NOTE[line.proposal.basis]}
                      </span>
                      {line.expiry && (
                        <button
                          type="button"
                          onClick={() => update(line.productId, { confirmed: true })}
                          className="rounded border border-neutral-300 px-2 py-1 text-xs font-medium"
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
                      className="text-xs text-neutral-500 underline"
                    >
                      Same as previous line
                    </button>
                  )}
                </div>
              )}

              {line.ticked && line.trackingMode !== 'batch' && (
                <p className="border-t border-neutral-100 px-4 py-2 pl-12 text-xs text-neutral-500">
                  {line.trackingMode === 'rotation'
                    ? 'Rotation stock — checked on the daily fixture list, no date needed.'
                    : 'Not expiry-tracked — quantity only.'}
                </p>
              )}
            </li>
          ))}

          {lines.length === 0 && (
            <li className="px-4 py-3 text-sm text-neutral-500">
              Nothing pre-filled. Add the lines from the docket below.
            </li>
          )}
        </ul>
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          3 · Anything else on the docket
        </h2>
        <input
          value={term}
          onChange={(e) => runSearch(e.target.value)}
          placeholder="Search the catalogue"
          aria-label="Search for a product to add"
          className="mt-2 w-full rounded border border-neutral-300 px-3 py-2 text-sm"
        />
        {searching && <p className="mt-2 text-xs text-neutral-500">Searching…</p>}
        {results.length > 0 && (
          <ul className="mt-2 divide-y divide-neutral-200 rounded border border-neutral-200">
            {results.map((r) => (
              <li key={r.productId}>
                <button
                  type="button"
                  onClick={() => addLine(r)}
                  className="flex w-full items-baseline gap-3 px-4 py-2 text-left hover:bg-neutral-50"
                >
                  <span className="text-sm">{r.name}</span>
                  <span className="text-xs text-neutral-500">{describe(r)}</span>
                  <span className="ml-auto text-xs text-neutral-500">Add</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form action={formAction} className="space-y-3 border-t border-neutral-200 pt-6">
        <input type="hidden" name="delivery_id" value={deliveryId} />
        <input type="hidden" name="docket_number" value={docketNumber} />
        <input type="hidden" name="lines" value={payload} />

        {undated.length > 0 && (
          <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {undated.length} batch-tracked{' '}
            {undated.length === 1 ? 'line has' : 'lines have'} no date yet. Closing now records
            the stock but nothing will surface before it expires.
          </p>
        )}

        {state.status === 'error' && (
          <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
            {state.message}
          </p>
        )}

        <div className="flex items-center gap-4">
          <button
            type="submit"
            disabled={closing || active.length === 0}
            className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {closing ? 'Closing…' : `Close delivery from ${supplierName}`}
          </button>
          <span className="text-sm text-neutral-500">
            {active.length} {active.length === 1 ? 'line' : 'lines'}
          </span>
        </div>
      </form>
    </div>
  );
}
