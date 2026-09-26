'use client';

import { useState } from 'react';
import type { LineItem, Table, TextractReading } from '@/lib/intake/docket/textract-shape';

// Below this, a cell is worth a second look.
const SURE_AT = 80;

const cellInput = 'w-full min-w-16 rounded border border-transparent bg-transparent px-1.5 py-1 hover:border-neutral-300 focus:border-neutral-400 focus:bg-white focus:outline-none';

/** One table exactly as Textract found it on the page, every cell editable. */
function EditableTable({ table, index }: { table: Table; index: number }) {
  const [rows, setRows] = useState(() => table.rows.map((r) => r.map((c) => c.text)));
  const edit = (r: number, c: number, value: string) =>
    setRows((all) => all.map((row, i) => (i === r ? row.map((v, j) => (j === c ? value : v)) : row)));

  return (
    <div>
      <p className="text-xs text-neutral-500">
        Table {index + 1} · {table.rows.length} rows · {Math.round(table.confidence)}% confident
      </p>
      <div className="mt-1 overflow-x-auto rounded border border-neutral-200">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-neutral-100">
            {rows.map((row, r) => (
              <tr key={r} className={table.rows[r].some((c) => c.header) ? 'bg-neutral-50 font-medium' : ''}>
                {row.map((value, c) => {
                  const unsure = value !== '' && table.rows[r][c].confidence < SURE_AT;
                  return (
                    <td key={c} className={`border-r border-neutral-100 p-0.5 last:border-r-0 ${unsure ? 'bg-amber-50' : ''}`}>
                      <input
                        value={value}
                        onChange={(e) => edit(r, c, e.target.value)}
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

  if (items.length === 0) return <p className="text-sm text-neutral-500">No line items found.</p>;
  return (
    <div className="overflow-x-auto rounded border border-neutral-200">
      <table className="w-full text-sm">
        <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
          <tr>{ITEM_COLUMNS.map(([key, label]) => <th key={key} className="px-2 py-2">{label}</th>)}<th className="px-2 py-2">Sure</th></tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {rows.map((row, r) => (
            <tr key={r} className={items[r].confidence < SURE_AT ? 'bg-amber-50' : ''}>
              {row.map((value, c) => (
                <td key={c} className="p-0.5">
                  <input value={value} onChange={(e) => edit(r, c, e.target.value)} className={cellInput}
                    aria-label={`${ITEM_COLUMNS[c][1]}, line ${r + 1}`} />
                </td>
              ))}
              <td className="px-2 text-xs tabular-nums text-neutral-500">{items[r].confidence}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TextractView({ reading, ms }: { reading: TextractReading; ms: number }) {
  const { expense, tables } = reading;
  return (
    <div className="space-y-6">
      <p className="text-sm text-neutral-600">
        {tables.length} {tables.length === 1 ? 'table' : 'tables'} and {expense.items.length} line items ·{' '}
        {(ms / 1000).toFixed(1)}s · amber cells are below {SURE_AT}% confidence. Every cell can be corrected.
      </p>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Tables, as printed</h2>
        <div className="mt-2 space-y-4">
          {tables.map((t, i) => <EditableTable key={i} table={t} index={i} />)}
          {tables.length === 0 && <p className="text-sm text-neutral-500">No tables found on the page.</p>}
        </div>
      </section>

      <section>
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">Line items (invoice model)</h2>
        <p className="mt-1 text-xs text-neutral-500">
          Supplier: {expense.vendor ?? '—'} · Docket: {expense.docketNumber ?? '—'} · Date: {expense.date ?? '—'}
        </p>
        <div className="mt-2"><EditableLineItems items={expense.items} /></div>
      </section>
    </div>
  );
}
