import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contrastRange, uploadSize } from './browser';

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

test('photos are stored at most 2400 wide and 8000 tall, never enlarged, in proportion', () => {
  // A 12 MP phone photo, portrait and landscape.
  assert.deepEqual(uploadSize(3024, 4032), { width: 2400, height: 3200 });
  assert.deepEqual(uploadSize(4032, 3024), { width: 2400, height: 1800 });
  // A long thermal receipt keeps the full 2400 width the free reader needs.
  assert.deepEqual(uploadSize(3000, 9000), { width: 2400, height: 7200 });
  // Only an extreme one is limited by its height instead.
  assert.deepEqual(uploadSize(2000, 12000), { width: 1333, height: 8000 });
  // Already small: left alone.
  assert.deepEqual(uploadSize(1200, 1600), { width: 1200, height: 1600 });
  // Degenerate sizes never round to zero.
  assert.deepEqual(uploadSize(1, 100000), { width: 1, height: 8000 });
});
