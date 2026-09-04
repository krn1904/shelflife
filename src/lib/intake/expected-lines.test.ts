import { test } from 'node:test';
import assert from 'node:assert/strict';
import { expectedLines, type HistoryLine } from './expected-lines';

// Three deliveries, newest first. Milk comes every time, bread twice, energy drinks once.
const history: HistoryLine[] = [
  { deliveryId: 'd3', productId: 'milk', qtyReceived: 8 },
  { deliveryId: 'd3', productId: 'bread', qtyReceived: 4 },
  { deliveryId: 'd2', productId: 'milk', qtyReceived: 6 },
  { deliveryId: 'd2', productId: 'bread', qtyReceived: 5 },
  { deliveryId: 'd2', productId: 'energy', qtyReceived: 2 },
  { deliveryId: 'd1', productId: 'milk', qtyReceived: 6 },
];

test('ranks the reliable lines above the one-offs', () => {
  const lines = expectedLines(history);
  assert.deepEqual(lines.map((l) => l.productId), ['milk', 'bread', 'energy']);
  assert.deepEqual(lines.map((l) => l.seenInDeliveries), [3, 2, 1]);
});

test('pre-fills the most recent quantity, not an average', () => {
  // Ranging drifts; last week's count is a better guess than the mean of three months.
  const lines = expectedLines(history);
  assert.equal(lines.find((l) => l.productId === 'milk')?.qtyDocketed, 8);
  assert.equal(lines.find((l) => l.productId === 'bread')?.qtyDocketed, 4);
});

test('counts deliveries, not lines', () => {
  // A product split across two lines of one docket was still seen in one delivery.
  const split: HistoryLine[] = [
    { deliveryId: 'd1', productId: 'coke', qtyReceived: 3 },
    { deliveryId: 'd1', productId: 'coke', qtyReceived: 2 },
  ];
  assert.deepEqual(expectedLines(split), [
    { productId: 'coke', qtyDocketed: 3, seenInDeliveries: 1 },
  ]);
});

test('a first delivery from a supplier yields an empty tick-list', () => {
  assert.deepEqual(expectedLines([]), []);
});

test('ordering is stable when frequency and quantity tie', () => {
  const tied: HistoryLine[] = [
    { deliveryId: 'd1', productId: 'zebra', qtyReceived: 1 },
    { deliveryId: 'd1', productId: 'apple', qtyReceived: 1 },
  ];
  assert.deepEqual(expectedLines(tied).map((l) => l.productId), ['apple', 'zebra']);
});
