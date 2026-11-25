import { test } from 'node:test';
import assert from 'node:assert/strict';
import { differenceInCalendarDays, parseISO } from 'date-fns';
import { bucketFor } from '../src/lib/analytics/aggregate';
import { WASTE_REASONS } from '../src/lib/expiry/waste-reasons';
import { DEMO_LOGINS } from '../src/lib/demo/config';
import { unreadReplies, type Reply } from '../src/lib/messages/messages';
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
      ...o.messages, ...o.messageReads, ...o.replies, ...o.threadReads,
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
    ...o.messages.map((m) => m.created_at),
    ...o.messageReads.map((r) => r.read_at),
    ...o.replies.map((r) => r.created_at),
    ...o.threadReads.map((r) => r.last_read_at),
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

test('every reply follows the rules the table enforces', () => {
  for (const o of world.orgs) {
    for (const reply of o.replies) {
      const message = o.messages.find((m) => m.id === reply.message_id)!;
      const isStaffHere = o.memberships.some((m) =>
        m.user_id === reply.staff_id && m.role === 'staff' && m.site_id === message.site_id);
      const managesHere = o.memberships.some((m) =>
        m.user_id === reply.author_id && (m.role === 'owner' || (m.role === 'manager' && m.site_id === message.site_id)));
      const writtenByThreadOwner = reply.author_id === reply.staff_id;

      assert.equal(reply.site_id, message.site_id);
      assert.ok(isStaffHere, `${reply.staff_id} is not staff at the message's site`);
      assert.ok(writtenByThreadOwner || managesHere, `${reply.author_id} may not write in ${reply.staff_id}'s thread`);
      assert.ok(Date.parse(reply.created_at!) > Date.parse(message.created_at!), 'reply before its message');
    }
  }
});

test('the demo has a new answer waiting for staff and a new reply waiting for the manager', () => {
  const demo = world.orgs.find((o) => o.org.is_demo)!;
  const brunswick = demo.sites.find((s) => s.name === 'Brunswick')!;
  const brunswickMessages = new Set(demo.messages.filter((m) => m.site_id === brunswick.id).map((m) => m.id));
  const replies = demo.replies.filter((r) => brunswickMessages.has(r.message_id));

  function newRepliesFor(readerId: string): string[] {
    return [...brunswickMessages].flatMap((messageId) => {
      const thread: Reply[] = replies
        .filter((r) => r.message_id === messageId && r.staff_id === 'demo-staff')
        .map((r) => ({ id: r.id!, staffId: r.staff_id, authorId: r.author_id ?? null, body: r.body, sentAt: r.created_at! }));
      const lastRead = demo.threadReads.find((read) =>
        read.message_id === messageId && read.staff_id === 'demo-staff' && read.reader_id === readerId);
      return unreadReplies(thread, readerId, lastRead?.last_read_at ?? null).map((r) => r.body);
    });
  }

  assert.deepEqual(newRepliesFor('demo-staff'), ['Yes, the cool room is fine. Yoghurts on the top shelf.']);
  assert.deepEqual(newRepliesFor('demo-manager'), ['I can stay until 5 and count it in.']);
});

test('the RLS suite finds the organisations it expects', () => {
  const metro = world.orgs.find((o) => o.org.slug === 'metro-petroleum')!;
  assert.equal(metro.sites.length, 3);
  const staff = world.users.find((u) => u.email === 'staff@metro-petroleum.test')!;
  assert.equal(world.orgs.flatMap((o) => o.memberships).filter((m) => m.user_id === staff.key).length, 1);
  assert.ok(world.orgs.some((o) => o.org.slug === 'united-petroleum' && !o.archive));
  for (const email of ['admin@shelflife.test', 'owner@metro-petroleum.test', 'owner@united-petroleum.test']) {
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
