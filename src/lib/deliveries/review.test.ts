import { test } from 'node:test';
import assert from 'node:assert/strict';
import { atSite, deliveryTotals, lineStatus, openFor, rangeStart, reviewFilters } from './review';

test('a line is ok, short, over, or missing when nothing arrived', () => {
  assert.equal(lineStatus(12, 12), 'ok');
  assert.equal(lineStatus(12, 10), 'short');
  assert.equal(lineStatus(12, 0), 'missing');
  assert.equal(lineStatus(6, 8), 'over');
  // Added by hand with nothing on the docket: over, not missing.
  assert.equal(lineStatus(0, 3), 'over');
  assert.equal(lineStatus(0, 0), 'ok');
});

test('totals count short lines, missing ones among them, and the units that never came', () => {
  const totals = deliveryTotals([
    { qty_docketed: 18, qty_received: 18 },
    { qty_docketed: 12, qty_received: 9 },
    { qty_docketed: 6, qty_received: 0 },
    { qty_docketed: 2, qty_received: 4 },
  ]);
  assert.deepEqual(totals, { lines: 4, docketed: 38, received: 31, short: 2, missing: 1, over: 1, unitsShort: 9 });
});

test('an empty delivery totals to zero', () => {
  assert.deepEqual(deliveryTotals([]), { lines: 0, docketed: 0, received: 0, short: 0, missing: 0, over: 0, unitsShort: 0 });
});

test('filters default to the last 30 days, every supplier, not only short', () => {
  assert.deepEqual(reviewFilters({}), { range: '30d', shortOnly: false, supplierId: null });
});

test('filters read the URL, ignoring anything they do not recognise', () => {
  const supplier = '5f6c0bb4-7c1b-4b2a-9a51-2f7e3c6b8d10';
  assert.deepEqual(reviewFilters({ range: '7d', short: '1', supplier }), { range: '7d', shortOnly: true, supplierId: supplier });
  assert.deepEqual(reviewFilters({ range: '365d', short: 'yes', supplier: "x' or 1=1" }),
    { range: '30d', shortOnly: false, supplierId: null });
  // A repeated key takes its first value.
  assert.equal(reviewFilters({ range: ['90d', '7d'] }).range, '90d');
});

test('a range starts that many days before now', () => {
  const now = new Date('2026-09-30T02:00:00Z');
  assert.equal(rangeStart('7d', now), '2026-09-23T02:00:00.000Z');
  assert.equal(rangeStart('90d', now), '2026-07-02T02:00:00.000Z');
});

test('open time reads in minutes, hours, then days', () => {
  const now = new Date('2026-09-30T12:00:00Z');
  assert.equal(openFor('2026-09-30T11:35:00Z', now), '25 min');
  assert.equal(openFor('2026-09-30T02:00:00Z', now), '10 h');
  assert.equal(openFor('2026-09-26T12:00:00Z', now), '4 days');
  assert.equal(openFor('2026-09-30T12:05:00Z', now), '0 min');
});

test('times show in the store\'s timezone, not the server\'s', () => {
  // 23:30 UTC on the 29th is 9:30am on the 30th in Melbourne.
  assert.match(atSite('2026-09-29T23:30:00Z', 'Australia/Melbourne'), /^30\/09\/2026, 9:30\s?am$/);
  assert.equal(atSite('2026-09-29T23:30:00Z', 'Australia/Melbourne', false), '30/09/2026');
  assert.equal(atSite(null, 'Australia/Melbourne'), '—');
});
