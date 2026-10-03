import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createBarcodeReader } from './reader';

type FakeTrack = { stopped: boolean; stop(): void };

let tracks: FakeTrack[];
let openCamera: (() => void) | null;
let liveTimers: Set<unknown>;
const realSetInterval = globalThis.setInterval;
const realClearInterval = globalThis.clearInterval;

function fakeStream() {
  const track: FakeTrack = { stopped: false, stop() { this.stopped = true; } };
  tracks.push(track);
  return { getTracks: () => [track] };
}

function fakeVideo() {
  return {
    srcObject: null as unknown,
    muted: false,
    readyState: 4,
    setAttribute() {},
    play: async () => {},
  } as unknown as HTMLVideoElement;
}

beforeEach(() => {
  tracks = [];
  openCamera = null;
  liveTimers = new Set();

  // The camera opens only when the test says so, to stand in for a pending permission prompt.
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: () => new Promise((resolve) => { openCamera = () => resolve(fakeStream()); }),
      },
    },
  });
  globalThis.BarcodeDetector = class { async detect() { return []; } };

  globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => {
    const id = realSetInterval(...args);
    liveTimers.add(id);
    return id;
  }) as typeof setInterval;
  globalThis.clearInterval = ((id: Parameters<typeof clearInterval>[0]) => {
    liveTimers.delete(id);
    realClearInterval(id);
  }) as typeof clearInterval;
});

afterEach(() => {
  for (const id of liveTimers) realClearInterval(id as Parameters<typeof clearInterval>[0]);
  globalThis.setInterval = realSetInterval;
  globalThis.clearInterval = realClearInterval;
  globalThis.BarcodeDetector = undefined;
});

async function cameraRequested() {
  while (!openCamera) await new Promise((resolve) => setImmediate(resolve));
}

test('stopping while the camera is still opening releases it once it opens', async () => {
  const reader = createBarcodeReader();
  const started = reader.start(fakeVideo(), () => {});

  await cameraRequested();
  reader.stop(); // the scanner closed before the permission prompt was answered
  openCamera!();
  await started;

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].stopped, true, 'camera left on');
  assert.equal(liveTimers.size, 0, 'sampling timer left running');
});

test('a normal start samples frames, and stop releases the camera and the timer', async () => {
  const reader = createBarcodeReader();
  const started = reader.start(fakeVideo(), () => {});

  await cameraRequested();
  openCamera!();
  assert.deepEqual(await started, { ok: true, kind: 'native' });
  assert.equal(liveTimers.size, 1);
  assert.equal(tracks[0].stopped, false);

  reader.stop();
  assert.equal(tracks[0].stopped, true);
  assert.equal(liveTimers.size, 0);
});
