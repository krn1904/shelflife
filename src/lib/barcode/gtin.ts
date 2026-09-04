/**
 * GTIN check-digit validation (EAN-8, UPC-A, EAN-13, GTIN-14).
 *
 * Every retail barcode carries a check digit, so a mistyped or misread code can be
 * rejected before it reaches the catalogue. That matters here because the catalogue
 * is global — one junk row from a typo is visible to every tenant.
 */

const VALID_LENGTHS = [8, 12, 13, 14];

/** Digits only, with the whitespace and hyphens people paste in stripped out. */
export function normaliseBarcode(raw: string): string {
  return raw.replace(/[\s-]/g, '');
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
