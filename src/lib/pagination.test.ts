import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAllPages } from './pagination';

test('collects every page beyond the PostgREST 1,000-row cap', async () => {
  const source = Array.from({ length: 2_505 }, (_, id) => ({ id }));
  const calls: [number, number][] = [];

  const rows = await fetchAllPages(async (from, to) => {
    calls.push([from, to]);
    return { data: source.slice(from, to + 1), error: null };
  });

  assert.deepEqual(rows, source);
  assert.deepEqual(calls, [[0, 999], [1000, 1999], [2000, 2999]]);
});

test('stops after an exact-size final page by requesting one empty page', async () => {
  const source = Array.from({ length: 2_000 }, (_, id) => id);

  let calls = 0;
  const rows = await fetchAllPages(async (from, to) => {
    calls += 1;
    return { data: source.slice(from, to + 1), error: null };
  });

  assert.deepEqual(rows, source);
  assert.equal(calls, 3);
});

test('propagates page errors rather than returning partial data', async () => {
  await assert.rejects(
    fetchAllPages(async (from) => (
      from === 0
        ? { data: [1_000], error: null }
        : { data: null, error: { message: 'page failed' } }
    ), 1),
    /page failed/,
  );
});
