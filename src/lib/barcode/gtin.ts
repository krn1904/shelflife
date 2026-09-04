/**
 * GTIN check-digit validation (EAN-8, UPC-A, EAN-13, GTIN-14).
 *
 * Every retail barcode carries a check digit, so a mistyped or misread code can be
 * rejected before it reaches the catalogue. That matters here because the catalogue
 * is global — one junk row from a typo is visible to every tenant.
 */

const VALID_LENGTHS = [8, 13, 14]; // 12-digit UPC-A is padded to 13 by normaliseBarcode

/**
 * Strips the whitespace and hyphens people paste in, then pads UPC-A to 13 digits.
 *
 * UPC-A *is* EAN-13 with a leading zero, and scanners disagree about which form they
 * report — the native detector and zxing can return different strings for the same
 * physical barcode. Storing one canonical form is what stops that becoming two
 * catalogue rows for one product. Prepending the zero cannot change the check digit,
 * since weights are counted from the right and a leading zero adds nothing to the sum.
 *
 * Anything that is not a digit is left in place rather than stripped, so garbage is
 * rejected by isValidGtin instead of being silently coerced into a plausible code.
 */
export function normaliseBarcode(raw: string): string {
  const trimmed = raw.replace(/[\s-]/g, '');
  return trimmed.length === 12 && /^\d+$/.test(trimmed) ? `0${trimmed}` : trimmed;
}

export function isValidGtin(raw: string): boolean {
  const code = normaliseBarcode(raw);
  if (!VALID_LENGTHS.includes(code.length)) return false;
  if (!/^\d+$/.test(code)) return false;

  // Weights alternate 3,1 counting leftwards from the digit before the check digit.
  const body = code.slice(0, -1);
  const check = Number(code.at(-1));
  let sum = 0;
  for (let i = 0; i < body.length; i++) {
    const digit = Number(body[body.length - 1 - i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }

  return (10 - (sum % 10)) % 10 === check;
}
