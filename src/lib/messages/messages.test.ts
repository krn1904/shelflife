import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGE_MAX_LENGTH,
  formatSentAt,
  messagesShownTo,
  readCountLabel,
  readSummary,
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

test('read summary splits current staff into read and waiting, by name', () => {
  const staff = [
    { userId: 'u3', name: 'Zoe' },
    { userId: 'u1', name: 'Ali' },
    { userId: 'u2', name: 'Mei' },
  ];
  // u9 read it but has since left the site: not counted.
  const summary = readSummary(staff, ['u2', 'u3', 'u9']);
  assert.deepEqual(summary.read.map((r) => r.name), ['Mei', 'Zoe']);
  assert.deepEqual(summary.waiting.map((r) => r.name), ['Ali']);
  assert.equal(summary.total, 3);
  assert.equal(readCountLabel(summary), 'Read by 2 of 3');
});

test('read count label covers everyone, one person and nobody', () => {
  const two = [{ userId: 'a', name: 'A' }, { userId: 'b', name: 'B' }];
  assert.equal(readCountLabel(readSummary(two, ['a', 'b'])), 'Read by all 2');
  assert.equal(readCountLabel(readSummary(two.slice(0, 1), ['a'])), 'Read');
  assert.equal(readCountLabel(readSummary([], [])), 'No staff at this site yet');
});

test('sent time is on the site clock, "Today" only for the site\'s own today', () => {
  // A send just after Melbourne midnight is still the evening before in Perth.
  const sent = '2026-10-05T14:30:00Z'; // Melbourne (UTC+11 in October): 6 Oct 1:30 am. Perth: 5 Oct 10:30 pm.
  const now = new Date('2026-10-05T23:00:00Z'); // Melbourne 6 Oct 10 am; Perth 6 Oct 7 am.
  assert.equal(formatSentAt(sent, 'Australia/Melbourne', now), 'Today 1:30 am');
  assert.equal(formatSentAt(sent, 'Australia/Perth', now), 'Mon 5 Oct, 10:30 pm');
});
