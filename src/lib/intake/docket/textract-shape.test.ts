import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Block, ExpenseDocument } from '@aws-sdk/client-textract';
import { expenseFromDocuments, tablesFromBlocks, textLinesFromBlocks } from './textract-shape';

// Shaped like Textract's AnalyzeDocument answer for the top of the Bega docket's table.
const word = (id: string, text: string): Block => ({ Id: id, BlockType: 'WORD', Text: text });
const cell = (id: string, row: number, col: number, words: string[], confidence = 95, header = false): Block => ({
  Id: id, BlockType: 'CELL', RowIndex: row, ColumnIndex: col, Confidence: confidence,
  EntityTypes: header ? ['COLUMN_HEADER'] : undefined,
  Relationships: [{ Type: 'CHILD', Ids: words }],
});

const blocks: Block[] = [
  { Id: 't', BlockType: 'TABLE', Confidence: 97.4, Relationships: [{ Type: 'CHILD', Ids: ['c11', 'c12', 'c21', 'c22'] }] },
  cell('c11', 1, 1, ['w1', 'w2'], 99, true),
  cell('c12', 1, 2, ['w3'], 99, true),
  cell('c21', 2, 1, ['w4', 'w5', 'w6', 'w7']),
  cell('c22', 2, 2, ['w8'], 61),
  word('w1', 'Product'), word('w2', 'Description'), word('w3', 'Ordered'),
  word('w4', 'Pura'), word('w5', 'Milk'), word('w6', '2Lt'), word('w7', 'Bottle'), word('w8', '18'),
];

test('rebuilds a table cell by cell, in printed order', () => {
  const [table] = tablesFromBlocks(blocks);
  assert.equal(table.confidence, 97);
  assert.deepEqual(table.rows.map((r) => r.map((c) => c.text)), [
    ['Product Description', 'Ordered'],
    ['Pura Milk 2Lt Bottle', '18'],
  ]);
  assert.equal(table.rows[0][0].header, true);
  assert.equal(table.rows[1][1].confidence, 61);
});

test('a page without tables gives none', () => {
  assert.deepEqual(tablesFromBlocks([word('w', 'hello')]), []);
});

test('reads supplier, docket and line items from the invoice model', () => {
  const documents: ExpenseDocument[] = [{
    SummaryFields: [
      { Type: { Text: 'VENDOR_NAME' }, ValueDetection: { Text: 'Bega Group' } },
      { Type: { Text: 'INVOICE_RECEIPT_ID' }, ValueDetection: { Text: '0121921865' } },
      { Type: { Text: 'INVOICE_RECEIPT_DATE' }, ValueDetection: { Text: '23/09/2026' } },
    ],
    LineItemGroups: [{
      LineItems: [{
        LineItemExpenseFields: [
          { Type: { Text: 'PRODUCT_CODE' }, ValueDetection: { Text: '3024', Confidence: 98 } },
          { Type: { Text: 'ITEM' }, ValueDetection: { Text: 'Pura Milk 2Lt Bottle', Confidence: 96 } },
          { Type: { Text: 'QUANTITY' }, ValueDetection: { Text: '18', Confidence: 72.6 } },
          { Type: { Text: 'EXPENSE_ROW' }, ValueDetection: { Text: '0827408699 2 0 3024|EA Pura Milk 2Lt Bottle 18' } },
        ],
      }],
    }],
  }];
  const reading = expenseFromDocuments(documents);
  assert.deepEqual([reading.vendor, reading.docketNumber, reading.date], ['Bega Group', '0121921865', '23/09/2026']);
  assert.deepEqual(reading.items, [{
    code: '3024', item: 'Pura Milk 2Lt Bottle', quantity: '18', unitPrice: null, price: null,
    row: '0827408699 2 0 3024|EA Pura Milk 2Lt Bottle 18', confidence: 73,
  }]);
});

test('keeps every printed line in reading order, for the letterhead', () => {
  const lines: Block[] = [
    { Id: 'l1', BlockType: 'LINE', Text: 'Bega Dairy and Drinks Pty Ltd' },
    { Id: 'l2', BlockType: 'LINE', Text: '  ' },
    { Id: 'l3', BlockType: 'LINE', Text: 'ABN 51 824 753 556 ' },
    ...blocks,
  ];
  assert.deepEqual(textLinesFromBlocks(lines), ['Bega Dairy and Drinks Pty Ltd', 'ABN 51 824 753 556']);
});
