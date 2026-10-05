import { test } from 'node:test';
import assert from 'node:assert/strict';
import { aliasToKeep, lookAlikes, SupplierEdit, SupplierMerge, supplierError, supplierOrder } from './upkeep';

const ID = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

test('an edit reads an ABN as printed, and refuses a short one', () => {
  const parsed = SupplierEdit.parse({ supplier_id: ID, name: '  Coca-Cola Europacific ', abn: '51 824 753 556', active: true });
  assert.equal(parsed.name, 'Coca-Cola Europacific');
  assert.equal(parsed.abn, '51824753556');
  assert.equal(SupplierEdit.safeParse({ supplier_id: ID, name: 'CCEP', abn: '1234', active: true }).success, false);
  assert.equal(SupplierEdit.safeParse({ supplier_id: ID, name: 'C', abn: null, active: true }).success, false);
  assert.equal(SupplierEdit.safeParse({ supplier_id: ID, name: 'CCEP', abn: null, active: false }).success, true);
});

test('a merge needs two different suppliers', () => {
  assert.equal(SupplierMerge.safeParse({ keep_id: ID, remove_id: OTHER }).success, true);
  assert.equal(SupplierMerge.safeParse({ keep_id: ID, remove_id: ID }).success, false);
  assert.equal(SupplierMerge.safeParse({ keep_id: '', remove_id: ID }).success, false);
});

test('the old name is kept for dockets that still print it, unless it matches the same way', () => {
  assert.equal(aliasToKeep('CCEP AUSTRALIA PTY LTD', 'Coca-Cola Europacific'), 'ccep');
  assert.equal(aliasToKeep('Lion Dairy & Drinks', 'Lion Dairy and Drinks'), null);
  assert.equal(aliasToKeep('Metcash', 'METCASH PTY LTD'), null);
  // Nothing left after the filler words: there is nothing to match on.
  assert.equal(aliasToKeep('Pty Ltd', 'Bakers Delight'), null);
});

test('look-alikes share an ABN or a name once "Pty Ltd" and punctuation are set aside', () => {
  const all = [
    { id: 'a', name: 'Lion Dairy & Drinks', abn: null, active: true },
    { id: 'b', name: 'LION DAIRY AND DRINKS PTY LTD', abn: null, active: true },
    { id: 'c', name: 'CCEP', abn: '51824753556', active: true },
    { id: 'd', name: 'Coca-Cola Europacific', abn: '51824753556', active: true },
    { id: 'e', name: 'Metcash', abn: null, active: true },
  ];
  assert.deepEqual(lookAlikes(all[0], all).map((s) => s.id), ['b']);
  assert.deepEqual(lookAlikes(all[2], all).map((s) => s.id), ['d']);
  assert.deepEqual(lookAlikes(all[4], all), []);
});

test('active suppliers list first, then by name', () => {
  const ordered = supplierOrder([
    { id: '1', name: 'Zeta', abn: null, active: true },
    { id: '2', name: 'Alpha', abn: null, active: false },
    { id: '3', name: 'Beta', abn: null, active: true },
  ]);
  assert.deepEqual(ordered.map((s) => s.name), ['Beta', 'Zeta', 'Alpha']);
});

test('refusals read as sentences', () => {
  assert.equal(supplierError({ code: '23505', message: 'another supplier is already called CCEP. Merge the two instead' }),
    'Another supplier is already called CCEP. Merge the two instead.');
  assert.equal(supplierError({ code: '42501', message: 'only an owner can merge suppliers' }), 'Only an owner can merge suppliers.');
  assert.equal(supplierError({ code: '42501', message: 'not permitted to change this supplier' }), 'You cannot change this supplier.');
  assert.equal(supplierError({ code: '08006' }), 'Could not save that (08006).');
});
