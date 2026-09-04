import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidGtin, normaliseBarcode } from './gtin';

test('accepts real AU retail barcodes', () => {
  // Every one of these is a check-digit-valid GTIN used by the seed catalogue.
  for (const code of [
    '9300675024235', // Coke Zero 1.25L (EAN-13)
    '9300601001019', // Pura Full Cream 2L
    '9310072020105', // Tip Top White Sandwich
    '036000291452',  // UPC-A
    '96385074',      // EAN-8
  ]) {
    assert.equal(isValidGtin(code), true, `${code} should be valid`);
  }
});

test('rejects a single transposed digit', () => {
  assert.equal(isValidGtin('9300675024235'), true);
  assert.equal(isValidGtin('9300675024253'), false);
});

test('rejects a wrong check digit', () => {
  assert.equal(isValidGtin('9300675024236'), false);
});

test('rejects lengths that are not a GTIN', () => {
  for (const code of ['', '1', '123456', '930067502423', '930067502423512']) {
    assert.equal(isValidGtin(code), false, `${code} should be rejected`);
  }
});

test('rejects non-digits rather than coercing them', () => {
  assert.equal(isValidGtin('93006750242AB'), false);
});

test('tolerates the spacing and hyphens people paste in', () => {
  assert.equal(normaliseBarcode(' 9300675-024235 '), '9300675024235');
  assert.equal(isValidGtin(' 9300675-024235 '), true);
});
