import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isProductTable, normalise, packOf, parseDocket, parseDocketTable, quantitiesOf, type TableCell } from './parse';
import fixtures from './fixtures.json';
import { REAL_DOCKETS } from './real-dockets';

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

test('real docket: keeps every product row and nothing else', () => {
  for (const docket of REAL_DOCKETS) {
    const { lines } = parseDocket(docket.lines, fixtures.catalogue);
    assert.equal(lines.length, docket.products.length, `${docket.id}: ${lines.map((l) => l.text).join(' / ')}`);
    docket.products.forEach((name, i) => {
      const first = name.split(' ').slice(0, 3).join(' ');
      assert.ok(lines[i].text.includes(first), `${docket.id} row ${i}: expected ${name}, got ${lines[i].text}`);
    });
  }
});

test('real docket: wrapped rows are joined and sizes read', () => {
  const { lines } = parseDocket(REAL_DOCKETS[0].lines, fixtures.catalogue);
  const banana = lines.find((l) => l.text.includes('Banana'))!;
  assert.deepEqual([banana.size, banana.pack], ['400ml', 6]);
  const milk = lines.find((l) => l.text.includes('Pura Milk'))!;
  assert.equal(milk.size, '2000ml');
  assert.match(lines.find((l) => l.text.includes('Dairy Choice'))!.text, /HDPE .*Bottle/);
});

test('real docket photo: reads the printed Ordered column and checks it against cartons', () => {
  for (const docket of REAL_DOCKETS.filter((d) => d.ordered)) {
    const { lines } = parseDocket(docket.lines, fixtures.catalogue);
    const read = lines.map((l) => l.ordered);
    const right = read.filter((q, i) => q === docket.ordered![i]).length;
    // Cleaned-up photo: every row. As taken: OCR loses a figure or two, never invents one.
    if (docket.id.includes('cleaned up')) assert.deepEqual(read, docket.ordered, docket.id);
    else assert.ok(right >= 9, `${docket.id}: ${read.join(',')}`);
    // Handwritten ticks in Picked never become the quantity received.
    lines.forEach((l, i) => assert.ok(l.supplied === null || l.supplied === docket.ordered![i], `${docket.id} row ${i}: ${l.supplied}`));
    // Wherever cartons, eaches and pack are all readable, they agree with the quantity.
    assert.ok(lines.every((l) => l.check !== 'disagrees'), docket.id);
    assert.ok(lines.filter((l) => l.check === 'agrees').length >= 6, docket.id);
  }
});

// ---------------------------------------------------------------------------------------
// Tables read cell by cell (AWS Textract)

const grid = (rows: string[][], unsure: [number, number][] = []): TableCell[][] =>
  rows.map((row, r) => row.map((text, c) => ({
    text, confidence: unsure.some(([ur, uc]) => ur === r && uc === c) ? 55 : 98, header: r === 0,
  })));

test('table: quantities come from their own column, even beside an empty cell', () => {
  const { lines } = parseDocketTable(grid([
    ['Code', 'Description', 'Ordered', 'Delivered', 'Price'],
    ['101204', 'Pura Milk Full Cream 2L', '12', '', '38.40'],
    ['101206', 'Pura Light Start 2L', '', '6', '19.20'],
    ['400123', 'Oak Chocolate Milk 600ml', '10', '8', '32.00'],
  ]), fixtures.catalogue);
  assert.deepEqual(lines.map((l) => [l.productId, l.ordered, l.supplied]), [
    ['pura-fc-2l', 12, 12],
    ['pura-light-2l', null, 6],
    ['oak-choc-600', 10, 8],
  ]);
  assert.deepEqual(lines.map((l) => l.code), ['101204', '101206', '400123']);
});

test('table: totals end it, wrapped descriptions join the row above, unknown rows stay', () => {
  const { lines, verdicts } = parseDocketTable(grid([
    ['Item', 'Product Description', 'Qty'],
    ['0044120', 'Heinz Baked Beans', '4'],
    ['', '420g CTN 12', ''],
    ['7788', 'Mystery Kombucha 330ml', '2'],
    ['', 'Sub total', '6'],
    ['', 'GST', '0'],
  ]), fixtures.catalogue);
  assert.deepEqual(lines.map((l) => [l.productId, l.supplied]), [['heinz-beans-420', 4], [null, 2]]);
  assert.equal(lines[0].size, '420g');
  assert.equal(lines[1].via, 'new product?');
  assert.deepEqual(verdicts.filter((v) => v.kept === false).map((v) => v.kept === false && v.reason),
    ['column headings', 'totals or tax', 'totals or tax']);
});

test('table: a Picked column means Delivered is handwriting, so Ordered is the claim', () => {
  const { lines } = parseDocketTable(grid([
    ['Description', 'Ordered', 'Picked', 'Delivered'],
    ['Pura Milk Full Cream 2L', '18', '1', '7'],
  ]), fixtures.catalogue);
  assert.deepEqual([lines[0].ordered, lines[0].supplied], [18, 18]);
});

test('table: a doubtful quantity cell marks the row unsure', () => {
  const { lines } = parseDocketTable(grid([
    ['Description', 'Qty'],
    ['Pura Milk Full Cream 2L', '12'],
    ['Oak Chocolate Milk 600ml', '8'],
  ], [[2, 1]]), fixtures.catalogue);
  assert.deepEqual(lines.map((l) => l.unsure), [false, true]);
});

test('table: without headings the rows go through the line parser', () => {
  const { lines } = parseDocketTable(grid([['5', 'Coca-Cola Zero Sugar 1.25L', '38.00']]).map((r) => r.map((c) => ({ ...c, header: false }))),
    fixtures.catalogue);
  assert.equal(lines[0].productId, 'coke-zero-125');
});

test('tells a product table from a letterhead table', () => {
  assert.equal(isProductTable(grid([['Description', 'Qty'], ['Pura Milk 2L', '2']])), true);
  assert.equal(isProductTable(grid([['Customer #', '256582'], ['Route', 'MELO11']]).map((r) => r.map((c) => ({ ...c, header: false })))), false);
});

test('products this supplier has sent before win a close call', () => {
  // A docket line with no size fits every Zero Sugar bottle equally; the supplier's own
  // history settles it without the docket having to spell it out.
  const plain = parseDocket(['Coca-Cola Zero Sugar x6'], fixtures.catalogue).lines[0];
  const preferred = parseDocket(['Coca-Cola Zero Sugar x6'], fixtures.catalogue, { preferred: ['coke-zero-600'] }).lines[0];
  assert.equal(preferred.productId, 'coke-zero-600');
  assert.notEqual(plain.productId, 'coke-zero-600');
});

test('supplier history never beats a clearly better match', () => {
  // The supplier usually sends the 500ml, but this docket line names the 1.25L.
  const { lines } = parseDocket(['Coca-Cola Zero Sugar 1.25L x6'], fixtures.catalogue, { preferred: ['coke-zero-500'] });
  assert.equal(lines[0].productId, 'coke-zero-125');
});

test('table: a real Bega layout reads the description column, not the product code', () => {
  // Headings and rows as Textract returned them for the Bega daily delivery docket.
  const { lines, verdicts } = parseDocketTable(grid([
    ['Delivery #', 'Crates/ Cartons', 'Eaches', 'Product Code', 'Product Description', 'Ordered', 'Picked', 'Delivered'],
    ['0827408699', '2', '0', '3024 I EA', 'EA I Pura Milk 2Lt Bottle', '18', '', ''],
    ['', '1', '3', '3278 EA', 'Pura Light Start 2Lt Bottle', '9', '', ''],
    ['', '0', '6', '7774 EA', 'Dare Espresso 500ml BTL (6)', '6', '', ''],
    ['', '11', '4', '', '', '85', '85', ''],
  ]), fixtures.catalogue);
  assert.deepEqual(lines.map((l) => [l.text, l.code, l.ordered]), [
    ['EA I Pura Milk 2Lt Bottle', '3024 I EA', 18],
    ['Pura Light Start 2Lt Bottle', '3278 EA', 9],
    ['Dare Espresso 500ml BTL (6)', '7774 EA', 6],
  ]);
  assert.deepEqual(lines.slice(0, 2).map((l) => l.productId), ['pura-fc-2l', 'pura-light-2l']);
  // The unlabelled totals row under the table is not a product.
  assert.equal(verdicts.at(-1)!.kept, false);
});
