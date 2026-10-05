import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canManageRole, canRemove, rolesManagedBy } from './rules';

test('owners and platform admins manage staff and managers', () => {
  for (const caller of ['owner', 'platform_admin'] as const) {
    assert.deepEqual(rolesManagedBy(caller), ['staff', 'manager'], caller);
  }
});

test('managers manage staff only; staff manage nobody', () => {
  assert.deepEqual(rolesManagedBy('manager'), ['staff']);
  assert.equal(canManageRole('manager', 'manager'), false);
  assert.deepEqual(rolesManagedBy('staff'), []);
});

test('nobody adds an owner or platform admin from here', () => {
  for (const caller of ['platform_admin', 'owner', 'manager', 'staff'] as const) {
    assert.equal(canManageRole(caller, 'owner'), false, caller);
    assert.equal(canManageRole(caller, 'platform_admin'), false, caller);
  }
});

test('remove shows for roles you manage, never for yourself', () => {
  const owner = { role: 'owner' as const, userId: 'o' };
  const manager = { role: 'manager' as const, userId: 'm' };
  assert.equal(canRemove(owner, { role: 'manager', userId: 'm' }), true);
  assert.equal(canRemove(manager, { role: 'staff', userId: 's' }), true);
  assert.equal(canRemove(manager, { role: 'manager', userId: 'm2' }), false);
  assert.equal(canRemove(manager, manager), false);
  assert.equal(canRemove(owner, { role: 'owner', userId: 'o2' }), false);
});
