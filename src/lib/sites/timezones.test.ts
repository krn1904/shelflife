import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SITE_TIMEZONES } from './timezones';
import { todayIn } from '@/lib/intake/expiry';

test('every site timezone on offer is a real zone, listed once', () => {
  for (const { value } of SITE_TIMEZONES) {
    // Throws RangeError for a name the runtime does not know.
    assert.doesNotThrow(() => new Intl.DateTimeFormat('en-AU', { timeZone: value }), value);
  }
  assert.equal(new Set(SITE_TIMEZONES.map((t) => t.value)).size, SITE_TIMEZONES.length);
});

test('todayIn gives a calendar date in the zone asked for', () => {
  assert.match(todayIn('Australia/Melbourne'), /^\d{4}-\d{2}-\d{2}$/);
  // Perth is never ahead of Melbourne, so its date is the same day or the day before.
  assert.ok(todayIn('Australia/Perth') <= todayIn('Australia/Melbourne'));
});
