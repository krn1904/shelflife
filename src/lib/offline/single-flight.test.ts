import { test } from 'node:test';
import assert from 'node:assert/strict';
import { singleFlight } from './single-flight';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('a call made while the task runs is skipped, not run a second time', async () => {
  const gate = deferred<string>();
  let runs = 0;
  const run = singleFlight(() => { runs += 1; return gate.promise; });

  const first = run();
  assert.equal(await run(), null);
  gate.resolve('done');

  assert.equal(await first, 'done');
  assert.equal(runs, 1);
});

test('the task can run again once the previous call has finished', async () => {
  let runs = 0;
  const run = singleFlight(async () => { runs += 1; return runs; });

  assert.equal(await run(), 1);
  assert.equal(await run(), 2);
});

test('a failed run still frees the gate, so the next sync is not blocked forever', async () => {
  let fail = true;
  const run = singleFlight(async () => {
    if (fail) throw new Error('offline');
    return 'sent';
  });

  await assert.rejects(run(), /offline/);
  fail = false;
  assert.equal(await run(), 'sent');
});
