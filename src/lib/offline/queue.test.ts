import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_ATTEMPTS,
  backoffMs,
  classifyFailure,
  pendingCount,
  replayOrder,
  stuck,
  type OutboxEntry,
} from './queue';

function entry(partial: Partial<OutboxEntry>): OutboxEntry {
  return {
    clientId: 'c1',
    kind: 'waste',
    payload: {},
    queuedAt: 1000,
    attempts: 0,
    lastError: null,
    ...partial,
  };
}

test('replays oldest first', () => {
  // Two write-offs against one batch must land in the order they were made, or the second
  // is rejected for exceeding a quantity the first had not yet taken away.
  const order = replayOrder([
    entry({ clientId: 'c', queuedAt: 3000 }),
    entry({ clientId: 'a', queuedAt: 1000 }),
    entry({ clientId: 'b', queuedAt: 2000 }),
  ]);
  assert.deepEqual(order.map((e) => e.clientId), ['a', 'b', 'c']);
});

test('same-millisecond entries still get a stable order', () => {
  const order = replayOrder([
    entry({ clientId: 'z', queuedAt: 1000 }),
    entry({ clientId: 'a', queuedAt: 1000 }),
  ]);
  assert.deepEqual(order.map((e) => e.clientId), ['a', 'z']);
});

test('replayOrder does not mutate its input', () => {
  const input = [entry({ clientId: 'b', queuedAt: 2000 }), entry({ clientId: 'a', queuedAt: 1000 })];
  replayOrder(input);
  assert.deepEqual(input.map((e) => e.clientId), ['b', 'a']);
});

test('a network failure is retried; a rejection the server reasoned about is not', () => {
  const transient = classifyFailure(entry({}), { permanent: false, message: 'offline' });
  assert.equal(transient.status, 'retry');

  // Retrying a permanent rejection forever blocks every later write behind it.
  const permanent = classifyFailure(entry({}), { permanent: true, message: 'batch not found' });
  assert.equal(permanent.status, 'give-up');
});

test('a transient failure eventually gives up rather than retrying forever', () => {
  const last = classifyFailure(entry({ attempts: MAX_ATTEMPTS - 1 }), {
    permanent: false,
    message: 'offline',
  });
  assert.equal(last.status, 'give-up');
  assert.match(last.status === 'give-up' ? last.reason : '', /after 8 attempts/);
});

test('backoff grows and then stops growing', () => {
  assert.equal(backoffMs(0), 1000);
  assert.equal(backoffMs(3), 8000);
  assert.equal(backoffMs(99), 5 * 60 * 1000);
});

test('the pending count excludes entries that have given up', () => {
  // The indicator says "N changes pending"; counting dead entries in it would mean a
  // number that never reaches zero.
  const entries = [entry({ clientId: 'a' }), entry({ clientId: 'b', attempts: MAX_ATTEMPTS })];
  assert.equal(pendingCount(entries), 1);
  assert.deepEqual(stuck(entries).map((e) => e.clientId), ['b']);
});
