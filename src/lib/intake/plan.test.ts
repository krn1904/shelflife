import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DocketLine, TableCell } from './docket/parse';
import { parseReading, type DocketReading } from './docket/reading';
import {
  ClosingLines,
  docketRows,
  intakePayload,
  intakeSummary,
  LINKED_AT,
  planDelivery,
  readableSize,
  recordable,
  type IntakeProduct,
  type ScreenRow,
} from './plan';
import type { TrackingMode } from '@/lib/supabase/types';

// ---------------------------------------------------------------------------------------
// Helpers

const product = (id: string, name: string, trackingMode: TrackingMode = 'batch'): IntakeProduct => ({
  productId: id, name, brand: null, size: null, trackingMode,
  proposal: { date: null, source: 'manual', basis: 'none' },
});

const line = (source: number, text: string, extra: Partial<DocketLine> = {}): DocketLine => ({
  source, text, productId: null, productName: null, confidence: 0, via: 'new product?',
  pack: null, size: null, ordered: 5, supplied: 5, qtyHow: 'by heading',
  cartons: null, eaches: null, check: null, code: null, ...extra,
});

const productsOf = (...list: IntakeProduct[]) => new Map(list.map((p) => [p.productId, p]));

// ---------------------------------------------------------------------------------------
// Docket rows: linked only when certain, otherwise the OCR is trusted

test('a strong name match links the row to the catalogue product', () => {
  const [row] = docketRows(
    [line(1, 'EA I Pura Light Start 2Lt Bottle', { productId: 'light', confidence: LINKED_AT, via: 'name' })],
    productsOf(product('light', 'Pura Light Milk 2L')),
  );
  assert.equal(row.product?.productId, 'light');
  assert.equal(row.suggestion, null);
});

test('a barcode links the row whatever the name score', () => {
  const [row] = docketRows(
    [line(1, '9300617000014', { productId: 'coke', confidence: 0.2, via: 'barcode' })],
    productsOf(product('coke', 'Coca-Cola 600ml')),
  );
  assert.equal(row.product?.productId, 'coke');
});

test('a weaker match only suggests; the row keeps the docket name, trusted as printed', () => {
  const [row] = docketRows(
    [line(1, 'EA I Pura Milk 2Lt Bottle', { productId: 'light', confidence: 0.7, via: 'name' })],
    productsOf(product('light', 'Pura Light Milk 2L')),
  );
  assert.equal(row.product, null);
  assert.equal(row.suggestion?.productId, 'light');
  assert.equal(row.name, 'Pura Milk 2Lt Bottle');
  assert.equal(row.docketText, 'EA I Pura Milk 2Lt Bottle');
});

test('a row with no catalogue match is a new item with nothing suggested', () => {
  const [row] = docketRows([line(1, 'EA I Dare Double Espresso 750ml BTL (6)')], productsOf());
  assert.deepEqual([row.product, row.suggestion, row.name], [null, null, 'Dare Double Espresso 750ml BTL (6)']);
});

test('two rows are never folded into one product: the second only gets a suggestion', () => {
  const rows = docketRows(
    [
      line(1, 'Pura Light Start 2Lt', { productId: 'light', confidence: 0.95, via: 'name' }),
      line(2, 'Pura Light 2L Bottle', { productId: 'light', confidence: 0.9, via: 'name' }),
    ],
    productsOf(product('light', 'Pura Light Milk 2L')),
  );
  assert.deepEqual(rows.map((r) => [r.key, r.product?.productId ?? null, r.suggestion?.productId ?? null]), [
    ['row-1', 'light', null],
    ['row-2', null, 'light'],
  ]);
});

test('quantities: printed Ordered is the docket figure, Supplied is the count', () => {
  const [short, noCount, capped] = docketRows([
    line(1, 'Pura Milk 2L', { ordered: 18, supplied: 12 }),
    line(2, 'Dare Espresso 500ml', { ordered: null, supplied: null }),
    line(3, 'Mars Bar 53g', { ordered: 20000, supplied: 20000 }),
  ], productsOf());
  assert.deepEqual([short.qtyDocketed, short.qtyReceived, short.unsure], [18, 12, false]);
  // Nothing readable: zero, and flagged for the operator to count.
  assert.deepEqual([noCount.qtyDocketed, noCount.qtyReceived, noCount.unsure], [0, 0, true]);
  assert.deepEqual([capped.qtyDocketed, capped.qtyReceived], [9999, 9999]);
});

test('a reader in doubt, or cartons that disagree with the count, mark the row to check', () => {
  const rows = docketRows([
    line(1, 'Pura Milk 2L', { unsure: true }),
    line(2, 'Dare Mocha 500ml', { check: 'disagrees' }),
    line(3, 'Dare Espresso 500ml', { check: 'agrees' }),
  ], productsOf());
  assert.deepEqual(rows.map((r) => r.unsure), [true, true, false]);
});

// ---------------------------------------------------------------------------------------
// End to end: the real Bega docket table, against a catalogue without most of its products

const BEGA: string[][] = [
  ['Delivery #', 'Crates/ Cartons', 'Eaches', 'Product Code', 'Product Description', 'Ordered', 'Picked', 'Delivered'],
  ['0827408699', '2', '0', '3024 I EA', 'EA I Pura Milk 2Lt Bottle', '18', '', ''],
  ['', '1', '3', '3278 EA', 'EA I Pura Light Start 2Lt Bottle', '9', '', ''],
  ['', '1', '6', '5366 I EA', 'EA I Dairy Choice Whole Milk 2L HDPE Bottle', '18', '', ''],
  ['', '1', '0', '7774 EA', 'EA I Dare Double Espresso 750ml BTL (6)', '6', '', ''],
  ['', '0', '2', '1141 I EA', 'EA I FUnion Natrl Greek Style Yogurt 1kg (6)', '2', '', ''],
  ['', '11', '4', '', '', '85', '85', ''],
];
const reading: DocketReading = {
  engine: 'textract',
  text: ['ROUTE TRANSPORT', 'DAILY DELIVERY DOCKET', 'Metro Petroleum Truganina'],
  table: BEGA.map((row, r): TableCell[] => row.map((text) => ({ text, confidence: 95, header: r === 0 }))),
};
const SHARED = [
  { id: 'pura-light-2l', name: 'Pura Light Milk 2L' },
  { id: 'pura-fc-1l', name: 'Pura Full Cream Milk 1L' },
  { id: 'v-green', name: 'V Green 355ml' },
  { id: 'chobani', name: 'Chobani Greek Yoghurt Vanilla 170g' },
];
const rowsFor = (catalogue: { id: string; name: string }[]) =>
  docketRows(parseReading(reading, catalogue).lines, productsOf(...catalogue.map((p) => product(p.id, p.name))));

test('Bega docket: every product row becomes a line; only the certain one is linked', () => {
  const rows = rowsFor(SHARED);
  assert.deepEqual(rows.map((r) => r.name), [
    'Pura Milk 2Lt Bottle',
    'Pura Light Start 2Lt Bottle',
    'Dairy Choice Whole Milk 2L HDPE Bottle',
    'Dare Double Espresso 750ml BTL (6)',
    'FUnion Natrl Greek Style Yogurt 1kg (6)',
  ]);
  assert.deepEqual(rows.map((r) => r.product?.productId ?? null), [null, 'pura-light-2l', null, null, null]);
  // Full cream is not forced onto the light milk: it is only offered.
  assert.equal(rows[0].suggestion?.productId, 'pura-light-2l');
  // "Greek" is not "Green", and 1kg is not 355ml.
  assert.equal(rows[4].suggestion, null);
  assert.deepEqual(rows.map((r) => r.qtyDocketed), [18, 9, 18, 6, 2]);
});

test('Bega docket: once its new items exist, the next docket links every row', () => {
  // What closing the first delivery added: the docket's own names, as the organisation's products.
  const learned = rowsFor(SHARED).filter((r) => !r.product).map((r, i) => ({ id: `new-${i}`, name: r.name }));
  const rows = rowsFor([...SHARED, ...learned]);
  assert.equal(rows.every((r) => r.product !== null), true, rows.map((r) => `${r.name} → ${r.product?.name}`).join('\n'));
  assert.equal(rows[0].product?.name, 'Pura Milk 2Lt Bottle');
});

// ---------------------------------------------------------------------------------------
// Closing a delivery

test('sizes are stored the way the catalogue writes them', () => {
  assert.deepEqual(['2000ml', '1250ml', '1000g', '750ml', '170g', '2L', null].map(readableSize),
    ['2L', '1.25L', '1kg', '750ml', '170g', '2L', null]);
});

test('records short lines, drops empty ones, and needs something delivered', () => {
  const kept = recordable([
    { qty_received: 5, qty_docketed: 6 },
    { qty_received: 0, qty_docketed: 12 },  // did not arrive: the short-delivery record
    { qty_received: 0, qty_docketed: 0 },   // added by hand, never counted
    { qty_received: 0, qty_docketed: null },
  ]);
  assert.deepEqual(kept.ok && kept.lines.map((l) => l.qty_docketed), [6, 12]);

  const nothing = recordable([{ qty_received: 0, qty_docketed: 12 }]);
  assert.deepEqual(nothing, { ok: false, message: 'Tick at least one line before closing.' });
});

test('rows of one product add into one line, keeping a batch per dated row', () => {
  const tracking = new Map<string, TrackingMode>([['milk', 'batch'], ['bread', 'rotation']]);
  const plan = planDelivery([
    { product_id: 'milk', qty_received: 10, qty_docketed: 12, expiry_date: '2026-10-10', confirmed: true },
    { product_id: 'milk', qty_received: 6, qty_docketed: 6, expiry_date: '2026-10-14', confirmed: false },
    { product_id: 'bread', qty_received: 8, qty_docketed: null, expiry_date: '2026-10-02', confirmed: true },
  ], tracking);
  assert.deepEqual(plan.lines, [
    { productId: 'milk', qtyDocketed: 18, qtyReceived: 16 },
    // No docket read: the count is the docketed figure too.
    { productId: 'bread', qtyDocketed: 8, qtyReceived: 8 },
  ]);
  // Rotation stock never gets a batch, even with a date.
  assert.deepEqual(plan.batches, [
    { productId: 'milk', qty: 10, expiry: '2026-10-10', confirmed: true },
    { productId: 'milk', qty: 6, expiry: '2026-10-14', confirmed: false },
  ]);
});

test('no batch for stock that did not arrive or has no date yet', () => {
  const tracking = new Map<string, TrackingMode>([['milk', 'batch']]);
  const plan = planDelivery([
    { product_id: 'milk', qty_received: 0, qty_docketed: 12, expiry_date: '2026-10-10', confirmed: true },
    { product_id: 'milk', qty_received: 4, qty_docketed: 4, expiry_date: null, confirmed: false },
  ], tracking);
  assert.deepEqual(plan.lines, [{ productId: 'milk', qtyDocketed: 16, qtyReceived: 4 }]);
  assert.deepEqual(plan.batches, []);
});

test('line totals are capped at what a delivery line can hold', () => {
  const plan = planDelivery([
    { product_id: 'milk', qty_received: 9000, qty_docketed: 9000, expiry_date: null, confirmed: false },
    { product_id: 'milk', qty_received: 9000, qty_docketed: 9000, expiry_date: null, confirmed: false },
  ], new Map());
  assert.deepEqual(plan.lines, [{ productId: 'milk', qtyDocketed: 9999, qtyReceived: 9999 }]);
});

// ---------------------------------------------------------------------------------------
// The intake screen

const row = (extra: Partial<ScreenRow>): ScreenRow => ({
  product: { productId: '5f6c0bb4-7c1b-4b2a-9a51-2f7e3c6b8d10', trackingMode: 'batch' },
  name: 'Pura Milk 2L', newTracking: 'batch', ticked: true, qty: 6, expiry: '2026-10-10',
  confirmed: true, docketed: 6, fromDocket: true, ...extra,
});

test('an unticked docket line is still sent, as 0 received against its docket figure', () => {
  const payload = intakePayload([row({ ticked: false })], true);
  assert.deepEqual(payload.map((l) => [l.qty_received, l.qty_docketed, l.expiry_date]), [[0, 6, null]]);
});

test('an unticked line predicted from history is simply left out', () => {
  assert.deepEqual(intakePayload([row({ ticked: false, fromDocket: false, docketed: null })], false), []);
});

test('a new item is sent by its trimmed name and kind; a known one by product id', () => {
  const [known, fresh] = intakePayload([
    row({}),
    row({ product: null, name: '  Dare Espresso 500ml  ', newTracking: 'rotation', expiry: '2026-10-10' }),
  ], true);
  assert.deepEqual([known.product_id, known.new_product], ['5f6c0bb4-7c1b-4b2a-9a51-2f7e3c6b8d10', null]);
  assert.deepEqual([fresh.product_id, fresh.new_product], [null, { name: 'Dare Espresso 500ml', tracking_mode: 'rotation' }]);
  // Rotation stock carries no date.
  assert.equal(fresh.expiry_date, null);
});

test('docketed figures: 0 for a line added by hand to a read docket, null with no docket', () => {
  assert.equal(intakePayload([row({ docketed: null, fromDocket: false })], true)[0].qty_docketed, 0);
  assert.equal(intakePayload([row({ docketed: null, fromDocket: false })], false)[0].qty_docketed, null);
});

test('the summary counts what needs attention before closing', () => {
  const summary = intakeSummary([
    row({ qty: 4, docketed: 6 }),                                  // short
    row({ expiry: null }),                                         // no date
    row({ product: null, name: ' ', docketed: 2 }),                // new, unnamed (dated)
    row({ product: { productId: 'x', trackingMode: 'rotation' }, expiry: null }), // rotation needs no date
  ]);
  assert.deepEqual(
    [summary.received.length, summary.short.length, summary.undated.length, summary.unnamed.length, summary.newItems.length],
    [4, 1, 1, 1, 1],
  );
});

test('whatever the screen sends, the server accepts', () => {
  const payload = intakePayload([
    row({}),
    row({ ticked: false }),
    row({ product: null, name: 'Dare Espresso 500ml' }),
  ], true);
  assert.equal(ClosingLines.safeParse(payload).success, true);
});

test('the server refuses a line that is both a product and a new item, or neither', () => {
  const base = { qty_received: 1, qty_docketed: 1, expiry_date: null, confirmed: false };
  const both = { ...base, product_id: '5f6c0bb4-7c1b-4b2a-9a51-2f7e3c6b8d10', new_product: { name: 'Milk', tracking_mode: 'batch' } };
  const neither = { ...base, product_id: null, new_product: null };
  assert.equal(ClosingLines.safeParse([both]).success, false);
  assert.equal(ClosingLines.safeParse([neither]).success, false);
  assert.equal(ClosingLines.safeParse([{ ...base, product_id: 'not-a-uuid' }]).success, false);
  assert.equal(ClosingLines.safeParse([{ ...base, product_id: null, new_product: { name: 'X', tracking_mode: 'batch' } }]).success, false);
});
