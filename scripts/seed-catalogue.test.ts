import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidGtin } from '../src/lib/barcode/gtin';
import { SEED_CATALOGUE } from './seed-catalogue';

test('every seeded barcode passes the check digit the app enforces', () => {
  // Two of the original seed barcodes had invented check digits, which made them
  // impossible to type into the app the seed exists to demonstrate.
  for (const product of SEED_CATALOGUE) {
    assert.equal(isValidGtin(product.barcode), true,
      `${product.name} has an invalid barcode: ${product.barcode}`);
  }
});

test('seeded barcodes are unique', () => {
  const seen = new Set(SEED_CATALOGUE.map((p) => p.barcode));
  assert.equal(seen.size, SEED_CATALOGUE.length);
});

test('the demo covers all three tracking modes', () => {
  // The tracking-mode split is the case-study headline; a demo missing one of the
  // three cannot show it.
  const modes = new Set(SEED_CATALOGUE.map((p) => p.tracking_mode));
  assert.deepEqual([...modes].sort(), ['batch', 'none', 'rotation']);
});

test('batch products carry a shelf life to propose an expiry from', () => {
  for (const product of SEED_CATALOGUE.filter((p) => p.tracking_mode === 'batch')) {
    assert.ok((product.default_shelf_life_days ?? 0) > 0,
      `${product.name} is batch-tracked but has no default shelf life`);
  }
});
