import assert from 'node:assert/strict';
import test from 'node:test';
import { bucketFor } from '@/lib/analytics/aggregate';
import { attentionUntil, SOON_DAYS } from './display';

test('"needs attention" ends on the last "within 7 days" date, across a year end', () => {
  assert.equal(attentionUntil('2026-10-05'), '2026-10-12');
  assert.equal(attentionUntil('2026-12-28'), '2027-01-04');
  // The last day counted is still "soon"; the next one is the first "watch".
  assert.equal(bucketFor(SOON_DAYS), 'soon');
  assert.equal(bucketFor(SOON_DAYS + 1), 'watch');
});
