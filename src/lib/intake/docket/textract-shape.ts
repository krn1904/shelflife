import type { Block } from '@aws-sdk/client-textract';

/**
 * Textract answers in a graph of blocks (pages, lines, words, tables, cells). These turn
 * it into the plain shapes the screen shows, with no SDK calls, so they can be tested
 * against recorded responses.
 */

export type Cell = { text: string; confidence: number; header: boolean };
export type Table = { rows: Cell[][]; confidence: number };

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

/** Every line of printed text, in Textract's reading order (top to bottom). */
export function textLinesFromBlocks(blocks: Block[]): string[] {
  return blocks
    .filter((b) => b.BlockType === 'LINE' && b.Text?.trim())
    .map((b) => b.Text!.trim());
}
