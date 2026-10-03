import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bucketFor,
  siteLeague,
  wasteByMonth,
  type WasteRow,
} from './aggregate';

function row(partial: Partial<WasteRow>): WasteRow {
  return {
    wastedAt: '2026-09-04T10:00:00Z',
    reason: 'expired',
    qty: 1,
    valueAud: 10,
    siteId: 's1',
    ...partial,
  };
}

test('months with no waste appear as zero rather than vanishing', () => {
  // The classic version of this chart being wrong: drop the empty months and the line
  // joins two distant points as though the gap were a smooth trend.
  const months = wasteByMonth(
    [row({ wastedAt: '2026-07-15T00:00:00Z', valueAud: 50 })],
    3,
    '2026-09-04',
  );
  assert.deepEqual(months.map((m) => [m.month, m.valueAud]), [
    ['2026-07', 50],
    ['2026-08', 0],
    ['2026-09', 0],
  ]);
});

test('waste outside the window is excluded, not folded into the edge month', () => {
  const months = wasteByMonth(
    [
      row({ wastedAt: '2026-01-15T00:00:00Z', valueAud: 999 }),
      row({ wastedAt: '2026-09-02T00:00:00Z', valueAud: 20 }),
    ],
    3,
    '2026-09-04',
  );
  assert.deepEqual(months.map((m) => m.valueAud), [0, 0, 20]);
  assert.equal(months.reduce((sum, m) => sum + m.valueAud, 0), 20);
});

test('the league table keeps sites that wasted nothing', () => {
  // Omitting them would read as "not measured" rather than "did well".
  const league = siteLeague(
    [{ id: 's1', name: 'Brunswick' }, { id: 's2', name: 'Coburg' }],
    [row({ siteId: 's1', valueAud: 30 })],
  );
  assert.deepEqual(league.map((s) => [s.name, s.valueAud]), [['Brunswick', 30], ['Coburg', 0]]);
});

test('league ties break on name so the order does not jitter between loads', () => {
  const league = siteLeague(
    [{ id: 's2', name: 'Zebra' }, { id: 's1', name: 'Apple' }],
    [],
  );
  assert.deepEqual(league.map((s) => s.name), ['Apple', 'Zebra']);
});

test('expiry board buckets split on the boundaries staff care about', () => {
  assert.equal(bucketFor(-1), 'overdue');
  assert.equal(bucketFor(0), 'today');
  assert.equal(bucketFor(1), 'soon');
  assert.equal(bucketFor(7), 'soon');
  assert.equal(bucketFor(8), 'watch');
  assert.equal(bucketFor(30), 'watch');
});

test('a waste event with no dollar value counts as $0 in its month, not as an error', () => {
  // value_aud is null when neither the site nor the docket gave a cost.
  const months = wasteByMonth([row({ valueAud: null }), row({ valueAud: 12 })], 1, '2026-09-20');
  assert.equal(months[0].valueAud, 12);
});
