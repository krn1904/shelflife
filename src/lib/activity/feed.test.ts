import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerText, buildFeed, clockAt, whenAgo, type AnsweredReminder } from './feed';

const answer = (over: Partial<AnsweredReminder>): AnsweredReminder => ({
  id: 'a1', actionedAt: '2026-10-06T01:00:00Z', actionedBy: 'sam', batchId: 'b1',
  action: 'check', product: 'Milk 2L', batchStatus: 'active', markedDown: false, ...over,
});

test('an answer is told by what it left on the shelf', () => {
  assert.equal(answerText(answer({ action: 'check' })), 'checked the date on Milk 2L');
  assert.equal(answerText(answer({ action: 'markdown', markedDown: true })), 'put Milk 2L on half price');
  assert.equal(answerText(answer({ action: 'markdown', batchStatus: 'sold_through' })), 'marked Milk 2L as sold out');
  assert.equal(answerText(answer({ action: 'pull', batchStatus: 'pulled' })), 'pulled Milk 2L off the shelf');
  assert.equal(answerText(answer({ action: 'pull', batchStatus: 'sold_through' })), 'marked Milk 2L as sold out');
  assert.equal(answerText(answer({ action: 'check', product: null })), 'checked the date on an item');
});

test('every source becomes one list, newest first, cut to the limit', () => {
  const feed = buildFeed({
    deliveries: [{ id: 'd1', closedAt: '2026-10-06T02:00:00Z', receivedBy: 'riley', supplier: 'Lion Dairy & Drinks', lines: 12 }],
    waste: [{ id: 'w1', wastedAt: '2026-10-06T03:00:00Z', wastedBy: 'sam', batchId: 'b9', product: 'Yoghurt 1kg', qty: 3, reason: 'damaged' }],
    answers: [answer({ id: 'a1', actionedAt: '2026-10-06T01:00:00Z' })],
    fixtures: [{ id: 'f1', checkedAt: '2026-10-06T04:00:00Z', checkedBy: 'sam', fixture: 'Drinks fridge' }],
  }, 3);
  assert.deepEqual(feed.map((i) => i.id), ['rotation:f1', 'waste:w1', 'delivery:d1']);
  assert.equal(feed[1].text, 'wrote off 3 × Yoghurt 1kg (damaged)');
  assert.equal(feed[2].text, 'received Lion Dairy & Drinks (12 lines)');
  assert.equal(feed[2].href, '/manage/deliveries/d1');
});

test('a last-day answer that binned stock shows once, as the write-off', () => {
  const feed = buildFeed({
    deliveries: [],
    waste: [{ id: 'w1', wastedAt: '2026-10-06T01:00:00Z', wastedBy: 'sam', batchId: 'b1', product: 'Milk 2L', qty: 2, reason: 'expired' }],
    answers: [
      answer({ id: 'a1', action: 'pull', batchStatus: 'pulled', batchId: 'b1' }),
      answer({ id: 'a2', action: 'pull', batchStatus: 'pulled', batchId: 'b2', product: 'Juice 1L' }),
    ],
    fixtures: [],
  }, 10);
  assert.deepEqual(feed.map((i) => i.id).sort(), ['answer:a2', 'waste:w1']);
});

test('nothing happened: an empty list', () => {
  assert.deepEqual(buildFeed({ deliveries: [], waste: [], answers: [], fixtures: [] }, 10), []);
});

test('how long ago, then the date once it is a day old', () => {
  const now = new Date('2026-10-06T05:00:00Z');
  const date = () => '05/10/2026';
  assert.equal(whenAgo('2026-10-06T04:59:30Z', now, date), 'just now');
  assert.equal(whenAgo('2026-10-06T04:48:00Z', now, date), '12 min ago');
  assert.equal(whenAgo('2026-10-06T02:00:00Z', now, date), '3 h ago');
  assert.equal(whenAgo('2026-10-05T04:00:00Z', now, date), '05/10/2026');
});

test('the refresh time is the site\'s clock, not the server\'s', () => {
  const at = new Date('2026-10-06T05:05:00Z');
  assert.equal(clockAt(at, 'Australia/Melbourne').replace(/\s/g, ' '), '4:05 pm');
  assert.equal(clockAt(at, 'UTC').replace(/\s/g, ' '), '5:05 am');
});

test('earlier answers on a batch keep their own wording after it sells out', () => {
  const feed = buildFeed({
    deliveries: [], waste: [], fixtures: [],
    answers: [
      answer({ id: 'mon', actionedAt: '2026-10-05T01:00:00Z', action: 'check', batchStatus: 'sold_through', markedDown: true }),
      answer({ id: 'thu', actionedAt: '2026-10-08T01:00:00Z', action: 'markdown', batchStatus: 'sold_through', markedDown: true }),
      answer({ id: 'fri', actionedAt: '2026-10-09T01:00:00Z', action: 'pull', batchStatus: 'sold_through', markedDown: true }),
    ],
  }, 10);
  assert.deepEqual(feed.map((i) => i.text), [
    'marked Milk 2L as sold out',
    'put Milk 2L on half price',
    'checked the date on Milk 2L',
  ]);
});

test('a damaged write-off does not hide a later pull answer on the same batch', () => {
  const feed = buildFeed({
    deliveries: [], fixtures: [],
    waste: [{ id: 'w1', wastedAt: '2026-10-06T01:00:00Z', wastedBy: 'sam', batchId: 'b1', product: 'Milk 2L', qty: 1, reason: 'damaged' }],
    answers: [answer({ id: 'a1', actionedAt: '2026-10-06T02:00:00Z', action: 'pull', batchStatus: 'pulled', batchId: 'b1' })],
  }, 10);
  assert.deepEqual(feed.map((i) => i.id), ['answer:a1', 'waste:w1']);
});
