import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGE_MAX_LENGTH,
  formatSentAt,
  groupThreads,
  messagesShownTo,
  newRepliesLabel,
  readCountLabel,
  readSummary,
  sentSince,
  unreadMessages,
  unreadReplies,
  validateMessageBody,
  validateReplyBody,
  type Reply,
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

test('a reply follows the same rules as a message, in its own words', () => {
  assert.deepEqual(validateReplyBody('  On it  '), { ok: true, body: 'On it' });
  assert.deepEqual(validateReplyBody('   '), { ok: false, message: 'Write a reply first.' });

  const longestAllowed = 'x'.repeat(MESSAGE_MAX_LENGTH);
  assert.equal(validateReplyBody(longestAllowed).ok, true);
  assert.equal(validateReplyBody(longestAllowed + 'x').ok, false);

  assert.deepEqual(
    validateMessageBody(''),
    { ok: false, message: 'Write a message first.' },
    'messages keep their wording',
  );
});

// Sam manages the site; Ava and Ben are on staff. Each has their own thread under one message.
function reply(id: string, staffId: string, authorId: string | null, sentAt: string): Reply {
  return { id, staffId, authorId, body: id, sentAt };
}

function ids(replies: Reply[]): string[] {
  return replies.map((r) => r.id);
}

const AVA_ASKS = reply('ava-1', 'ava', 'ava', '2026-11-25T03:00:00Z');
const SAM_ANSWERS_AVA = reply('sam-1', 'ava', 'sam', '2026-11-25T03:10:00Z');
const AVA_THANKS = reply('ava-2', 'ava', 'ava', '2026-11-25T03:20:00Z');
const BEN_ASKS = reply('ben-1', 'ben', 'ben', '2026-11-25T03:05:00Z');

test('replies group into one thread per staff member, each oldest first', () => {
  const threads = groupThreads([AVA_THANKS, BEN_ASKS, SAM_ANSWERS_AVA, AVA_ASKS]);
  const [avaThread, benThread] = threads;

  assert.deepEqual(threads.map((thread) => thread.staffId), ['ava', 'ben'], 'latest activity first');
  assert.deepEqual(ids(avaThread.replies), ['ava-1', 'sam-1', 'ava-2']);
  assert.deepEqual(ids(benThread.replies), ['ben-1']);
  assert.deepEqual(groupThreads([]), []);
});

test('a manager answer keeps the thread it answers, not the manager\'s own', () => {
  const threads = groupThreads([SAM_ANSWERS_AVA]);
  assert.deepEqual(threads.map((thread) => thread.staffId), ['ava']);
});

test('new replies are someone else\'s, written after the reader last looked', () => {
  const avaThread = [AVA_ASKS, SAM_ANSWERS_AVA, AVA_THANKS];

  // Sam has never opened Ava's thread: both of Ava's replies are new, his own answer isn't.
  assert.deepEqual(ids(unreadReplies(avaThread, 'sam', null)), ['ava-1', 'ava-2']);

  // Sam opened it after answering: only Ava's thanks is new.
  assert.deepEqual(ids(unreadReplies(avaThread, 'sam', '2026-11-25T03:10:00Z')), ['ava-2']);

  // Ava never opened it since: Sam's answer is new to her, her own replies aren't.
  assert.deepEqual(ids(unreadReplies(avaThread, 'ava', null)), ['sam-1']);

  // Ava opened it after the answer: nothing new.
  assert.deepEqual(unreadReplies(avaThread, 'ava', '2026-11-25T03:15:00Z'), []);
});

test('a reply written the moment the reader looked counts as seen', () => {
  assert.deepEqual(unreadReplies([SAM_ANSWERS_AVA], 'ava', SAM_ANSWERS_AVA.sentAt), []);
});

test('a reply whose author has since been deleted still shows as new', () => {
  const orphan = reply('gone', 'ava', null, '2026-11-25T04:00:00Z');
  assert.deepEqual(ids(unreadReplies([orphan], 'sam', '2026-11-25T03:30:00Z')), ['gone']);
});

test('the new-replies label is singular, plural, or nothing', () => {
  assert.equal(newRepliesLabel(0), null);
  assert.equal(newRepliesLabel(1), '1 new reply');
  assert.equal(newRepliesLabel(4), '4 new replies');
});
