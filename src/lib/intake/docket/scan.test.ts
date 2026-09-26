import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftFromTable, suggestProductTable } from './scan';
import type { Table } from './textract-shape';

const table = (rows: string[][], headerRow = -1): Table => ({
  confidence: 95,
  rows: rows.map((r, i) => r.map((text) => ({ text, confidence: 95, header: i === headerRow }))),
});

// The three tables Textract found on the Bega docket, in the order it returned them.
const contact = table([['General Enquiries:', '1800 000 570'], ['Sales Order:', '0121921865']]);
const details = table([['Delivery Date', '23/09/2026', ''], ['Customer #:', '256582', '']]);
const products = table([
  ['Delivery #', 'Crates/ Cartons', 'Eaches', 'Product Code', 'Product Description', 'Ordered', 'Picked', 'Delivered'],
  ['0827408699', '2', '0', '3024 I EA', 'EA I Pura Milk 2Lt Bottle', '18', '18', ''],
  ['0827408699', '1', '0', '4908 I EA', 'EA I DF Protein Smoothie Banana Hny 400mL (6)', '', '6', '6'],
  ['', '11', '4', '', '', '', '85', '85'],
  ['', '', '', '', '', '', '', ''],
], 0);

test('suggests the table whose headings name products and quantities, wherever it is', () => {
  assert.equal(suggestProductTable([contact, details, products]), 2);
  assert.equal(suggestProductTable([products, contact]), 0);
});

test('suggests nothing when no table has product and quantity headings', () => {
  assert.equal(suggestProductTable([contact, details]), null);
  assert.equal(suggestProductTable([]), null);
});

test('PFD style: one "Code Description" column still counts as a description', () => {
  const pfd = table([
    ['Code Description', 'UM', 'Qty Ordered', 'Qty Supplied', 'Price'],
    ['FREEZER', '', '', '', ''],
    ['☑ 282178 175GX12 CHUNK ANGUS', 'EA', '1.00', '1.00', '41.77'],
  ], 0);
  const totals = table([['Net Line Total', '$594.71'], ['TOTAL GST', '$59.89']]);
  assert.equal(suggestProductTable([pfd, totals]), 0);
});

test('the draft keeps the headings and every row with anything in it', () => {
  const draft = draftFromTable(products);
  assert.deepEqual(draft.columns, ['Delivery #', 'Crates/ Cartons', 'Eaches', 'Product Code',
    'Product Description', 'Ordered', 'Picked', 'Delivered']);
  // The totals row is kept (the operator removes it); the blank row is not.
  assert.equal(draft.rows.length, 3);
  assert.equal(draft.rows[0][4], 'EA I Pura Milk 2Lt Bottle');
});

test('a table without flagged headings uses its first row, and names empty headings', () => {
  const draft = draftFromTable(table([['Item', '', 'Qty'], ['Milk', 'x', '2']]));
  assert.deepEqual(draft.columns, ['Item', 'Column 2', 'Qty']);
  assert.deepEqual(draft.rows, [['Milk', 'x', '2']]);
});
