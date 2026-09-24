import { test } from 'node:test';
import assert from 'node:assert/strict';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { bucketFor } from '../src/lib/analytics/aggregate';
import { WASTE_REASONS } from '../src/lib/expiry/waste-reasons';
import { DEMO_LOGINS } from '../src/lib/demo/config';
import { buildWorld, melbourneDate, USER_COLUMNS } from './seed-world';

// Mid-morning in Melbourne, so "today" rows exist but the clock guard still matters.
const NOW = new Date('2026-09-24T00:30:00Z');
const world = buildWorld(NOW);
const live = world.orgs.filter((o) => !o.archive && o.deliveries.length > 0);

test('the same day always builds the same world', () => {
  assert.deepEqual(buildWorld(NOW), world);
});

test('every user reference resolves to a seeded account', () => {
  const keys = new Set(world.users.map((u) => u.key));
  const rows: object[] = [
    ...world.products,
    ...world.orgs.flatMap((o) => [
      ...o.memberships, ...o.deliveries, ...o.expiryActions, ...o.rotationChecks,
      ...o.waste, ...o.audit, ...(o.archive ? [o.archive] : []),
    ]),
  ];
  for (const row of rows) {
    for (const column of USER_COLUMNS) {
      const value = (row as Record<string, unknown>)[column];
      if (value == null) continue;
      assert.ok(keys.has(value as string), `unknown user '${value}' in ${column}`);
    }
  }
});

test('nothing is dated in the future', () => {
  const now = NOW.getTime();
  const stamps = world.orgs.flatMap((o) => [
    ...o.deliveries.flatMap((d) => [d.received_at, d.closed_at]),
    ...o.waste.map((w) => w.wasted_at),
    ...o.rotationChecks.map((c) => c.checked_at),
    ...o.expiryActions.map((a) => a.actioned_at),
    ...o.audit.map((a) => a.created_at),
  ]).concat(world.jobRuns.map((r) => r.ran_at));
  for (const stamp of stamps) {
    if (stamp) assert.ok(Date.parse(stamp) <= now, `${stamp} is in the future`);
  }
});

test('batches obey the schema and tell a coherent story', () => {
  for (const o of world.orgs) {
    const wasted = new Map<string, number>();
    for (const w of o.waste) if (w.batch_id) wasted.set(w.batch_id, (wasted.get(w.batch_id) ?? 0) + w.qty);
    for (const b of o.batches) {
      assert.ok(b.qty_remaining >= 0 && b.qty_remaining <= b.qty_received);
      assert.equal(b.status === 'active', b.qty_remaining > 0, `${b.status} batch with ${b.qty_remaining} left`);
      assert.ok(b.expiry_date! > melbourneDate(new Date(b.created_at!)), 'expires before it arrived');
      assert.ok((wasted.get(b.id!) ?? 0) <= b.qty_received, 'more wasted than ever arrived');
    }
  }
});

test('open actions follow the engine: one per active batch at most', () => {
  for (const o of world.orgs) {
    const active = new Set(o.batches.filter((b) => b.status === 'active').map((b) => b.id));
    const open = o.expiryActions.filter((a) => a.state === 'open');
    assert.equal(new Set(open.map((a) => a.batch_id)).size, open.length);
    for (const a of open) assert.ok(active.has(a.batch_id), 'open action on a batch that is gone');
  }
});

test('every live site fills every column of the expiry board', () => {
  for (const o of live) {
    for (const site of o.sites) {
      const buckets = new Set(o.batches
        .filter((b) => b.site_id === site.id && b.status === 'active')
        .map((b) => bucketFor(differenceInCalendarDays(parseISO(b.expiry_date!), parseISO(world.asOf)))));
      for (const bucket of ['overdue', 'today', 'soon', 'watch'] as const) {
        assert.ok(buckets.has(bucket), `${o.org.slug}/${site.name} has nothing ${bucket}`);
      }
    }
  }
});

test('every live site has a fixture list for today and an open delivery', () => {
  for (const o of live) {
    for (const site of o.sites) {
      assert.ok(o.rotationChecks.some((c) => c.site_id === site.id && c.check_date === world.asOf));
      assert.ok(o.deliveries.some((d) => d.site_id === site.id && d.status === 'draft'));
    }
  }
  const keys = world.orgs.flatMap((o) => o.rotationChecks.map((c) => `${c.site_id}|${c.fixture}|${c.check_date}`));
  assert.equal(new Set(keys).size, keys.length);
});

test('the demo organisation uses every waste reason and every login', () => {
  const demo = world.orgs.find((o) => o.org.is_demo)!;
  assert.deepEqual(new Set(demo.waste.map((w) => w.reason)), new Set(WASTE_REASONS));
  const members = new Set(demo.memberships.map((m) => m.user_id));
  for (const login of DEMO_LOGINS) {
    assert.ok(world.users.some((u) => u.email === login.email && members.has(u.key)), login.email);
  }
});

test('the RLS suite finds the organisations it expects', () => {
  const northside = world.orgs.find((o) => o.org.slug === 'northside')!;
  assert.equal(northside.sites.length, 3);
  const staff = world.users.find((u) => u.email === 'staff@northside.test')!;
  assert.equal(world.orgs.flatMap((o) => o.memberships).filter((m) => m.user_id === staff.key).length, 1);
  assert.ok(world.orgs.some((o) => o.org.slug === 'bayside' && !o.archive));
  for (const email of ['admin@shelflife.test', 'owner@northside.test', 'owner@bayside.test']) {
    assert.ok(world.users.some((u) => u.email === email), email);
  }
});

test('the platform admin sees one archived organisation and a fresh engine run', () => {
  assert.equal(world.orgs.filter((o) => o.archive).length, 1);
  const lastEngine = world.jobRuns
    .filter((r) => r.job === 'expiry-engine')
    .map((r) => Date.parse(r.ran_at!))
    .sort((a, b) => b - a)[0];
  assert.ok(NOW.getTime() - lastEngine < 36 * 60 * 60 * 1000);
  assert.ok(world.jobRuns.some((r) => r.ok === false), 'a failed run to show');
});
