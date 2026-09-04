/** Barcode check-digit tests. Run: npm run test:barcode */
import { validateBarcode } from '../src/lib/catalogue/barcode';

let passed = 0;
const failures: string[] = [];

function expect(name: string, ok: boolean, detail = '') {
  if (ok) { passed++; console.log(`  ok   ${name}`); }
  else { failures.push(name); console.log(`  FAIL ${name} ${detail}`); }
}

// Real AU EAN-13 codes carried by the seed catalogue.
for (const code of ['9300675024235', '9300601001019', '9310072020105', '9300682001007']) {
  const r = validateBarcode(code);
  expect(`accepts valid EAN-13 ${code}`, r.ok, r.ok ? '' : r.reason);
}

expect('accepts EAN-8', validateBarcode('96385074').ok);
expect('accepts UPC-A', validateBarcode('036000291452').ok);

const upc = validateBarcode('036000291452');
expect('pads UPC-A to 13 digits', upc.ok && upc.normalised === '0036000291452',
  upc.ok ? upc.normalised : '');

expect('rejects a bad check digit', !validateBarcode('9300675024236').ok);
expect('rejects the wrong length', !validateBarcode('12345').ok);
expect('rejects empty input', !validateBarcode('').ok);
expect('rejects letters', !validateBarcode('abcdefgh').ok);
expect('strips separators', validateBarcode('9300675-024235').ok);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
