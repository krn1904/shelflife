import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectiveTrackingMode } from './tracking';

test('falls back to the catalogue mode when a site has no opinion', () => {
  assert.equal(effectiveTrackingMode('batch', null), 'batch');
  assert.equal(effectiveTrackingMode('rotation', undefined), 'rotation');
});

test('a site override wins over the catalogue', () => {
  assert.equal(effectiveTrackingMode('batch', 'rotation'), 'rotation');
});

test('an override to a less strict mode is honoured, not ignored', () => {
  // The tempting bug is to treat 'none' as "unset" and fall through to the catalogue,
  // which would silently keep asking staff for dates on a product a site opted out of.
  assert.equal(effectiveTrackingMode('batch', 'none'), 'none');
});
