import assert from 'node:assert/strict';
import test from 'node:test';
import { linePosition, stepLine } from './walk';

test('next and previous stay inside the delivery', () => {
  assert.equal(stepLine(0, 1, 9), 1);
  assert.equal(stepLine(8, 1, 9), 8);
  assert.equal(stepLine(0, -1, 9), 0);
  assert.equal(stepLine(4, -1, 9), 3);
});

test('a cursor past the end (a line was removed) falls back onto the last line', () => {
  assert.equal(stepLine(9, 0, 9), 8);
  assert.deepEqual(linePosition(12, 3), { line: 3, of: 3, last: true });
});

test('positions read as staff count them', () => {
  assert.deepEqual(linePosition(3, 9), { line: 4, of: 9, last: false });
  assert.deepEqual(linePosition(8, 9), { line: 9, of: 9, last: true });
  assert.deepEqual(linePosition(0, 1), { line: 1, of: 1, last: true });
});

test('an empty delivery has no position', () => {
  assert.equal(stepLine(0, 1, 0), 0);
  assert.equal(linePosition(0, 0), null);
});
