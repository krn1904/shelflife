import type { Table } from './textract-shape';

/**
 * From a docket's tables to the rows an operator dates. No supplier rules: the product
 * table is recognised by its headings, and a docket's layout is kept as printed.
 */

const DESCRIPTION = /\b(description|desc|product|item|items)\b/i;
const QUANTITY = /\b(qty|quantity|ordered|supplied|delivered|picked|units|eaches|cartons|crates)\b/i;

/** Index of the row holding the column headings: Textract's own flag, else the first row. */
export function headingRowOf(table: Table): number {
  const flagged = table.rows.findIndex((row) => row.some((cell) => cell.header));
  return flagged >= 0 ? flagged : 0;
}

/**
 * The table most likely to list the products: headings naming a description and a
 * quantity, then the most rows. Null when no table has both, so nothing is pre-chosen
 * on a docket whose table the operator should pick.
 */
export function suggestProductTable(tables: Table[]): number | null {
  let best: { index: number; score: number } | null = null;
  tables.forEach((table, index) => {
    const headings = table.rows[headingRowOf(table)]?.map((c) => c.text).join(' ') ?? '';
    if (!DESCRIPTION.test(headings) || !QUANTITY.test(headings)) return;
    const score = table.rows.length;
    if (!best || score > best.score) best = { index, score };
  });
  return (best as { index: number } | null)?.index ?? null;
}

export type ScanDraft = { columns: string[]; rows: string[][] };

/** The table as the dialog starts it: headings, then every row with anything in it. */
export function draftFromTable(table: Table): ScanDraft {
  const heading = headingRowOf(table);
  const columns = table.rows[heading].map((c, i) => c.text || `Column ${i + 1}`);
  const rows = table.rows
    .filter((_, i) => i !== heading)
    .map((row) => row.map((c) => c.text))
    .filter((cells) => cells.some((text) => text.trim() !== ''));
  return { columns, rows };
}
