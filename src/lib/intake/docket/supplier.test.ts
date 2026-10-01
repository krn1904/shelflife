import { test } from 'node:test';
import assert from 'node:assert/strict';
import fixtures from './fixtures.json';
import { abnsIn, isValidAbn } from './abn';
import { docketLessons, identifySupplier, normaliseSupplierName, printedSupplierName, supplierClues, type KnownSupplier } from './supplier';
import { REAL_DOCKETS } from './real-dockets';

const docket = (id: string) => fixtures.dockets.find((d) => d.id === id)!.lines;

test('ABN check digits: real ABNs pass, one misread digit fails', () => {
  assert.equal(isValidAbn('51 824 753 556'), true);   // the ATO's own worked example
  assert.equal(isValidAbn('33 051 775 556'), true);
  assert.equal(isValidAbn('51 824 753 557'), false);
  assert.equal(isValidAbn('5182475355'), false);
});

test('finds a valid ABN whatever OCR did to its label, and ignores invalid ones', () => {
  assert.deepEqual(abnsIn(['METCASH FOOD & GROCERY Aasn 51 824 753 556']), ['51824753556']);
  assert.deepEqual(abnsIn(['ABN 52 000 002 481']), []);           // fails the check: a misread
  assert.deepEqual(abnsIn(['ph 1300 555 812', 'Acct 5520931']), []);
  assert.deepEqual(abnsIn(['ABN 51824753556', 'ABN 51 824 753 556']), ['51824753556']);
});

test('supplier names normalise past case, punctuation and company suffixes', () => {
  assert.equal(normaliseSupplierName('LION DAIRY & DRINKS PTY LTD'), 'lion dairy drinks');
  assert.equal(normaliseSupplierName('Lion Dairy and Drinks'), 'lion dairy drinks');
  assert.equal(normaliseSupplierName("Campbell's Cash & Carry"), 'campbells cash carry');
});

test('reads the printed supplier name off every fixture letterhead', () => {
  const names = Object.fromEntries(fixtures.dockets.map((d) => [d.id, printedSupplierName(d.lines)]));
  assert.equal(names['A-cca-table.clean'], 'Coca-Cola Europacific Partners');
  assert.equal(names['B-no-headers.photo'], 'Sunrise Distributors');
  assert.equal(names['C-dairy-pipes.clean'], 'Lion Dairy & Drinks');
  assert.equal(names['D-receipt.photo'], 'Campbells Cash & Carry');
  assert.equal(names['E-local-bakery.clean'], 'Brunswick Bakehouse');
  assert.equal(names['F-two-line-items.photo'], 'Metcash Food & Grocery');
  assert.equal(names['G-abbreviated.photo'], 'Northern Beverage Wholesale');
});

const suppliers: KnownSupplier[] = [
  { id: 'cce', name: 'Coca-Cola Europacific', abn: null, aliases: [] },
  { id: 'lion', name: 'Lion Dairy & Drinks', abn: null, aliases: [] },
  { id: 'metcash', name: 'Metcash', abn: '51824753556', aliases: [] },
  { id: 'nbw', name: 'NBW', abn: null, aliases: ['northern beverage wholesale'] },
  { id: 'bakers', name: 'Bakers Delight DSD', abn: null, aliases: [] },
];

test('an ABN on file decides, whatever the name says', () => {
  const lines = ['Totally Different Name Pty Ltd', 'ABN 51 824 753 556'];
  assert.deepEqual(identifySupplier(lines, suppliers), { kind: 'matched', supplierId: 'metcash', via: 'abn' });
});

test('a confirmed printed name matches next time', () => {
  assert.deepEqual(identifySupplier(docket('G-abbreviated.photo'), suppliers),
    { kind: 'matched', supplierId: 'nbw', via: 'alias' });
});

test('the supplier name in the letterhead matches, suffixes and extra words aside', () => {
  assert.deepEqual(identifySupplier(docket('A-cca-table.photo'), suppliers),
    { kind: 'matched', supplierId: 'cce', via: 'name' });
  assert.deepEqual(identifySupplier(docket('C-dairy-pipes.clean'), suppliers),
    { kind: 'matched', supplierId: 'lion', via: 'name' });
});

test('a partial name is only a suggestion; a stranger is unknown', () => {
  assert.deepEqual(identifySupplier(['BAKERS DELIGHT', 'Docket 4471'], suppliers),
    { kind: 'suggested', supplierIds: ['bakers'] });
  assert.deepEqual(identifySupplier(docket('B-no-headers.clean'), suppliers), { kind: 'unknown' });
});

test('brand names in product lines are not read as the supplier', () => {
  const lines = ['FRESH & FAST FOOD SUPPLY', 'ph 9471 2200', 'Delivery 26/9', 'Qty Description',
    '1', '2', '3', '4', '5 Coca-Cola Europacific Zero 1.25L'];
  assert.deepEqual(identifySupplier(lines, suppliers), { kind: 'unknown' });
});

const metro = { orgName: 'Metro Petroleum', siteNames: ['Brunswick', 'Coburg', 'Preston'] };

test('the customer the docket is addressed to is never read as the supplier', () => {
  assert.equal(printedSupplierName(['Metro Petroleum Truganina', 'SUNRISE DISTRIBUTORS'], metro), 'Sunrise Distributors');
  for (const docket of REAL_DOCKETS) {
    assert.doesNotMatch(printedSupplierName(docket.lines, metro) ?? '', /metro/i, docket.id);
  }
  // A site name only rules out a line that is nothing but that name.
  assert.equal(printedSupplierName(['Brunswick Bakehouse'], metro), 'Brunswick Bakehouse');
});

test('an alias must be the docket\'s printed name, not just appear on it', () => {
  // Bega's dockets start "ROUTE TRANSPORT", so someone confirming Bega may teach that alias.
  const known: KnownSupplier[] = [
    { id: 'bega', name: 'Bega Dairy', abn: null, aliases: ['route transport'] },
    { id: 'metcash', name: 'Metcash', abn: null, aliases: [] },
  ];
  assert.deepEqual(identifySupplier(['METCASH FOOD & GROCERY', 'ROUTE TRANSPORT'], known),
    { kind: 'matched', supplierId: 'metcash', via: 'name' });
  assert.deepEqual(identifySupplier(['ROUTE TRANSPORT', 'Daily delivery docket'], known),
    { kind: 'matched', supplierId: 'bega', via: 'alias' });
});

test('with two ABNs on the docket, neither is taken as the supplier\'s', () => {
  const lines = ['Sunrise Distributors ABN 51 824 753 556', 'Bill to: Metro Petroleum ABN 33 051 775 556'];
  assert.equal(supplierClues(lines).abn, null);
  // One already on file still identifies its supplier.
  assert.deepEqual(identifySupplier(lines, [{ id: 's', name: 'Sunrise', abn: '51824753556', aliases: [] }]),
    { kind: 'matched', supplierId: 's', via: 'abn' });
});

test('learns only what the docket did not already say', () => {
  const known: KnownSupplier[] = [
    { id: 'lion', name: 'Lion Dairy & Drinks', abn: null, aliases: [] },
    { id: 'nbw', name: 'NBW', abn: null, aliases: [] },
  ];
  // Recognised by name: nothing to alias, but the ABN it printed is worth keeping.
  assert.deepEqual(docketLessons(['LION DAIRY & DRINKS PTY LTD', 'ABN 51 824 753 556'], known, 'lion', metro),
    { alias: null, abn: '51824753556' });
  // Not recognised, operator chose NBW: its printed name becomes the alias.
  assert.deepEqual(docketLessons(docket('G-abbreviated.clean'), known, 'nbw', metro),
    { alias: 'northern beverage wholesale', abn: null });
  // The store's own name is never learned.
  assert.deepEqual(docketLessons(['Metro Petroleum Brunswick', '12 x Pura Milk 2L'], known, 'nbw', metro),
    { alias: null, abn: null });
});
