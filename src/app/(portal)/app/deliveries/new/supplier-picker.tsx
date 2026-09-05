'use client';

import { useActionState, useState } from 'react';
import { startDelivery, type IntakeState } from '@/lib/intake/actions';

/**
 * Suppliers are big tap targets rather than a select: this is the first screen of a
 * flow that has to finish in under a minute, on a phone, one-handed, in a store room.
 */
export function SupplierPicker({
  siteId,
  suppliers,
}: {
  siteId: string;
  suppliers: { id: string; name: string }[];
}) {
  const [state, formAction, pending] = useActionState<IntakeState, FormData>(startDelivery, {
    status: 'idle',
  });
  const [chosen, setChosen] = useState<string | null>(null);

  if (suppliers.length === 0) {
    return (
      <p className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
        No suppliers set up for this site yet. A manager adds them from the Site portal.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="site_id" value={siteId} />
      <input type="hidden" name="supplier_id" value={chosen ?? ''} />

      <div className="grid gap-2 sm:grid-cols-2">
        {suppliers.map((supplier) => (
          <button
            key={supplier.id}
            type="button"
            onClick={() => setChosen(supplier.id)}
            className={`rounded border px-4 py-3 text-left text-sm font-medium ${
              chosen === supplier.id
                ? 'border-neutral-900 bg-neutral-900 text-white'
                : 'border-neutral-300 hover:bg-neutral-50'
            }`}
          >
            {supplier.name}
          </button>
        ))}
      </div>

      {state.status === 'error' && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.message}
        </p>
      )}

      <button
        type="submit"
        disabled={pending || !chosen}
        className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {pending ? 'Starting…' : 'Start delivery'}
      </button>
    </form>
  );
}
