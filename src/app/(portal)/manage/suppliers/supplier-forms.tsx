'use client';

import { useActionState } from 'react';
import { mergeSupplier, saveSupplier, type SupplierState } from '@/lib/suppliers/actions';

type Supplier = { id: string; name: string; abn: string | null; active: boolean };

function Outcome({ state }: { state: SupplierState }) {
  if (state.status === 'error') return <span role="alert" className="text-sm text-critical">{state.message}</span>;
  if (state.status === 'saved') return <span role="status" className="text-sm text-good">{state.message}</span>;
  return null;
}

/** Name, ABN and whether intake offers it. The old name stays recognised on dockets. */
export function SupplierForm({ supplier }: { supplier: Supplier }) {
  const [state, formAction, pending] = useActionState<SupplierState, FormData>(saveSupplier, { status: 'idle' });
  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="supplier_id" value={supplier.id} />
      <div className="flex flex-wrap gap-3">
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted">Name</span>
          <input name="name" required minLength={2} maxLength={120} defaultValue={supplier.name} className="field w-72 max-w-full" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted">ABN (optional)</span>
          <input name="abn" inputMode="numeric" maxLength={14} defaultValue={supplier.abn ?? ''}
            placeholder="11 digits" className="field w-40 font-mono" />
        </label>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="active" defaultChecked={supplier.active} className="mt-1" />
        <span>
          Offered when receiving a delivery
          <span className="block text-xs text-muted">
            Switched off, it leaves the list staff pick from and its dockets are no longer recognised.
            Adding it again from a docket (same ABN or name) switches it back on.
          </span>
        </span>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
        <Outcome state={state} />
      </div>
    </form>
  );
}

/** Folds this supplier into another: its deliveries and docket names move, then it is gone. */
export function MergeForm({ supplier, others, suggested }: { supplier: Supplier; others: Supplier[]; suggested: string | null }) {
  const [state, formAction, pending] = useActionState<SupplierState, FormData>(mergeSupplier, { status: 'idle' });
  return (
    <form
      action={formAction}
      onSubmit={(e) => {
        const keep = others.find((o) => o.id === new FormData(e.currentTarget).get('keep_id'));
        if (!keep || !window.confirm(`Merge ${supplier.name} into ${keep.name}? Its deliveries move across and ${supplier.name} is removed. This cannot be undone.`)) {
          e.preventDefault();
        }
      }}
      className="space-y-2"
    >
      <input type="hidden" name="remove_id" value={supplier.id} />
      <label className="block space-y-1 text-sm">
        <span className="block text-xs text-muted">Same business as</span>
        <select name="keep_id" required defaultValue={suggested ?? ''} className="field w-72 max-w-full">
          <option value="" disabled>Pick the supplier to keep</option>
          {others.map((o) => <option key={o.id} value={o.id}>{o.name}{o.active ? '' : ' (switched off)'}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-danger btn-sm" disabled={pending || others.length === 0}>
          {pending ? 'Merging…' : `Merge ${supplier.name} into it`}
        </button>
        <Outcome state={state} />
      </div>
    </form>
  );
}
