/**
 * Barcode validation. Australian retail is almost entirely EAN-13, with EAN-8 on
 * small packs and the occasional UPC-A (12 digits) on imported stock.
 *
 * Validating the check digit locally matters: a misread barcode that reaches the
 * database creates a duplicate catalogue entry that someone has to clean up later,
 * and the scanner does misread under fluorescent light.
 */

export type BarcodeCheck =
  | { ok: true; normalised: string }
  | { ok: false; reason: string };

const VALID_LENGTHS = [8, 12, 13, 14];

/** UPC-A is EAN-13 with a leading zero; storing one form keeps lookups consistent. */
function normalise(raw: string) {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 12 ? `0${digits}` : digits;
}

/** GS1 mod-10: weight digits 3,1,3,1… from the right, excluding the check digit. */
function checkDigit(body: string) {
  let sum = 0;
  for (let i = body.length - 1, weight = 3; i >= 0; i--, weight = weight === 3 ? 1 : 3) {
    sum += Number(body[i]) * weight;
  }
  return (10 - (sum % 10)) % 10;
}

export function validateBarcode(raw: string): BarcodeCheck {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return { ok: false, reason: 'No digits in barcode' };
  if (!VALID_LENGTHS.includes(digits.length)) {
    return { ok: false, reason: `Expected 8, 12, 13 or 14 digits, got ${digits.length}` };
  }
  const expected = checkDigit(digits.slice(0, -1));
  if (expected !== Number(digits.at(-1))) {
    return { ok: false, reason: 'Check digit does not match — likely a misread' };
  }
  return { ok: true, normalised: normalise(digits) };
}
