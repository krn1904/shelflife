import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_LOGINS, ONE_CLICK_LOGINS, oneClickLogin } from './config';

test('the login page never offers the platform admin as a one-click login', () => {
  assert.ok(ONE_CLICK_LOGINS.length > 0);
  assert.ok(ONE_CLICK_LOGINS.every((l) => l.role !== 'platform_admin'));
});

test('staff, manager and owner keep their one-click logins', () => {
  assert.deepEqual(ONE_CLICK_LOGINS.map((l) => l.role).sort(), ['manager', 'owner', 'staff']);
});

test('signing in as the demo platform admin by email is refused', () => {
  const admin = DEMO_LOGINS.find((l) => l.role === 'platform_admin');
  assert.ok(admin, 'the demo admin is still seeded');
  assert.equal(oneClickLogin(admin.email), undefined);
  assert.equal(oneClickLogin('owner@demo.shelflife.app')?.role, 'owner');
  assert.equal(oneClickLogin('someone@example.com'), undefined);
});
