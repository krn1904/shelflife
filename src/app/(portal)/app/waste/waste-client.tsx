'use client';

import { useActionState, useCallback, useState, useTransition } from 'react';
import { BarcodeScanner } from '@/components/barcode-scanner';
import { batchesForBarcode, recordWaste, type ActionResult } from '@/lib/expiry/actions';
import { WASTE_REASONS, WASTE_REASON_LABEL } from '@/lib/expiry/waste-reasons';

type Batch = { id: string; expiry_date: string | null; qty_remaining: number };
type Found = { name: string; brand: string | null; size: string | null } | null;

/**
 * Scan-to-waste is the one place scanning genuinely beats every alternative: the item is
 * already in your hand, and finding it in a list would take longer than pointing a camera
 * at it. This is the repurposed use of the scanner, not intake.
 */
export function WasteClient({
  siteId,
  siteName,
  initialBatchId,
}: {
  siteId: string | null;
  siteName: string | null;
  initialBatchId?: string;
}) {
  const [product, setProduct] = useState<Found>(null);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [chosen, setChosen] = useState<string | null>(initialBatchId ?? null);
  const [searched, setSearched] = useState(false);
  const [pending, startTransition] = useTransition();
  const [state, formAction, saving] = useActionState<ActionResult, FormData>(recordWaste, {
    status: 'idle',
  });

  const onScan = useCallback(
    (barcode: string) => {
      startTransition(async () => {
        const result = await batchesForBarcode(barcode, siteId);
        setProduct(result.product);
        setBatches(result.batches);
        setChosen(result.batches[0]?.id ?? null);
        setSearched(true);
      });
    },
    [siteId],
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.875rem] font-bold leading-tight tracking-tight sm:text-[2rem]">Waste</h1>
        <p className="mt-1 text-sm text-muted">
          {siteName ? `Writing off at ${siteName}.` : 'No site assigned to you yet.'}
        </p>
      </div>

      {!initialBatchId && <BarcodeScanner onScan={onScan} disabled={pending} />}

      {pending && <p className="text-sm text-muted">Finding that stock…</p>}

      {!pending && searched && !product && (
        <p className="alert alert-warning">
          That barcode is not in the catalogue. Add it from the Scan screen first.
        </p>
      )}

      {!pending && product && batches.length === 0 && (
        <p className="alert alert-warning">
          {product.name} has no stock recorded at this site, so there is nothing to write off.
        </p>
      )}

      {(chosen || batches.length > 0) && (
        <form action={formAction} className="space-y-4 card p-4">
          {product && (
            <div>
              <p className="text-base font-semibold">{product.name}</p>
              <p className="text-sm text-muted">
                {[product.brand, product.size].filter(Boolean).join(' · ')}
              </p>
            </div>
          )}

          {batches.length > 1 && (
            <fieldset>
              <legend className="text-sm font-medium">Which batch?</legend>
              <div className="mt-2 space-y-2">
                {batches.map((b) => (
                  <label key={b.id} className="flex items-center gap-3 min-h-11 rounded-[var(--radius)] border border-line px-3 py-2">
                    <input
                      type="radio"
                      name="batch_id"
                      value={b.id}
                      checked={chosen === b.id}
                      onChange={() => setChosen(b.id)}
                    />
                    <span className="text-sm">
                      {b.expiry_date ? `Expires ${b.expiry_date}` : 'No date recorded'}
                      <span className="ml-2 text-muted">{b.qty_remaining} left</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          {batches.length <= 1 && <input type="hidden" name="batch_id" value={chosen ?? ''} />}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="qty" className="block text-sm font-medium">How many?</label>
              <input
                id="qty"
                name="qty"
                inputMode="numeric"
                defaultValue={1}
                className="mt-1 w-full field tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="reason" className="block text-sm font-medium">Why?</label>
              <select
                id="reason"
                name="reason"
                defaultValue="expired"
                className="mt-1 w-full field"
              >
                {WASTE_REASONS.map((r) => (
                  <option key={r} value={r}>{WASTE_REASON_LABEL[r]}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label htmlFor="note" className="block text-sm font-medium">
              Note <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id="note"
              name="note"
              maxLength={280}
              className="mt-1 w-full field"
            />
          </div>

          {state.status === 'error' && (
            <p className="alert alert-critical">
              {state.message}
            </p>
          )}

          <button
            type="submit"
            disabled={saving || !chosen}
            className="btn btn-primary"
          >
            {saving ? 'Recording…' : 'Record waste'}
          </button>
        </form>
      )}
    </div>
  );
}
