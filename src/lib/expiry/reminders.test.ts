import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refreshOnReturn, remindersShownTo, summariseReminders, toastDue, toastStorageKey } from './reminders';

test('only staff and managers get shift reminders', () => {
  assert.equal(remindersShownTo('staff'), true);
  assert.equal(remindersShownTo('manager'), true);
  assert.equal(remindersShownTo('owner'), false);
  assert.equal(remindersShownTo('platform_admin'), false);
});

test('leads with the last-day count, which is the number that costs money', () => {
  const summary = summariseReminders({
    actions: [
      { action: 'pull', daysLeft: -1 },
      { action: 'pull', daysLeft: 0 },
      { action: 'markdown', daysLeft: 3 },
      { action: 'check', daysLeft: 20 },
    ],
    openFixtures: 2,
  });
  assert.equal(summary.title, '2 lines on their last day');
  assert.equal(
    summary.body,
    '2 lines on their last day, 1 line to put on half price, 1 line to check, 2 fixtures to walk · 1 already past date',
  );
  assert.equal(summary.total, 6);
  assert.equal(summary.tone, 'critical');
});

test('singular and plural both read correctly', () => {
  const one = summariseReminders({ actions: [{ action: 'pull', daysLeft: 0 }], openFixtures: 1 });
  assert.equal(one.title, '1 line on its last day');
  assert.ok(one.body.includes('1 fixture to walk'));
});

test('half price leads, in amber, when nothing is on its last day', () => {
  const summary = summariseReminders({
    actions: [{ action: 'markdown', daysLeft: 2 }, { action: 'check', daysLeft: 25 }],
    openFixtures: 0,
  });
  assert.equal(summary.title, '1 line to put on half price');
  assert.equal(summary.tone, 'warning');
});

test('checks and fixtures alone are a quiet reminder', () => {
  const summary = summariseReminders({ actions: [{ action: 'check', daysLeft: 25 }], openFixtures: 3 });
  assert.equal(summary.title, "Today's list is ready");
  assert.equal(summary.tone, 'neutral');
  assert.equal(summary.body, '1 line to check, 3 fixtures to walk');
  assert.equal(summary.overdue, 0);
});

test('a quiet day shows nothing', () => {
  // A daily "all clear" is how people learn to ignore the banner.
  const quiet = summariseReminders({ actions: [], openFixtures: 0 });
  assert.equal(quiet.total, 0);
  assert.equal(quiet.tone, null);
});

test('the pop-up shows until acknowledged that site day, and never with nothing due', () => {
  assert.equal(toastDue(null, '2026-10-05', 3), true);
  assert.equal(toastDue('2026-10-04', '2026-10-05', 3), true);
  assert.equal(toastDue('2026-10-05', '2026-10-05', 3), false, 'already acknowledged today');
  assert.equal(toastDue(null, '2026-10-05', 0), false, 'nothing due');
  assert.notEqual(toastStorageKey('riley', 'brunswick'), toastStorageKey('riley', 'coburg'));
  assert.notEqual(
    toastStorageKey('riley', 'brunswick'),
    toastStorageKey('sam', 'brunswick'),
    'a shared tablet keeps each account separate',
  );
});

test('coming back after a while refreshes; a quick tab switch does not', () => {
  assert.equal(refreshOnReturn(null, 1_000_000), false, 'never hidden');
  assert.equal(refreshOnReturn(1_000_000, 1_030_000), false, '30 s away');
  assert.equal(refreshOnReturn(1_000_000, 1_060_000), true, 'a minute away');
  assert.equal(refreshOnReturn(0, 8 * 3_600_000), true, 'tablet left overnight');
});
