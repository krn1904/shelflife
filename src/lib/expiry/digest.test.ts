import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDigest, subscriptionTargetsSite } from './digest';

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
  assert.equal(digest.title, 'Brunswick: 2 lines on their last day');
  assert.equal(digest.body, '2 lines on their last day, 1 line to put on half price, 1 line to check, 2 fixtures to walk · 1 already past date');
});

test('singular and plural both read correctly', () => {
  const one = buildDigest({
    siteName: 'Coburg',
    actions: [{ action: 'pull', daysLeft: 0 }],
    rotationFixtures: 1,
  });
  assert.equal(one.title, 'Coburg: 1 line on its last day');
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

test('subscriptions only match sites in the same organisation', () => {
  const site = { id: 'site-a', org_id: 'org-a' };
  assert.equal(
    subscriptionTargetsSite({ org_id: 'org-a', site_id: 'site-a' }, site),
    true,
  );
  assert.equal(
    subscriptionTargetsSite({ org_id: 'org-a', site_id: null }, site),
    true,
  );
  assert.equal(
    subscriptionTargetsSite({ org_id: 'org-b', site_id: 'site-a' }, site),
    false,
  );
  assert.equal(
    subscriptionTargetsSite({ org_id: 'org-b', site_id: null }, site),
    false,
  );
  assert.equal(
    subscriptionTargetsSite({ org_id: 'org-a', site_id: 'site-b' }, site),
    false,
  );
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
