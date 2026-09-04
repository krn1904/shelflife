import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planExpiryActions, planRotationChecks, type BatchRow } from './engine';

const TODAY = '2026-09-04';

function batch(id: string, expiryDate: string | null): BatchRow {
  return { id, orgId: 'org', siteId: 'site', expiryDate };
}

test('escalates check → markdown → pull as the date approaches', () => {
  const plan = planExpiryActions(
    [
      batch('a', '2026-10-04'), // 30 days
      batch('b', '2026-09-18'), // 14 days
      batch('c', '2026-09-11'), // 7 days
      batch('d', '2026-09-07'), // 3 days
      batch('e', '2026-09-05'), // 1 day
    ],
    TODAY,
  );

  assert.deepEqual(
    plan.map((p) => [p.batchId, p.action]),
    [['a', 'check'], ['b', 'check'], ['c', 'markdown'], ['d', 'markdown'], ['e', 'pull']],
  );
});

test('produces exactly one action per batch, not one per threshold crossed', () => {
  // A batch three days out has crossed 30, 14, 7 and 3. Staff need one instruction.
  const plan = planExpiryActions([batch('a', '2026-09-07')], TODAY);
  assert.equal(plan.length, 1);
  assert.equal(plan[0].action, 'markdown');
});

test('anything already expired is a pull, however far past', () => {
  const plan = planExpiryActions(
    [batch('yesterday', '2026-09-03'), batch('ancient', '2019-01-01')],
    TODAY,
  );
  assert.deepEqual(plan.map((p) => p.action), ['pull', 'pull']);
  assert.equal(plan[0].daysLeft, -1);
  assert.ok(plan[1].daysLeft < -2000);
});

test('expiring today is a pull, not a markdown', () => {
  const plan = planExpiryActions([batch('a', TODAY)], TODAY);
  assert.equal(plan[0].action, 'pull');
  assert.equal(plan[0].daysLeft, 0);
});

test('says nothing about stock beyond the horizon', () => {
  const plan = planExpiryActions([batch('a', '2026-10-05')], TODAY); // 31 days
  assert.deepEqual(plan, []);
});

test('a batch with no date is skipped rather than given an invented one', () => {
  // These exist: intake can close with a date left blank. Guessing here would put a
  // fabricated deadline in front of staff.
  assert.deepEqual(planExpiryActions([batch('a', null)], TODAY), []);
});

test('the due date is the expiry itself, so an overdue pull reads as overdue', () => {
  const plan = planExpiryActions([batch('a', '2026-09-01')], TODAY);
  assert.equal(plan[0].dueDate, '2026-09-01');
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
