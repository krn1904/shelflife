import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REMINDER_SETTINGS,
  localDate,
  planExpiryActions,
  planRotationChecks,
  settingsFromRow,
  shelfLifeGroup,
  validateReminderSettings,
  type BatchRow,
  type ReminderSettings,
} from './engine';

const TODAY = '2026-09-04';

function batch(id: string, expiryDate: string | null, extra: Partial<BatchRow> = {}): BatchRow {
  return {
    id, orgId: 'org', siteId: 'site', expiryDate,
    arrivedOn: '2026-01-01', // long ago, so these default to long-life
    checked: false, markedDown: false,
    ...extra,
  };
}

/** The reminder a batch gets on a given day, or null. */
function reminderOn(day: string, b: BatchRow, settings?: Map<string, ReminderSettings>) {
  return planExpiryActions([b], day, settings)[0]?.action ?? null;
}

// Groups ---------------------------------------------------------------------------

test('groups by shelf life on arrival, using the default boundaries', () => {
  const g = (days: number) =>
    shelfLifeGroup('2026-10-01', localDate(new Date(Date.UTC(2026, 9, 1 + days, 12)).toISOString(), 'UTC'), DEFAULT_REMINDER_SETTINGS);
  assert.equal(g(14), 'short');   // smoothie
  assert.equal(g(21), 'short');   // boundary is inclusive
  assert.equal(g(22), 'medium');
  assert.equal(g(90), 'medium');
  assert.equal(g(91), 'long');
  assert.equal(g(243), 'long');   // chips, 8 months
});

// Short-life: the smoothie ------------------------------------------------------------

test('a 14-day smoothie: nothing on arrival, half price 2 days out, then its last day', () => {
  const smoothie = batch('s', '2026-10-15', { arrivedOn: '2026-10-01' });
  assert.equal(reminderOn('2026-10-01', smoothie), null);
  assert.equal(reminderOn('2026-10-12', smoothie), null);
  assert.equal(reminderOn('2026-10-13', smoothie), 'markdown');
  assert.equal(reminderOn('2026-10-15', smoothie), 'pull');
  assert.equal(reminderOn('2026-10-17', smoothie), 'pull'); // overdue stays a last-day call
});

test('once marked down, a batch waits quietly for its last day', () => {
  const smoothie = batch('s', '2026-10-15', { arrivedOn: '2026-10-01', markedDown: true });
  assert.equal(reminderOn('2026-10-14', smoothie), null);
  assert.equal(reminderOn('2026-10-15', smoothie), 'pull');
});

// Long-life: the chips ------------------------------------------------------------------

test('8-month chips: early check 30 days out, half price 7 days out, then the last day', () => {
  const chips = batch('c', '2027-06-01', { arrivedOn: '2026-10-01' });
  assert.equal(reminderOn('2027-05-01', chips), null);        // 31 days
  assert.equal(reminderOn('2027-05-02', chips), 'check');     // 30 days
  assert.equal(reminderOn('2027-05-25', chips), 'markdown');  // 7 days
  assert.equal(reminderOn('2027-06-01', chips), 'pull');
});

test('the group never changes as the date gets close (chips keep the 7-day half price)', () => {
  // 12 days left would be "short-life" if grouped by days left today. It is not.
  const chips = batch('c', '2027-06-01', { arrivedOn: '2026-10-01', checked: true });
  assert.equal(reminderOn('2027-05-20', chips), null);
  assert.equal(reminderOn('2027-05-25', chips), 'markdown');
});

test('an answered check is not asked again; an unanswered one gives way to half price', () => {
  const checked = batch('a', '2027-06-01', { arrivedOn: '2026-10-01', checked: true });
  assert.equal(reminderOn('2027-05-10', checked), null);
  const ignored = batch('b', '2027-06-01', { arrivedOn: '2026-10-01' });
  assert.equal(reminderOn('2027-05-26', ignored), 'markdown');
});

// Medium-life ---------------------------------------------------------------------------

test('medium-life gets no early check, only half price 7 days out', () => {
  const yoghurt = batch('y', '2026-11-10', { arrivedOn: '2026-10-01' }); // 40 days
  assert.equal(reminderOn('2026-10-12', yoghurt), null); // 29 days: no check for medium
  assert.equal(reminderOn('2026-11-03', yoghurt), 'markdown');
});

// Per-site settings ---------------------------------------------------------------------

test('each site uses its own settings; sites without any use the defaults', () => {
  const strict: ReminderSettings = { ...DEFAULT_REMINDER_SETTINGS, shortMaxDays: 14, mediumMarkdownDays: 5 };
  const settings = new Map([['strict-site', strict]]);
  // 20 days on arrival: medium at the strict site (half price 5 days out), short elsewhere (2 days).
  const here = batch('a', '2026-10-21', { arrivedOn: '2026-10-01', siteId: 'strict-site' });
  const there = batch('b', '2026-10-21', { arrivedOn: '2026-10-01', siteId: 'other-site' });
  assert.equal(reminderOn('2026-10-16', here, settings), 'markdown');
  assert.equal(reminderOn('2026-10-16', there, settings), null);
  assert.equal(reminderOn('2026-10-19', there, settings), 'markdown');
});

// General -------------------------------------------------------------------------------

test('produces at most one reminder per batch', () => {
  const plan = planExpiryActions([batch('a', '2026-09-07'), batch('b', '2026-09-30')], TODAY);
  assert.deepEqual(plan.map((p) => [p.batchId, p.action]), [['a', 'markdown'], ['b', 'check']]);
});

test('a batch with no date is skipped rather than given an invented one', () => {
  assert.deepEqual(planExpiryActions([batch('a', null)], TODAY), []);
});

test('the due date is the expiry itself, so an overdue last day reads as overdue', () => {
  const plan = planExpiryActions([batch('a', '2026-09-01')], TODAY);
  assert.equal(plan[0].dueDate, '2026-09-01');
  assert.equal(plan[0].daysLeft, -3);
});

// Settings ------------------------------------------------------------------------------

test('the defaults are valid, and no saved row means defaults', () => {
  assert.deepEqual(validateReminderSettings(DEFAULT_REMINDER_SETTINGS), []);
  assert.deepEqual(settingsFromRow(null), DEFAULT_REMINDER_SETTINGS);
});

test('settings that would fire a reminder on arrival are refused, naming the field', () => {
  const fieldsWrong = (change: Partial<ReminderSettings>) =>
    validateReminderSettings({ ...DEFAULT_REMINDER_SETTINGS, ...change }).map((p) => p.field);

  assert.deepEqual(fieldsWrong({ shortMarkdownDays: 21 }), ['shortMarkdownDays']);
  assert.deepEqual(fieldsWrong({ mediumMarkdownDays: 22 }), ['mediumMarkdownDays']);
  assert.deepEqual(fieldsWrong({ longCheckDays: 91 }), ['longCheckDays']);
  assert.deepEqual(fieldsWrong({ longMarkdownDays: 30 }), ['longMarkdownDays']);
  assert.deepEqual(fieldsWrong({ mediumMaxDays: 21 }), ['mediumMaxDays', 'longCheckDays']); // the 30-day check no longer fits either
  assert.deepEqual(fieldsWrong({ shortMarkdownDays: 0 }), ['shortMarkdownDays']);
  assert.deepEqual(fieldsWrong({ longCheckDays: 2.5 }), ['longCheckDays']);
});

test('localDate gives the store\'s calendar day, not UTC\'s', () => {
  // 15:30 UTC on 1 Oct is 01:30 on 2 Oct in Melbourne.
  assert.equal(localDate('2026-10-01T15:30:00Z', 'Australia/Melbourne'), '2026-10-02');
});

test('rotation checks are one per fixture per site', () => {
  const checks = planRotationChecks(
    [
      { orgId: 'o', siteId: 's1', fixture: 'Dairy fridge' },
      { orgId: 'o', siteId: 's1', fixture: 'Dairy fridge' },
      { orgId: 'o', siteId: 's1', fixture: 'Bakery stand' },
      { orgId: 'o', siteId: 's2', fixture: 'Dairy fridge' },
    ],
    TODAY,
  );
  assert.equal(checks.length, 3);
  assert.deepEqual(
    checks.map((c) => `${c.siteId}/${c.fixture}`),
    ['s1/Dairy fridge', 's1/Bakery stand', 's2/Dairy fridge'],
  );
});

test('unfixtured stock produces no check, since there is no shelf to go and look at', () => {
  const checks = planRotationChecks(
    [
      { orgId: 'o', siteId: 's1', fixture: '' },
      { orgId: 'o', siteId: 's1', fixture: '   ' },
    ],
    TODAY,
  );
  assert.deepEqual(checks, []);
});

test('fixture names are trimmed so " Dairy" and "Dairy" are one shelf', () => {
  const checks = planRotationChecks(
    [
      { orgId: 'o', siteId: 's1', fixture: 'Dairy fridge' },
      { orgId: 'o', siteId: 's1', fixture: '  Dairy fridge  ' },
    ],
    TODAY,
  );
  assert.equal(checks.length, 1);
  assert.equal(checks[0].fixture, 'Dairy fridge');
});
