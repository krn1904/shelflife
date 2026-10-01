import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeTables, likelyProductTable, readingFrom } from './reading';

const table = (rows: string[][], header = true) =>
  rows.map((row, r) => row.map((text) => ({ text, confidence: 97, header: header && r === 0 })));

test('picks the product table over letterhead and totals tables', () => {
  const found = describeTables([
    table([['Customer #', '256582'], ['Route', 'MELO11']], false),
    table([['Code', 'Description', 'Qty'], ['101204', 'Pura Milk 2L', '12'], ['101206', 'Pura Light 2L', '6']]),
    table([['Subtotal', '$120.00'], ['GST', '$0.00'], ['Total', '$120.00']], false),
  ]);
  assert.deepEqual(found.map((t) => t.products), [false, true, false]);
  assert.equal(likelyProductTable(found), 1);
  assert.equal(likelyProductTable([]), -1);
});

test('a stored reading that no longer fits the shape is ignored, not trusted', () => {
  assert.equal(readingFrom(null), null);
  assert.equal(readingFrom({ engine: 'other', text: [], table: null }), null);
  assert.deepEqual(readingFrom({ engine: 'tesseract', text: ['a'], table: null }), { engine: 'tesseract', text: ['a'], table: null });
});
