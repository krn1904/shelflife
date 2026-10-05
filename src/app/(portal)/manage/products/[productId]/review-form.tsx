'use client';

import { useActionState, useState } from 'react';
import { reviewDocketProduct, type CorrectionState } from '@/lib/deliveries/actions';
import { TRACKING_HINT, TRACKING_LABEL, TRACKING_MODES } from '@/lib/products/tracking';
import type { TrackingMode } from '@/lib/supabase/types';

export type ReviewValues = {
  name: string;
  brand: string | null;
  size: string | null;
  barcode: string | null;
  trackingMode: TrackingMode;
  shelfLifeDays: number | null;
  fixture: string | null;
};

/**
 * A product staff added from a docket belongs to this organisation, so a manager can fix it
 * outright: the docket's wording, the barcode, and how it is tracked. Rotation asks for the
 * fixture in the same step, because rotation is only ever checked by fixture.
 */
export function ReviewForm({ productId, siteId, values, reviewed }: {
  productId: string;
  siteId: string;
  values: ReviewValues;
  reviewed: boolean;
}) {
  const [state, formAction, pending] = useActionState<CorrectionState, FormData>(reviewDocketProduct, { status: 'idle' });
  const [mode, setMode] = useState<TrackingMode>(values.trackingMode);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="product_id" value={productId} />
      <input type="hidden" name="site_id" value={siteId} />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1 text-sm sm:col-span-2">
          <span className="block font-medium">Name</span>
          <input name="name" required minLength={2} maxLength={120} defaultValue={values.name} className="field w-full" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Brand</span>
          <input name="brand" maxLength={80} defaultValue={values.brand ?? ''} className="field w-full" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Size</span>
          <input name="size" maxLength={40} defaultValue={values.size ?? ''} className="field w-full" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Barcode</span>
          <input name="barcode" inputMode="numeric" defaultValue={values.barcode ?? ''} className="field w-full font-mono" />
          <span className="block text-xs text-muted">So a scan finds it next time.</span>
        </label>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">Typical shelf life (days)</span>
          <input name="default_shelf_life_days" type="number" min={1} max={3650} inputMode="numeric"
            defaultValue={values.shelfLifeDays ?? ''} className="field w-full" />
          <span className="block text-xs text-muted">Used to propose a date when nothing better is known.</span>
        </label>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">How it is tracked</legend>
        {TRACKING_MODES.map((m) => (
          <label key={m} className="flex items-start gap-2 text-sm">
            <input type="radio" name="tracking_mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-1" />
            <span>
              <span className="font-medium">{TRACKING_LABEL[m]}</span>
              <span className="block text-xs text-muted">{TRACKING_HINT[m]}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="block space-y-1 text-sm">
        <span className="block font-medium">Fixture at this site{mode === 'rotation' ? '' : ' (optional)'}</span>
        <input name="fixture" maxLength={60} required={mode === 'rotation'} defaultValue={values.fixture ?? ''}
          placeholder="e.g. Drinks fridge 2" className="field w-full sm:w-80" />
      </label>

      {values.trackingMode === 'batch' && mode !== 'batch' && (
        <p className="alert alert-warning">
          Its dated stock at this site leaves the expiry board when you save.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? 'Saving…' : reviewed ? 'Save changes' : 'Save and mark reviewed'}
        </button>
        {state.status === 'error' && <span role="alert" className="text-sm text-critical">{state.message}</span>}
        {state.status === 'saved' && <span role="status" className="text-sm text-good">{state.message}</span>}
      </div>
    </form>
  );
}
