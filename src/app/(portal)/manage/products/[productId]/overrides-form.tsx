'use client';

import { useActionState } from 'react';
import { saveSiteProduct, type SiteProductFormState } from '@/lib/products/actions';
import { TRACKING_LABEL, TRACKING_MODES } from '@/lib/products/tracking';
import type { TrackingMode } from '@/lib/supabase/types';

const FIELD = 'w-full rounded border border-neutral-300 px-3 py-2 text-sm';

export type SiteOverrideValues = {
  retail_price: number | null;
  unit_cost: number | null;
  par_level: number | null;
  fixture: string | null;
  tracking_mode_override: TrackingMode | null;
  active: boolean;
};

/**
 * One form for both "range this product here" and "change its settings here" — a
 * site_products row is the same thing either way, so splitting them would only add
 * a second screen that does the same upsert.
 */
export function OverridesForm({
  productId,
  siteId,
  catalogueMode,
  values,
}: {
  productId: string;
  siteId: string;
  catalogueMode: TrackingMode;
  values: SiteOverrideValues | null;
}) {
  const [state, formAction, pending] = useActionState<SiteProductFormState, FormData>(
    saveSiteProduct,
    { status: 'idle' },
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="site_id" value={siteId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="retail_price" className="block text-sm font-medium">Retail price (AUD)</label>
          <input id="retail_price" name="retail_price" inputMode="decimal"
            defaultValue={values?.retail_price ?? ''} className={`mt-1 ${FIELD}`} />
        </div>
        <div>
          <label htmlFor="unit_cost" className="block text-sm font-medium">Unit cost (AUD)</label>
          <input id="unit_cost" name="unit_cost" inputMode="decimal"
            defaultValue={values?.unit_cost ?? ''} className={`mt-1 ${FIELD}`} />
          <p className="mt-1 text-xs text-neutral-500">Used to value waste in dollars.</p>
        </div>
        <div>
          <label htmlFor="par_level" className="block text-sm font-medium">Par level</label>
          <input id="par_level" name="par_level" inputMode="numeric"
            defaultValue={values?.par_level ?? ''} className={`mt-1 ${FIELD}`} />
        </div>
        <div>
          <label htmlFor="fixture" className="block text-sm font-medium">Fixture</label>
          <input id="fixture" name="fixture" maxLength={60} placeholder="Dairy fridge"
            defaultValue={values?.fixture ?? ''} className={`mt-1 ${FIELD}`} />
          <p className="mt-1 text-xs text-neutral-500">Groups the daily rotation checklist.</p>
        </div>
      </div>

      <div>
        <label htmlFor="tracking_mode_override" className="block text-sm font-medium">
          Tracking mode at this site
        </label>
        <select
          id="tracking_mode_override"
          name="tracking_mode_override"
          defaultValue={values?.tracking_mode_override ?? ''}
          className={`mt-1 ${FIELD} sm:max-w-72`}
        >
          <option value="">Use the catalogue default ({TRACKING_LABEL[catalogueMode]})</option>
          {TRACKING_MODES.map((mode) => (
            <option key={mode} value={mode}>{TRACKING_LABEL[mode]}</option>
          ))}
        </select>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={values?.active ?? true} />
        Stocked at this site
      </label>

      {state.status === 'error' && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.message}
        </p>
      )}
      {state.status === 'saved' && (
        <p className="rounded border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800">
          Saved.
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Saving…' : values ? 'Save changes' : 'Range at this site'}
      </button>
    </form>
  );
}
