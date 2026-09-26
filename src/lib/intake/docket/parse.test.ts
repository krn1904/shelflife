import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalise, packOf, parseDocket, quantitiesOf } from './parse';
import fixtures from './fixtures.json';

// Real Tesseract output of nine synthetic dockets (clean scan and phone photo of each):
// six the parser was developed against (A–F) and three written after it was frozen (G–I).
type Truth = { product: string | null; qty: number; ordered?: number };
const dockets = fixtures.dockets as { id: string; lines: string[]; truth: Truth[] }[];

function score(docket: (typeof dockets)[number]) {
  const { lines } = parseDocket(docket.lines, fixtures.catalogue);
  const used = new Set<number>();
  let found = 0;
  let qty = 0;
  for (const t of docket.truth) {
    const i = lines.findIndex((l, k) => !used.has(k) && (t.product ? l.productId === t.product : l.via === 'new product?'));
    if (i < 0) continue;
    used.add(i);
    found++;
    if (lines[i].supplied === t.qty) qty++;
  }
  // Irrelevant text kept = lines beyond the docket's real product lines (a product line the
  // parser could not identify still counts as one of those, shown as "new product?").
  return { found, qty, truth: docket.truth.length, junk: Math.max(0, lines.length - docket.truth.length) };
}

function total(filter: (id: string) => boolean) {
  return dockets.filter((d) => filter(d.id)).map(score)
    .reduce((a, s) => ({ found: a.found + s.found, qty: a.qty + s.qty, truth: a.truth + s.truth, junk: a.junk + s.junk }),
      { found: 0, qty: 0, truth: 0, junk: 0 });
}

const developed = (id: string) => /^[A-F]-/.test(id);

test('finds every product on the dockets it was developed against', () => {
  const clean = total((id) => developed(id) && id.endsWith('.clean'));
  const photo = total((id) => developed(id) && id.endsWith('.photo'));
  assert.equal(clean.found, clean.truth);
  assert.equal(photo.found, photo.truth);
  assert.ok(photo.qty >= photo.truth - 2, `photo quantities ${photo.qty}/${photo.truth}`);
});

test('keeps no irrelevant text as a product line', () => {
  // Letterheads, addresses, ABNs, totals, terms, promos and signatures across all 18 dockets.
  const all = total(() => true);
  assert.equal(all.junk, 0, `${all.junk} irrelevant lines kept`);
});

test('holds its ground on dockets written after it was frozen', () => {
  // A floor, not a target: these expose the known weak spots (abbreviations, qty vs price).
  const unseen = total((id) => !developed(id));
  assert.ok(unseen.found >= 16, `unseen products ${unseen.found}/${unseen.truth}`);
});

test('drops the parts of a docket that are not deliveries, and says why', () => {
  const { verdicts } = parseDocket([
    'SUNRISE DISTRIBUTORS',
    'ABN 61 118 204 993',
    'Unit 4, 18 Industrial Dr, Campbellfield VIC 3061',
    'Docket 55812   23 Sep 2026',
    'Coca-Cola Zero Sugar 24x500ml     2',
    '** 5% off Red Bull all October **',
    'Total items 12   Amount due $512.40',
    'BSB 062-000 ACC 1234 5678',
    'Driver: Tony   Thank you for your business!',
  ], fixtures.catalogue);
  assert.deepEqual(verdicts.map((v) => (v.kept === false ? v.reason : 'kept')), [
    'no product found', 'company or contact details', 'address', 'reference or date', 'kept',
    'promotion or note', 'totals or tax', 'payment or terms', 'sign-off',
  ]);
});

test('reads pack notation however it is written', () => {
  for (const text of ['24x500ml', '24 x 500 ML', '24X500ML']) assert.deepEqual(packOf(normalise(text)), { pack: 24, size: '500ml' });
  assert.deepEqual(packOf(normalise('SPRITE PET 12X1.25L')), { pack: 12, size: '1250ml' });
  assert.deepEqual(packOf(normalise('Doritos 170g ctn12')), { pack: 12, size: '170g' });
});

test('reads quantities from every layout the tests cover', () => {
  assert.deepEqual(quantitiesOf('129354 COKE ZERO SUGAR CAN 24X375ML 3 2 CTN 38.40 76.80'),
    { ordered: 3, supplied: 2, how: 'two columns' });
  assert.equal(quantitiesOf('2 x MARS BAR 53G BOX 48').supplied, 2);
  assert.equal(quantitiesOf('White sandwich loaf 700g x6').supplied, 6);
  assert.equal(quantitiesOf(' 12 | 101204 | PURA FULL CREAM MILK 2L | EA').supplied, 12);
  assert.deepEqual(quantitiesOf('Ord2 Supo OUT OF STOCK'), { ordered: 2, supplied: 0, how: 'labelled' });
  assert.equal(quantitiesOf('Ord5 Supa @ $21.60').supplied, null, 'an unreadable digit is left for the operator');
  assert.equal(quantitiesOf('Back orders will be supplied on next delivery').how, 'none');
});
