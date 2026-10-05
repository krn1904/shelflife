'use client';

import { useActionState, useEffect } from 'react';
import { addCatalogueProduct, type ProductFormState } from '@/lib/products/actions';
import { TRACKING_HINT, TRACKING_LABEL, TRACKING_MODES } from '@/lib/products/tracking';

const FIELD = 'w-full field text-sm';

/**
 * Adds an unknown barcode to the shared catalogue. Shown once per product, ever,
 * across every tenant — so it asks for the few fields that cannot be guessed later
 * and nothing else. Tracking mode is the one that matters and is asked explicitly.
 */
export function ProductForm({
  barcode,
  onSaved,
}: {
  barcode: string;
  onSaved?: (productId: string) => void;
}) {
  const [state, formAction, pending] = useActionState<ProductFormState, FormData>(
    addCatalogueProduct,
    { status: 'idle' },
  );

  useEffect(() => {
    if (state.status === 'saved') onSaved?.(state.productId);
  }, [state, onSaved]);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="barcode" value={barcode} />

      <div>
        <span className="block text-sm font-medium">Barcode</span>
        <span className="mt-1 block font-mono text-sm tabular-nums text-muted">{barcode}</span>
      </div>

      <div>
        <label htmlFor="name" className="block text-sm font-medium">
          Name
        </label>
        <input id="name" name="name" required maxLength={120} className={`mt-1 ${FIELD}`}
          placeholder="Coke Zero Sugar 1.25L" />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="brand" className="block text-sm font-medium">Brand</label>
          <input id="brand" name="brand" maxLength={80} className={`mt-1 ${FIELD}`} />
        </div>
        <div>
          <label htmlFor="size" className="block text-sm font-medium">Size</label>
          <input id="size" name="size" maxLength={40} className={`mt-1 ${FIELD}`} placeholder="1.25L" />
        </div>
        <div>
          <label htmlFor="category" className="block text-sm font-medium">Category</label>
          <input id="category" name="category" maxLength={60} className={`mt-1 ${FIELD}`}
            placeholder="Soft drinks" />
        </div>
      </div>

      <fieldset>
        <legend className="text-sm font-medium">How should this be tracked?</legend>
        <div className="mt-2 space-y-2">
          {TRACKING_MODES.map((mode) => (
            <label key={mode} className="flex gap-3 min-h-11 rounded-[var(--radius)] border border-line px-3 py-2">
              <input
                type="radio"
                name="tracking_mode"
                value={mode}
                defaultChecked={mode === 'batch'}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium">{TRACKING_LABEL[mode]}</span>
                <span className="block text-xs text-muted">{TRACKING_HINT[mode]}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor="default_shelf_life_days" className="block text-sm font-medium">
          Typical shelf life in days <span className="font-normal text-muted">(optional)</span>
        </label>
        <input
          id="default_shelf_life_days"
          name="default_shelf_life_days"
          inputMode="numeric"
          className={`mt-1 ${FIELD} sm:max-w-40`}
        />
        <p className="mt-1 text-xs text-muted">
          Used to propose an expiry date at intake, so staff confirm rather than type.
        </p>
      </div>

      {state.status === 'error' && (
        <p className="alert alert-critical">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary"
      >
        {pending ? 'Saving…' : 'Add to catalogue'}
      </button>
    </form>
  );
}
