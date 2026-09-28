/**
 * Australian Business Numbers on a docket. An ABN carries its own check (the ATO's
 * modulus-89 rule), so a digit OCR misread fails it and is ignored instead of pointing the
 * delivery at the wrong supplier. The "ABN" label is not required: OCR mangles it ("Aasn",
 * "#sn", "on") far more often than the digits beside it.
 */

const WEIGHTS = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];

/** Digits only, or null when it is not eleven of them. */
export function cleanAbn(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return digits.length === 11 ? digits : null;
}

export function isValidAbn(raw: string): boolean {
  const abn = cleanAbn(raw);
  if (!abn || abn[0] === '0') return false;
  const sum = [...abn].reduce((total, d, i) => total + (Number(d) - (i === 0 ? 1 : 0)) * WEIGHTS[i], 0);
  return sum % 89 === 0;
}

/** "51824753556" → "51 824 753 556", the way it is printed. */
export function formatAbn(abn: string): string {
  return abn.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, '$1 $2 $3 $4');
}

/** Every valid ABN on the docket, first-printed first, without repeats. */
export function abnsIn(lines: string[]): string[] {
  const found: string[] = [];
  for (const line of lines) {
    // Printed "51 824 753 556", or run together; never part of a longer number.
    for (const match of line.matchAll(/(?<!\d)(\d{2}\s?\d{3}\s?\d{3}\s?\d{3})(?!\d)/g)) {
      const abn = cleanAbn(match[1]);
      if (abn && isValidAbn(abn) && !found.includes(abn)) found.push(abn);
    }
  }
  return found;
}
