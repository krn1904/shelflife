import type { Block, ExpenseDocument } from '@aws-sdk/client-textract';

/**
 * Textract answers in a graph of blocks (pages, lines, words, tables, cells) and, for
 * invoices, in typed expense fields. These turn both into the plain shapes the screen
 * shows, with no SDK calls, so they can be tested against recorded responses.
 */

export type Cell = { text: string; confidence: number; header: boolean };
export type Table = { rows: Cell[][]; confidence: number };

export type LineItem = {
  code: string | null;
  item: string | null;
  quantity: string | null;
  unitPrice: string | null;
  price: string | null;
  /** The whole printed row, as Textract read it. */
  row: string | null;
  /** Lowest confidence of the fields above, 0–100. */
  confidence: number;
};

export type ExpenseReading = {
  vendor: string | null;
  docketNumber: string | null;
  date: string | null;
  items: LineItem[];
};

export type TextractReading = { tables: Table[]; expense: ExpenseReading };

const children = (block: Block, byId: Map<string, Block>) =>
  (block.Relationships ?? [])
    .filter((r) => r.Type === 'CHILD')
    .flatMap((r) => r.Ids ?? [])
    .map((id) => byId.get(id))
    .filter((b): b is Block => Boolean(b));

/** Every table on the page, as a grid of cells in printed order. */
export function tablesFromBlocks(blocks: Block[]): Table[] {
  const byId = new Map(blocks.filter((b) => b.Id).map((b) => [b.Id!, b]));
  return blocks
    .filter((b) => b.BlockType === 'TABLE')
    .map((table) => {
      const cells = children(table, byId).filter((c) => c.BlockType === 'CELL');
      const rowCount = Math.max(0, ...cells.map((c) => c.RowIndex ?? 0));
      const colCount = Math.max(0, ...cells.map((c) => c.ColumnIndex ?? 0));
      const rows: Cell[][] = Array.from({ length: rowCount }, () =>
        Array.from({ length: colCount }, () => ({ text: '', confidence: 0, header: false })));
      for (const cell of cells) {
        const words = children(cell, byId);
        const text = words.map((w) =>
          w.BlockType === 'SELECTION_ELEMENT' ? (w.SelectionStatus === 'SELECTED' ? '☑' : '☐') : w.Text ?? '').join(' ');
        rows[(cell.RowIndex ?? 1) - 1][(cell.ColumnIndex ?? 1) - 1] = {
          text: text.trim(),
          confidence: Math.round(cell.Confidence ?? 0),
          header: (cell.EntityTypes ?? []).includes('COLUMN_HEADER'),
        };
      }
      return { rows, confidence: Math.round(table.Confidence ?? 0) };
    })
    .filter((t) => t.rows.length > 0);
}

/** AnalyzeExpense's reading: who sent it, which docket, and one entry per line item. */
export function expenseFromDocuments(documents: ExpenseDocument[]): ExpenseReading {
  const summary = new Map<string, string>();
  const items: LineItem[] = [];
  for (const doc of documents) {
    for (const field of doc.SummaryFields ?? []) {
      const type = field.Type?.Text;
      const value = field.ValueDetection?.Text;
      if (type && value && !summary.has(type)) summary.set(type, value);
    }
    for (const group of doc.LineItemGroups ?? []) {
      for (const line of group.LineItems ?? []) {
        const fields = new Map<string, { text: string; confidence: number }>();
        for (const f of line.LineItemExpenseFields ?? []) {
          const type = f.Type?.Text;
          if (type && f.ValueDetection?.Text && !fields.has(type)) {
            fields.set(type, { text: f.ValueDetection.Text, confidence: f.ValueDetection.Confidence ?? 0 });
          }
        }
        const pick = (type: string) => fields.get(type)?.text ?? null;
        const used = ['PRODUCT_CODE', 'ITEM', 'QUANTITY', 'UNIT_PRICE', 'PRICE'].filter((t) => fields.has(t));
        items.push({
          code: pick('PRODUCT_CODE'),
          item: pick('ITEM'),
          quantity: pick('QUANTITY'),
          unitPrice: pick('UNIT_PRICE'),
          price: pick('PRICE'),
          row: pick('EXPENSE_ROW'),
          confidence: Math.round(Math.min(100, ...used.map((t) => fields.get(t)!.confidence))),
        });
      }
    }
  }
  return {
    vendor: summary.get('VENDOR_NAME') ?? summary.get('NAME') ?? null,
    docketNumber: summary.get('INVOICE_RECEIPT_ID') ?? summary.get('PO_NUMBER') ?? null,
    date: summary.get('INVOICE_RECEIPT_DATE') ?? summary.get('DELIVERY_DATE') ?? null,
    items,
  };
}
