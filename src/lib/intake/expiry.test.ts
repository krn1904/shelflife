import { test } from 'node:test';
import assert from 'node:assert/strict';
import { proposeExpiry } from './expiry';

test('prefers what this supplier actually sent last time', () => {
  const proposal = proposeExpiry({
    receivedOn: '2026-09-04',
    defaultShelfLifeDays: 270,
    previous: { receivedOn: '2026-06-01', expiryDate: '2027-01-01' }, // 214 days observed
  });
  assert.equal(proposal.date, '2027-04-06');
  assert.equal(proposal.basis, 'supplier-history');
  assert.equal(proposal.source, 'predicted');
});

test('shifts the observed shelf life forward rather than reusing the old date', () => {
  // The bug worth guarding: reproposing the previous expiry date verbatim. A product
  // delivered three months later expires three months later.
  const previous = { receivedOn: '2026-01-01', expiryDate: '2026-07-01' };
  const january = proposeExpiry({ receivedOn: '2026-01-01', defaultShelfLifeDays: null, previous });
  const april = proposeExpiry({ receivedOn: '2026-04-01', defaultShelfLifeDays: null, previous });
  assert.equal(january.date, '2026-07-01');
  assert.notEqual(april.date, '2026-07-01');
  assert.equal(april.date, '2026-09-29');
});

test('falls back to the catalogue shelf life with no history', () => {
  const proposal = proposeExpiry({
    receivedOn: '2026-09-04',
    defaultShelfLifeDays: 30,
    previous: null,
  });
  assert.equal(proposal.date, '2026-10-04');
  assert.equal(proposal.basis, 'catalogue-default');
});

test('discards implausible history instead of trusting it', () => {
  // One typo in a past delivery must not poison every future proposal.
  const backwards = proposeExpiry({
    receivedOn: '2026-09-04',
    defaultShelfLifeDays: 30,
    previous: { receivedOn: '2026-06-01', expiryDate: '2026-05-01' }, // expired before arrival
  });
  assert.equal(backwards.basis, 'catalogue-default');
  assert.equal(backwards.date, '2026-10-04');

  const absurd = proposeExpiry({
    receivedOn: '2026-09-04',
    defaultShelfLifeDays: 30,
    previous: { receivedOn: '2026-06-01', expiryDate: '2226-06-01' },
  });
  assert.equal(absurd.basis, 'catalogue-default');
});

test('proposes nothing rather than guessing when there is no basis', () => {
  const proposal = proposeExpiry({
    receivedOn: '2026-09-04',
    defaultShelfLifeDays: null,
    previous: null,
  });
  assert.equal(proposal.date, null);
  assert.equal(proposal.basis, 'none');
  // 'manual', not 'predicted' — nothing was predicted, so nothing should claim to be.
  assert.equal(proposal.source, 'manual');
});

test('crossing a month and a leap day lands on the right calendar date', () => {
  const proposal = proposeExpiry({
    receivedOn: '2028-02-27',
    defaultShelfLifeDays: 3,
    previous: null,
  });
  assert.equal(proposal.date, '2028-03-01'); // 2028 is a leap year
});
