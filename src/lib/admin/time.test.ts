import { test } from 'node:test';
import assert from 'node:assert/strict';
import { platformTime } from './time';

test('admin times are on Melbourne\'s clock, whatever the server\'s is', () => {
  // The nightly run, 03:00 in Melbourne during daylight saving (UTC+11).
  assert.equal(platformTime('2026-10-05T16:00:06Z').replace(/\s/g, ' '), '06/10/2026, 3:00 am');
  // Standard time (UTC+10) in winter.
  assert.equal(platformTime('2026-06-01T17:00:00Z').replace(/\s/g, ' '), '02/06/2026, 3:00 am');
  assert.equal(platformTime('2026-10-05T16:00:06Z', false), '06/10/2026');
});
