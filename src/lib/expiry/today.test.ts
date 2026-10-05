import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byUrgency, cardInstruction, whenText } from './today';

const MELB = 'Australia/Melbourne';

test('whenText reads naturally either side of the expiry day', () => {
  assert.equal(whenText(2), 'Expires in 2 days');
  assert.equal(whenText(1), 'Expires in 1 day');
  assert.equal(whenText(0), 'Expires today');
  assert.equal(whenText(-3), 'Expired 3 days ago');
});

test('each card says what to do', () => {
  assert.equal(cardInstruction({ action: 'check', daysLeft: 30, markedDownOn: null }, MELB),
    '30 days left. Face it up or put it on special.');
  assert.equal(cardInstruction({ action: 'markdown', daysLeft: 2, markedDownOn: null }, MELB),
    'Expires in 2 days. Put it on half price.');
  assert.equal(cardInstruction({ action: 'pull', daysLeft: 0, markedDownOn: null }, MELB),
    'Expires today. Still on the shelf? Pull it out.');
});

test('a last-day card says when it went to half price, in the store\'s calendar', () => {
  // 22:30 UTC on the 12th is already the 13th in Melbourne.
  assert.equal(cardInstruction({ action: 'pull', daysLeft: 0, markedDownOn: '2026-10-12T22:30:00Z' }, MELB),
    'On half price since Tue 13 Oct. Expires today. Still on the shelf? Pull it out.');
});

test('board-only cards say where the stock stands', () => {
  assert.equal(cardInstruction({ action: 'comingUp', daysLeft: 9, markedDownOn: null }, MELB), 'Expires in 9 days. Nothing to do yet.');
  assert.equal(cardInstruction({ action: 'onHalfPrice', daysLeft: 1, markedDownOn: '2026-10-12T22:30:00Z' }, MELB),
    'On half price since Tue 13 Oct. Expires in 1 day.');
});

test('cards sort last day first, then half price, then checks, soonest first', () => {
  const cards = [
    { id: 'check', action: 'check' as const, daysLeft: 30 },
    { id: 'half-later', action: 'markdown' as const, daysLeft: 5 },
    { id: 'last', action: 'pull' as const, daysLeft: 0 },
    { id: 'half-soon', action: 'markdown' as const, daysLeft: 1 },
  ];
  assert.deepEqual([...cards].sort(byUrgency).map((c) => c.id), ['last', 'half-soon', 'half-later', 'check']);
});

test('the half-price date is read in the site\'s own timezone', () => {
  // 15:30 UTC on 12 Oct is already the 13th in Melbourne, but still the 12th in Perth.
  const card = { action: 'onHalfPrice' as const, daysLeft: 1, markedDownOn: '2026-10-12T15:30:00Z' };
  assert.match(cardInstruction(card, MELB), /since Tue 13 Oct/);
  assert.match(cardInstruction(card, 'Australia/Perth'), /since Mon 12 Oct/);
});
