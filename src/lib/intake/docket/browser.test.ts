import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRange } from './browser';

// What cleanUp() used to do: sort a full copy and index into it.
function bySorting(grey: Uint8ClampedArray) {
  const sorted = Uint8ClampedArray.from(grey).sort();
  return { lo: sorted[Math.floor(sorted.length * 0.01)], hi: sorted[Math.floor(sorted.length * 0.99)] };
}

test('matches the sorted-copy percentiles on photo-like pixel spreads', () => {
  let seed = 7;
  const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;

  const spreads: Uint8ClampedArray[] = [
    Uint8ClampedArray.from({ length: 10_000 }, () => random() * 256),
    // Mostly pale paper with some dark ink, like a docket.
    Uint8ClampedArray.from({ length: 12_345 }, () => (random() < 0.9 ? 200 + random() * 40 : random() * 60)),
    new Uint8ClampedArray(500).fill(128),
    Uint8ClampedArray.from([0, 255]),
    Uint8ClampedArray.from([42]),
  ];

  for (const grey of spreads) assert.deepEqual(contrastRange(grey), bySorting(grey));
});
