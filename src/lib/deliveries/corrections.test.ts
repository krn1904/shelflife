import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkCorrection,
  correctionError,
  isCalendarDate,
  isUnchanged,
  LineCorrection,
  productReviewFrom,
  removesLine,
  undatedQty,
} from './corrections';

const LINE = '11111111-1111-4111-8111-111111111111';
const BATCH_A = '22222222-2222-4222-8222-222222222222';
const BATCH_B = '33333333-3333-4333-8333-333333333333';
const PRODUCT = '44444444-4444-4444-8444-444444444444';
const SITE = '55555555-5555-4555-8555-555555555555';

const correction = (over: object = {}) => LineCorrection.parse({
  line_id: LINE, qty_docketed: 12, qty_received: 12, batches: [], ...over,
});

test('expiry dates must be real calendar days', () => {
  assert.equal(isCalendarDate('2026-10-14'), true);
  assert.equal(isCalendarDate('2028-02-29'), true);
  assert.equal(isCalendarDate('2026-02-29'), false);
  assert.equal(isCalendarDate('2026-13-01'), false);
  assert.equal(isCalendarDate('14/10/2026'), false);
});

test('a correction from the form is coerced and checked for shape', () => {
  const parsed = LineCorrection.safeParse({
    line_id: LINE, qty_docketed: '12', qty_received: '10',
    batches: [{ id: null, expiry_date: '2026-10-20', qty: '10' }],
  });
  assert.equal(parsed.success, true);
  assert.equal(parsed.success && parsed.data.qty_received, 10);

  assert.equal(LineCorrection.safeParse({ line_id: LINE, qty_docketed: -1, qty_received: 0, batches: [] }).success, false);
  assert.equal(LineCorrection.safeParse({ line_id: LINE, qty_docketed: 1, qty_received: 10000, batches: [] }).success, false);
  assert.equal(LineCorrection.safeParse({ line_id: 'not-a-line', qty_docketed: 1, qty_received: 1, batches: [] }).success, false);
  // A date with nothing on it is a mistake, not a batch.
  assert.equal(LineCorrection.safeParse({
    line_id: LINE, qty_docketed: 1, qty_received: 1, batches: [{ id: null, expiry_date: '2026-10-20', qty: 0 }],
  }).success, false);
});

test('dates may cover less than arrived, never more', () => {
  const under = correction({ qty_received: 12, batches: [{ id: BATCH_A, expiry_date: '2026-10-20', qty: 8 }] });
  assert.deepEqual(checkCorrection(under, 'batch'), { ok: true });

  const over = correction({
    qty_received: 10,
    batches: [{ id: BATCH_A, expiry_date: '2026-10-20', qty: 8 }, { id: null, expiry_date: '2026-10-27', qty: 4 }],
  });
  assert.deepEqual(checkCorrection(over, 'batch'), { ok: false, message: 'The dates add up to 12, but only 10 arrived.' });
});

test('only dated stock carries dates, and one batch is listed once', () => {
  const dated = correction({ batches: [{ id: null, expiry_date: '2026-10-20', qty: 12 }] });
  assert.equal(checkCorrection(dated, 'rotation').ok, false);
  assert.equal(checkCorrection(dated, 'none').ok, false);
  assert.equal(checkCorrection(correction(), 'rotation').ok, true);

  const twice = correction({
    batches: [{ id: BATCH_A, expiry_date: '2026-10-20', qty: 6 }, { id: BATCH_A, expiry_date: '2026-10-27', qty: 6 }],
  });
  assert.deepEqual(checkCorrection(twice, 'batch'), { ok: false, message: 'The same stock is listed twice.' });
});

test('undated stock is what arrived beyond the dates', () => {
  assert.equal(undatedQty(12, [{ qty: 8 }]), 4);
  assert.equal(undatedQty(12, []), 12);
  assert.equal(undatedQty(5, [{ qty: 8 }]), 0);
});

test('a correction that changes nothing is recognised, so nothing is written', () => {
  const current = { qtyDocketed: 12, qtyReceived: 12, batches: [{ id: BATCH_A, expiryDate: '2026-10-20', qty: 12 }] };
  assert.equal(isUnchanged(current, correction({ batches: [{ id: BATCH_A, expiry_date: '2026-10-20', qty: 12 }] })), true);
  assert.equal(isUnchanged(current, correction({ batches: [{ id: BATCH_A, expiry_date: '2026-10-21', qty: 12 }] })), false);
  assert.equal(isUnchanged(current, correction({ qty_received: 11, batches: [{ id: BATCH_A, expiry_date: '2026-10-20', qty: 11 }] })), false);
  assert.equal(isUnchanged(current, correction({ batches: [] })), false);
  assert.equal(isUnchanged(current, correction({
    batches: [{ id: BATCH_B, expiry_date: '2026-10-20', qty: 12 }],
  })), false);
});

test('zero on the docket and zero received removes the line', () => {
  assert.equal(removesLine({ qty_docketed: 0, qty_received: 0 }), true);
  assert.equal(removesLine({ qty_docketed: 6, qty_received: 0 }), false);
});

test('database refusals read as sentences; codes nobody can act on are named', () => {
  assert.equal(correctionError({ code: '23514', message: '3 of the stock dated 2026-10-20 has already left the shelf' }),
    '3 of the stock dated 2026-10-20 has already left the shelf.');
  assert.equal(correctionError({ code: '42501', message: 'not permitted to correct this delivery' }), 'You cannot change this delivery.');
  assert.equal(correctionError({ code: '08006', message: 'connection failure' }), 'Could not save that (08006).');
  assert.equal(correctionError(null), 'Could not save that.');
});

function reviewForm(fields: Record<string, string>) {
  const form = new FormData();
  const all = { product_id: PRODUCT, site_id: SITE, name: 'Bega Tasty Cheese Slices 500g', tracking_mode: 'batch', ...fields };
  for (const [k, v] of Object.entries(all)) form.set(k, v);
  return productReviewFrom(form);
}

test('a product review reads blanks as unset and tidies the barcode', () => {
  const parsed = reviewForm({ brand: '  ', size: '500g', barcode: '9300 6170 1234 4', default_shelf_life_days: '' });
  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.equal(parsed.data.brand, null);
  assert.equal(parsed.data.default_shelf_life_days, null);
  assert.equal(parsed.data.barcode, '9300617012344');
});

test('a product review refuses a bad barcode, a missing name, and rotation with no fixture', () => {
  assert.equal(reviewForm({ barcode: '9300617012340' }).success, false);
  assert.equal(reviewForm({ name: 'x' }).success, false);

  const rotation = reviewForm({ tracking_mode: 'rotation' });
  assert.equal(rotation.success, false);
  assert.match(rotation.error?.issues[0]?.message ?? '', /fixture/);
  assert.equal(reviewForm({ tracking_mode: 'rotation', fixture: 'Dairy fridge' }).success, true);
});
