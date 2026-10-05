'use client';

import { useActionState, useState } from 'react';
import { flushSync } from 'react-dom';
import { correctDeliveryLine, type CorrectionState } from '@/lib/deliveries/actions';
import { undatedQty } from '@/lib/deliveries/corrections';
import type { TrackingMode } from '@/lib/supabase/types';

export type EditableBatch = {
  id: string;
  expiryDate: string | null;
  qty: number;
  /** Units already written off or sold: the batch cannot drop below this. */
  used: number;
};

export type EditableLine = {
  id: string;
  qtyDocketed: number;
  qtyReceived: number;
  trackingMode: TrackingMode;
  batches: EditableBatch[];
};

type Row = { key: string; id: string | null; expiryDate: string; qty: number; used: number };

const toRows = (batches: EditableBatch[]): Row[] =>
  batches.map((b) => ({ key: b.id, id: b.id, expiryDate: b.expiryDate ?? '', qty: b.qty, used: b.used }));

/** One line of a closed delivery, as a manager corrects it: counts, and dates for dated stock. */
export function LineEditor({ line }: { line: EditableLine }) {
  const [state, formAction, pending] = useActionState<CorrectionState, FormData>(correctDeliveryLine, { status: 'idle' });
  const [docketed, setDocketed] = useState(line.qtyDocketed);
  const [received, setReceived] = useState(line.qtyReceived);
  const [rows, setRows] = useState<Row[]>(() => toRows(line.batches));
  const [added, setAdded] = useState(0);

  const dated = line.trackingMode === 'batch';
  const undated = undatedQty(received, rows);
  const payload = JSON.stringify(rows.map((r) => ({ id: r.id, expiry_date: r.expiryDate, qty: r.qty })));

  function changeReceived(next: number) {
    // One date covering the whole line follows the count, which is the usual case.
    if (rows.length === 1 && rows[0].qty === received && next >= rows[0].used && next > 0) {
      setRows([{ ...rows[0], qty: next }]);
    }
    setReceived(next);
  }

  const setRow = (key: string, patch: Partial<Row>) =>
    setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="line_id" value={line.id} />
      <input type="hidden" name="batches" value={payload} />

      <div className="flex flex-wrap gap-3">
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted">On the docket</span>
          <input name="qty_docketed" type="number" min={0} max={9999} inputMode="numeric" required
            value={docketed} onChange={(e) => setDocketed(Number(e.target.value))} className="field w-24 font-mono" />
        </label>
        <label className="space-y-1 text-sm">
          <span className="block text-xs text-muted">Received</span>
          <input name="qty_received" type="number" min={0} max={9999} inputMode="numeric" required
            value={received} onChange={(e) => changeReceived(Number(e.target.value))} className="field w-24 font-mono" />
        </label>
      </div>

      {dated && (
        <div className="space-y-2">
          <p className="text-xs text-muted">Expiry dates</p>
          {rows.map((r) => (
            <div key={r.key} className="flex flex-wrap items-center gap-2">
              <input type="date" aria-label="Expiry date" required value={r.expiryDate}
                onChange={(e) => setRow(r.key, { expiryDate: e.target.value })} className="field w-auto" />
              <input type="number" aria-label="Quantity with this date" min={Math.max(1, r.used)} max={9999} required
                value={r.qty} onChange={(e) => setRow(r.key, { qty: Number(e.target.value) })} className="field w-20 font-mono" />
              {r.used > 0 ? (
                <span className="text-xs text-muted">{r.used} already off the shelf</span>
              ) : (
                <button type="button" className="btn btn-ghost btn-sm"
                  onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                  Remove date
                </button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className="btn btn-outline btn-sm" disabled={undated === 0}
              onClick={() => {
                setRows([...rows, { key: `new-${added}`, id: null, expiryDate: '', qty: undated, used: 0 }]);
                setAdded(added + 1);
              }}>
              Add a date
            </button>
            {undated > 0 && (
              <span className="text-xs text-warning">{undated} received with no date: they are not on the expiry board.</span>
            )}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary btn-sm" disabled={pending}>
          {pending ? 'Saving…' : 'Save line'}
        </button>
        <button type="button" className="btn btn-danger btn-sm" disabled={pending}
          onClick={(e) => {
            if (!window.confirm('Remove this line from the delivery? Its stock leaves the expiry board.')) return;
            const form = e.currentTarget.form;
            // Written into the form before it submits, so the zeros are what is sent.
            flushSync(() => {
              setDocketed(0);
              setReceived(0);
              setRows([]);
            });
            form?.requestSubmit();
          }}>
          Remove line
        </button>
        {state.status === 'error' && <span role="alert" className="text-sm text-critical">{state.message}</span>}
        {state.status === 'saved' && <span role="status" className="text-sm text-good">{state.message}</span>}
      </div>
    </form>
  );
}
