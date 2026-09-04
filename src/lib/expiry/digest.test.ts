import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest } from './digest';

test('leads with the pull count, which is the number that costs money', () => {
  const digest = buildDigest({
    siteName: 'Brunswick',
    actions: [
      { action: 'pull', daysLeft: -1 },
      { action: 'pull', daysLeft: 0 },
      { action: 'markdown', daysLeft: 3 },
      { action: 'check', daysLeft: 20 },
    ],
    rotationFixtures: 2,
  });
  assert.equal(digest.title, 'Brunswick: 2 lines to pull');
  assert.equal(digest.body, '2 lines to pull, 1 line to mark down, 1 line to check, 2 fixtures to walk · 1 already past date');
});

test('singular and plural both read correctly', () => {
  const one = buildDigest({
    siteName: 'Coburg',
    actions: [{ action: 'pull', daysLeft: 0 }],
    rotationFixtures: 1,
  });
  assert.equal(one.title, 'Coburg: 1 line to pull');
  assert.ok(one.body.includes('1 fixture to walk'));
});

test('a quiet day is not worth sending', () => {
  // A daily "all clear" is how people learn to swipe the notification away unread.
  const quiet = buildDigest({ siteName: 'Preston', actions: [], rotationFixtures: 0 });
  assert.equal(quiet.worthSending, false);
  assert.equal(quiet.body, 'Nothing outstanding.');
});

test('fixtures alone are worth sending', () => {
  const digest = buildDigest({ siteName: 'Preston', actions: [], rotationFixtures: 3 });
  assert.equal(digest.worthSending, true);
  assert.equal(digest.title, "Preston: today's list");
});

test('no overdue stock means no overdue clause', () => {
  const digest = buildDigest({
    siteName: 'Brunswick',
    actions: [{ action: 'check', daysLeft: 25 }],
    rotationFixtures: 0,
  });
  assert.equal(digest.body, '1 line to check');
  assert.equal(digest.overdue, 0);
});
