'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { saveDocketScan } from '@/lib/intake/docket/actions';
import type { ScanDraft } from '@/lib/intake/docket/scan';

type Details = { supplierName: string; docketNumber: string; docketDate: string };
type Row = { cells: string[]; expiryDate: string };

const input = 'w-full rounded border border-line bg-surface px-2 py-1.5 text-sm text-ink focus:border-brand focus:outline-none';
const cellInput = 'field-sizing-content min-w-full rounded border border-transparent bg-transparent px-1.5 py-1 hover:border-line-strong focus:border-brand focus:bg-surface focus:outline-none';

/**
 * The chosen table with an expiry date per line. The operator corrects anything Textract
 * misread, removes rows that are not products (section headings, totals), dates each line
 * from the product in hand, and saves. A delivery that needs no dates says so explicitly.
 */
export function ExpiryDialog({
  draft,
  details: initialDetails,
  onClose,
}: {
  draft: ScanDraft;
  details: Details;
  onClose: (saved: { id: string; lines: number } | null) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [details, setDetails] = useState(initialDetails);
  const [rows, setRows] = useState<Row[]>(() => draft.rows.map((cells) => ({ cells, expiryDate: '' })));
  const [notNeeded, setNotNeeded] = useState(false);
  const [fillDate, setFillDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    const d = dialog.current;
    d?.showModal();
    return () => d?.close();
  }, []);

  const missing = rows.filter((r) => !r.expiryDate).length;
  const editCell = (r: number, c: number, value: string) =>
    setRows((all) => all.map((row, i) => (i === r ? { ...row, cells: row.cells.map((v, j) => (j === c ? value : v)) } : row)));
  const setExpiry = (r: number, value: string) =>
    setRows((all) => all.map((row, i) => (i === r ? { ...row, expiryDate: value } : row)));

  function save() {
    setError(null);
    if (rows.length === 0) return setError('There are no lines to save.');
    if (!notNeeded && missing > 0) {
      return setError(`${missing} ${missing === 1 ? 'line needs' : 'lines need'} an expiry date, or tick "No expiry dates needed".`);
    }
    startTransition(async () => {
      const result = await saveDocketScan({
        supplierName: details.supplierName.trim() || null,
        docketNumber: details.docketNumber.trim() || null,
        docketDate: details.docketDate.trim() || null,
        columns: draft.columns,
        expiryNotNeeded: notNeeded,
        lines: rows.map((r) => ({ cells: r.cells, expiryDate: r.expiryDate || null })),
      });
      if (result.status === 'saved') onClose({ id: result.id, lines: result.lines });
      else setError(result.message);
    });
  }

  return (
    <dialog
      ref={dialog}
      onCancel={(e) => { e.preventDefault(); if (!pending) onClose(null); }}
      className="m-auto max-h-[92vh] w-[min(1200px,96vw)] rounded-xl border border-line bg-paper p-0 text-ink shadow-xl backdrop:bg-black/50"
    >
      <div className="flex max-h-[92vh] flex-col">
        <header className="border-b border-line px-5 py-4">
          <h2 className="text-lg font-semibold">Add expiry dates</h2>
          <p className="text-sm text-muted">
            Check each line against the product, fix anything misread, remove rows that are not products, and date each line.
          </p>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-3 sm:grid-cols-3">
            {([['supplierName', 'Supplier'], ['docketNumber', 'Docket number'], ['docketDate', 'Docket date']] as const).map(([key, label]) => (
              <label key={key} className="text-xs text-muted">
                {label}
                <input className={`${input} mt-1`} value={details[key]}
                  onChange={(e) => setDetails((d) => ({ ...d, [key]: e.target.value }))} />
              </label>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={notNeeded} onChange={(e) => setNotNeeded(e.target.checked)} />
              No expiry dates needed for this delivery
            </label>
            <span className="flex items-center gap-2">
              <span className="text-muted">Fill empty dates with</span>
              <input type="date" value={fillDate} onChange={(e) => setFillDate(e.target.value)}
                className="rounded border border-line bg-surface px-2 py-1 text-sm" aria-label="Date to fill empty expiry dates with" />
              <button type="button" className="btn btn-outline px-3 py-1 text-xs" disabled={!fillDate}
                onClick={() => setRows((all) => all.map((r) => (r.expiryDate ? r : { ...r, expiryDate: fillDate })))}>
                Apply
              </button>
            </span>
          </div>

          <div className="overflow-x-auto rounded border border-line">
            <table className="w-max min-w-full text-sm">
              <thead className="bg-surface-2 text-left text-xs text-muted">
                <tr>
                  {draft.columns.map((c, i) => <th key={i} className="px-2 py-2 font-medium">{c}</th>)}
                  <th className="px-2 py-2 font-medium text-ink">Expiry date</th>
                  <th className="px-2 py-2"><span className="sr-only">Remove</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((row, r) => (
                  <tr key={r}>
                    {row.cells.map((value, c) => (
                      <td key={c} className="border-r border-line p-0.5">
                        <input value={value} onChange={(e) => editCell(r, c, e.target.value)} className={cellInput}
                          size={Math.max(3, value.length + 1)} aria-label={`${draft.columns[c]}, line ${r + 1}`} />
                      </td>
                    ))}
                    <td className={`px-1 py-0.5 ${!notNeeded && !row.expiryDate ? 'bg-warning-soft' : ''}`}>
                      <input type="date" value={row.expiryDate} onChange={(e) => setExpiry(r, e.target.value)}
                        className="rounded border border-line bg-surface px-2 py-1 text-sm" aria-label={`Expiry date, line ${r + 1}`} />
                    </td>
                    <td className="px-1">
                      <button type="button" onClick={() => setRows((all) => all.filter((_, i) => i !== r))}
                        className="rounded px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-critical"
                        aria-label={`Remove line ${r + 1}`}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3">
          <p className="mr-auto text-sm text-muted">
            {rows.length} {rows.length === 1 ? 'line' : 'lines'}
            {!notNeeded && missing > 0 && <> · <span className="text-warning">{missing} without an expiry date</span></>}
          </p>
          {error && <p className="w-full text-sm text-critical sm:w-auto">{error}</p>}
          <button type="button" className="btn btn-outline" disabled={pending} onClick={() => onClose(null)}>Cancel</button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
            {pending ? 'Saving…' : 'Save docket'}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
