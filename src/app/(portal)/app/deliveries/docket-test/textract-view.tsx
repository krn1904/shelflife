'use client';

import { useState } from 'react';
import type { LineItem, Table, TextractReading } from '@/lib/intake/docket/textract-shape';
import { draftFromTable, suggestProductTable, type ScanDraft } from '@/lib/intake/docket/scan';
import { ExpiryDialog } from './expiry-dialog';

// Below this, a cell is worth a second look.
const SURE_AT = 80;

// field-sizing-content: each input as wide as its own text, so nothing is cut short.
const cellInput = 'field-sizing-content min-w-full rounded border border-transparent bg-transparent px-1.5 py-1 hover:border-line-strong focus:border-brand focus:bg-surface focus:outline-none';

/** One table exactly as Textract found it on the page, every cell editable. */
function EditableTable({ table, index, suggested, onUse }: {
  table: Table;
  index: number;
  suggested: boolean;
  onUse: (edited: Table) => void;
}) {
  const [rows, setRows] = useState(() => table.rows.map((r) => r.map((c) => c.text)));
  const edit = (r: number, c: number, value: string) =>
    setRows((all) => all.map((row, i) => (i === r ? row.map((v, j) => (j === c ? value : v)) : row)));
  // Fallback width for browsers without field-sizing: each column's longest body text.
  const widths = table.rows[0].map((_, c) =>
    Math.min(40, Math.max(3, ...table.rows.filter((row) => !row[c].header).map((row) => row[c].text.length))) + 1);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted">
          Table {index + 1} · {table.rows.length} rows · {Math.round(table.confidence)}% confident
        </p>
        {suggested && <span className="badge badge-brand text-xs">Suggested: looks like the product list</span>}
        <button
          type="button"
          className={`btn ${suggested ? 'btn-primary' : 'btn-outline'} ml-auto px-3 py-1 text-xs`}
          // The dialog starts from the table as corrected here, not as Textract first read it.
          onClick={() => onUse({ ...table, rows: table.rows.map((row, r) => row.map((c, i) => ({ ...c, text: rows[r][i] }))) })}
        >
          Use this table
        </button>
      </div>
      <div className="mt-1 overflow-x-auto rounded border border-line">
        {/* Natural width, scrolling sideways when wider than the screen: never squeezed. */}
        <table className="w-max min-w-full text-sm">
          <tbody className="divide-y divide-line">
            {rows.map((row, r) => (
              <tr key={r} className={table.rows[r].some((c) => c.header) ? 'bg-surface-2 font-medium' : ''}>
                {row.map((value, c) => {
                  const unsure = value !== '' && table.rows[r][c].confidence < SURE_AT;
                  return (
                    <td key={c} className={`border-r border-line p-0.5 last:border-r-0 ${unsure ? 'bg-warning-soft' : ''}`}>
                      <input
                        value={value}
                        onChange={(e) => edit(r, c, e.target.value)}
                        size={widths[c]}
                        className={cellInput}
                        title={`${table.rows[r][c].confidence}% confident`}
                        aria-label={`Row ${r + 1}, column ${c + 1}`}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ITEM_COLUMNS: [keyof LineItem, string][] = [
  ['code', 'Code'], ['item', 'Item'], ['quantity', 'Qty'], ['unitPrice', 'Unit price'], ['price', 'Price'],
];

function EditableLineItems({ items }: { items: LineItem[] }) {
  const [rows, setRows] = useState(() => items.map((i) => ITEM_COLUMNS.map(([key]) => String(i[key] ?? ''))));
  const edit = (r: number, c: number, value: string) =>
    setRows((all) => all.map((row, i) => (i === r ? row.map((v, j) => (j === c ? value : v)) : row)));

  if (items.length === 0) return <p className="text-sm text-muted">No line items found.</p>;
  return (
    <div className="overflow-x-auto rounded border border-line">
      <table className="w-full text-sm">
        <thead className="bg-surface-2 text-left text-xs text-muted">
          <tr>{ITEM_COLUMNS.map(([key, label]) => <th key={key} className="px-2 py-2">{label}</th>)}<th className="px-2 py-2">Sure</th></tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((row, r) => (
            <tr key={r} className={items[r].confidence < SURE_AT ? 'bg-warning-soft' : ''}>
              {row.map((value, c) => (
                <td key={c} className="p-0.5">
                  <input value={value} onChange={(e) => edit(r, c, e.target.value)} className={cellInput}
                    aria-label={`${ITEM_COLUMNS[c][1]}, line ${r + 1}`} />
                </td>
              ))}
              <td className="px-2 text-xs tabular-nums text-muted">{items[r].confidence}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TextractView({ reading, ms }: { reading: TextractReading; ms: number }) {
  const { expense, tables } = reading;
  const suggested = suggestProductTable(tables);
  const [draft, setDraft] = useState<ScanDraft | null>(null);
  const [saved, setSaved] = useState<{ id: string; lines: number } | null>(null);
  return (
    <div className="space-y-6">
      {saved && (
        <p className="rounded border border-good/30 bg-good-soft px-3 py-2 text-sm text-ink">
          Saved the docket with {saved.lines} {saved.lines === 1 ? 'line' : 'lines'}. It is listed under Saved dockets below.
        </p>
      )}
      {draft && (
        <ExpiryDialog
          draft={draft}
          details={{ supplierName: expense.vendor ?? '', docketNumber: expense.docketNumber ?? '', docketDate: expense.date ?? '' }}
          onClose={(result) => { setDraft(null); if (result) setSaved(result); }}
        />
      )}

      <p className="text-sm text-muted">
        {tables.length} {tables.length === 1 ? 'table' : 'tables'} and {expense.items.length} line items ·{' '}
        {(ms / 1000).toFixed(1)}s · highlighted cells are below {SURE_AT}% confidence. Every cell can be corrected.
      </p>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Tables, as printed</h2>
        <p className="mt-1 text-xs text-muted">Choose the table that lists the products to add expiry dates and save it.</p>
        <div className="mt-2 space-y-4">
          {tables.map((t, i) => (
            <EditableTable key={i} table={t} index={i} suggested={i === suggested}
              onUse={(edited) => { setSaved(null); setDraft(draftFromTable(edited)); }} />
          ))}
          {tables.length === 0 && <p className="text-sm text-muted">No tables found on the page.</p>}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted">Line items (invoice model)</h2>
        <p className="mt-1 text-xs text-muted">
          Supplier: {expense.vendor ?? '—'} · Docket: {expense.docketNumber ?? '—'} · Date: {expense.date ?? '—'}
        </p>
        <div className="mt-2"><EditableLineItems items={expense.items} /></div>
      </section>
    </div>
  );
}
