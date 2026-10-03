import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoard, type BoardBatch, type OpenReminder } from './board';

const TODAY = '2026-10-10';

function batch(id: string, expiryDate: string, extra: Partial<BoardBatch> = {}): BoardBatch {
  return { id, expiryDate, qtyRemaining: 3, markedDownOn: null, name: id, detail: '', predicted: false, ...extra };
}

const columnsOf = (board: ReturnType<typeof buildBoard>) =>
  Object.fromEntries(board.columns.map((c) => [c.column, c.cards.map((card) => card.id)]));

test('reminder columns are exactly the open reminders, like the Today list', () => {
  const reminders: OpenReminder[] = [
    { id: 'r1', batchId: 'expired', action: 'pull' },
    { id: 'r2', batchId: 'smoothie', action: 'markdown' },
    { id: 'r3', batchId: 'chips', action: 'check' },
  ];
  const board = buildBoard(
    [batch('expired', '2026-10-09'), batch('smoothie', '2026-10-12'), batch('chips', '2026-11-09')],
    reminders, TODAY, 30,
  );
  assert.deepEqual(columnsOf(board), {
    pull: ['expired'], markdown: ['smoothie'], check: ['chips'], onHalfPrice: [], comingUp: [],
  });
  assert.equal(board.columns[0].cards[0].reminderId, 'r1');
});

test('marked-down stock waits under On half price; the rest within the window is Coming up', () => {
  const board = buildBoard(
    [
      batch('reduced', '2026-10-11', { markedDownOn: '2026-10-09T09:00:00Z' }),
      batch('soon', '2026-10-15'),
      batch('far', '2026-12-25'),
    ],
    [], TODAY, 30,
  );
  assert.deepEqual(columnsOf(board), {
    pull: [], markdown: [], check: [], onHalfPrice: ['reduced'], comingUp: ['soon'],
  });
  assert.equal(board.laterCount, 1); // 'far' is beyond the 30-day window
  assert.equal(board.lookAheadDays, 30);
  assert.equal(board.columns[4].cards[0].reminderId, null);
});

test('a reminder outranks marked-down: a reduced item on its last day is a Last day card', () => {
  const board = buildBoard(
    [batch('reduced', '2026-10-10', { markedDownOn: '2026-10-08T09:00:00Z' })],
    [{ id: 'r', batchId: 'reduced', action: 'pull' }], TODAY, 30,
  );
  assert.deepEqual(columnsOf(board).pull, ['reduced']);
});

test('soonest expiry first in each column', () => {
  const board = buildBoard([batch('b', '2026-10-20'), batch('a', '2026-10-14'), batch('c', '2026-10-30')], [], TODAY, 30);
  assert.deepEqual(columnsOf(board).comingUp, ['a', 'b', 'c']);
  assert.deepEqual(board.columns[4].cards.map((c) => c.daysLeft), [4, 10, 20]);
});

test('stock on or past its date is a Last day card even before the nightly job has run', () => {
  // E.g. straight after a demo time jump, or a failed nightly run: no open reminder yet.
  const board = buildBoard(
    [
      batch('expired', '2026-10-08'),
      batch('today', '2026-10-10', { markedDownOn: '2026-10-08T09:00:00Z' }),
      batch('tomorrow', '2026-10-11'),
    ],
    [], TODAY, 30,
  );
  assert.deepEqual(columnsOf(board).pull, ['expired', 'today']);
  assert.deepEqual(columnsOf(board).comingUp, ['tomorrow']);
  assert.equal(board.columns[0].cards[0].reminderId, null); // answering still works: it goes by batch
});
