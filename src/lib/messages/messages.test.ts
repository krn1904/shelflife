import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGE_MAX_LENGTH,
  formatSentAt,
  messagesShownTo,
  readCountLabel,
  readSummary,
  sentSince,
  unreadMessages,
  validateMessageBody,
} from './messages';

test('only staff receive site messages', () => {
  assert.equal(messagesShownTo('staff'), true);
  for (const role of ['manager', 'owner', 'platform_admin'] as const) {
    assert.equal(messagesShownTo(role), false, role);
  }
});

test('a message is trimmed, and must have something in it', () => {
  assert.deepEqual(validateMessageBody('  Fridge 3 off at 2pm  '), { ok: true, body: 'Fridge 3 off at 2pm' });
  for (const empty of ['', '   \n ', null, undefined, 42]) {
    assert.equal(validateMessageBody(empty).ok, false, String(empty));
  }
});

test('a message may be up to the limit, not past it', () => {
  assert.equal(validateMessageBody('x'.repeat(MESSAGE_MAX_LENGTH)).ok, true);
  const over = validateMessageBody('x'.repeat(MESSAGE_MAX_LENGTH + 1));
  assert.equal(over.ok, false);
  assert.match(over.ok ? '' : over.message, /501/);
});

test('unread is everything not yet acknowledged, order kept', () => {
  const messages = [{ id: 'c' }, { id: 'b' }, { id: 'a' }];
  assert.deepEqual(unreadMessages(messages, ['b']), [{ id: 'c' }, { id: 'a' }]);
  assert.deepEqual(unreadMessages(messages, []), messages);
  assert.deepEqual(unreadMessages(messages, ['a', 'b', 'c']), []);
});

const JOINED = '2026-01-01T00:00:00Z';
const SENT = '2026-10-05T09:00:00Z';

test('staff see only messages sent since they joined the site', () => {
  assert.equal(sentSince(SENT, JOINED), true);
  assert.equal(sentSince(SENT, SENT), true, 'sent the moment they joined');
  assert.equal(sentSince('2025-06-01T00:00:00Z', JOINED), false, 'a year-old note stays hidden');
});

test('read summary splits current staff into read and waiting, by name', () => {
  const staff = [
    { userId: 'u3', name: 'Zoe', joinedAt: JOINED },
    { userId: 'u1', name: 'Ali', joinedAt: JOINED },
    { userId: 'u2', name: 'Mei', joinedAt: JOINED },
  ];
  // u9 read it but has since left the site: not counted.
  const summary = readSummary(staff, ['u2', 'u3', 'u9'], SENT);
  assert.deepEqual(summary.read.map((r) => r.name), ['Mei', 'Zoe']);
  assert.deepEqual(summary.waiting.map((r) => r.name), ['Ali']);
  assert.equal(summary.total, 3);
  assert.equal(readCountLabel(summary), 'Read by 2 of 3');
});

test('someone who joined after a message is not counted as waiting on it', () => {
  const staff = [
    { userId: 'old', name: 'Ali', joinedAt: JOINED },
    { userId: 'new', name: 'Bo', joinedAt: '2026-10-06T00:00:00Z' },
  ];
  const summary = readSummary(staff, ['old'], SENT);
  assert.deepEqual(summary.waiting, []);
  assert.equal(summary.total, 1);
  assert.equal(readCountLabel(summary), 'Read');
  assert.equal(summary.joinedLater, 1);

  // Sent before anyone now on staff joined: nobody to read it, but the site isn't empty.
  const early = readSummary(staff, [], '2025-06-01T00:00:00Z');
  assert.equal(readCountLabel(early), 'Sent before current staff joined');
});

test('read count label covers everyone, one person and nobody', () => {
  const two = [{ userId: 'a', name: 'A', joinedAt: JOINED }, { userId: 'b', name: 'B', joinedAt: JOINED }];
  assert.equal(readCountLabel(readSummary(two, ['a', 'b'], SENT)), 'Read by all 2');
  assert.equal(readCountLabel(readSummary(two.slice(0, 1), ['a'], SENT)), 'Read');
  assert.equal(readCountLabel(readSummary([], [], SENT)), 'No staff at this site yet');
});

test('sent time is on the site clock, "Today" only for the site\'s own today', () => {
  // A send just after Melbourne midnight is still the evening before in Perth.
  const sent = '2026-10-05T14:30:00Z'; // Melbourne (UTC+11 in October): 6 Oct 1:30 am. Perth: 5 Oct 10:30 pm.
  const now = new Date('2026-10-05T23:00:00Z'); // Melbourne 6 Oct 10 am; Perth 6 Oct 7 am.
  assert.equal(formatSentAt(sent, 'Australia/Melbourne', now), 'Today 1:30 am');
  assert.equal(formatSentAt(sent, 'Australia/Perth', now), 'Mon 5 Oct, 10:30 pm');
});
