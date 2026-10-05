import assert from 'node:assert/strict';
import test from 'node:test';
import { bucketFor } from '@/lib/analytics/aggregate';
import {
  actionTone,
  boardWindow,
  daysLeftShort,
  daysLeftText,
  daysLeftTone,
  orderForShift,
  SOON_DAYS,
} from './display';

test('board pills follow the expiry buckets', () => {
  assert.equal(daysLeftTone(-3), 'critical');
  assert.equal(daysLeftTone(0), 'warning');
  assert.equal(daysLeftTone(1), 'neutral');
  assert.equal(daysLeftTone(7), 'neutral');
  assert.equal(daysLeftTone(8), 'quiet');
});

test('Today pills follow the action', () => {
  assert.equal(actionTone('pull'), 'critical');
  assert.equal(actionTone('markdown'), 'warning');
  assert.equal(actionTone('check'), 'neutral');
});

test('days left reads naturally in both forms', () => {
  assert.equal(daysLeftShort(-1), '−1');
  assert.equal(daysLeftShort(0), '0');
  assert.equal(daysLeftShort(14), '14');
  assert.equal(daysLeftText(-1), 'expired 1 day ago');
  assert.equal(daysLeftText(-4), 'expired 4 days ago');
  assert.equal(daysLeftText(0), 'expires today');
  assert.equal(daysLeftText(1), 'expires in 1 day');
  assert.equal(daysLeftText(2), 'expires in 2 days');
});

test('the shift list puts pulls first, then markdowns, then checks, soonest first', () => {
  const items = [
    { id: 'check-late', action: 'check' as const, dueDate: '2026-10-10' },
    { id: 'markdown', action: 'markdown' as const, dueDate: '2026-10-05' },
    { id: 'pull-later', action: 'pull' as const, dueDate: '2026-10-03' },
    { id: 'check-soon', action: 'check' as const, dueDate: '2026-10-04' },
    { id: 'pull-first', action: 'pull' as const, dueDate: '2026-10-01' },
  ];
  assert.deepEqual(
    orderForShift(items).map((i) => i.id),
    ['pull-first', 'pull-later', 'markdown', 'check-soon', 'check-late'],
  );
  // The input is not reordered in place.
  assert.equal(items[0].id, 'check-late');
});

test('the board window matches the bucket edges, across a month end', () => {
  assert.deepEqual(boardWindow('2026-10-05'), { soonEnd: '2026-10-12', watchEnd: '2026-11-04' });
  assert.deepEqual(boardWindow('2026-12-28'), { soonEnd: '2027-01-04', watchEnd: '2027-01-27' });
  // The last day fetched as urgent is still "soon"; the next one is the first "watch".
  assert.equal(bucketFor(SOON_DAYS), 'soon');
  assert.equal(bucketFor(SOON_DAYS + 1), 'watch');
});
