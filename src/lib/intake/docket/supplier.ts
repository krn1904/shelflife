/**
 * Which supplier sent this docket, from the docket alone.
 *
 * Clues, strongest first: an ABN (self-checking, so a match is certain), a printed name
 * someone already confirmed for a supplier (an alias), then the supplier's own name in the
 * letterhead. Anything weaker is only a suggestion; the operator confirms either way,
 * because a wrong supplier would also file this delivery under the wrong history.
 */

import { abnsIn } from './abn';

export type KnownSupplier = {
  id: string;
  name: string;
  abn: string | null;
  /** Printed names confirmed for this supplier, already normalised. */
  aliases: string[];
};

export type SupplierClues = {
  abn: string | null;
  /** The supplier's name as printed, tidied up to pre-fill "Add supplier". */
  printedName: string | null;
};

export type SupplierIdentity =
  | { kind: 'matched'; supplierId: string; via: 'abn' | 'alias' | 'name' }
  | { kind: 'suggested'; supplierIds: string[] }
  | { kind: 'unknown' };

// The letterhead is at the top; product lines lower down name brands ("Coca-Cola Zero")
// that must not be read as the supplier, so it ends at the first line with a pack or size.
const LETTERHEAD_LINES = 8;
const PRODUCT_LINE = /\d\s?(ml|l|g|kg)\b|\b\d{1,3}\s*x\s*\d|\b\d{1,3}\s*pk\b/i;

function letterheadOf(lines: string[]): string[] {
  const top = lines.slice(0, LETTERHEAD_LINES);
  const end = top.findIndex((l) => PRODUCT_LINE.test(l));
  return end < 0 ? top : top.slice(0, end);
}

// Words that do not tell two suppliers apart.
const FILLER = new Set(['pty', 'ltd', 'limited', 'proprietary', 'the', 'and', 'australia', 'aust', 'au', 'group', 'co', 'inc']);

/** "LION DAIRY & DRINKS PTY LTD" and "Lion Dairy and Drinks" both become "lion dairy drinks". */
export function normaliseSupplierName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !FILLER.has(w))
    .join(' ');
}

function levenshtein(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const next = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = next;
    }
  }
  return row[b.length];
}

// One slip per long word: OCR reads "Campbelfeld" for "Campbellfield".
const sameWord = (a: string, b: string) => a === b || (a.length >= 5 && b.length >= 5 && levenshtein(a, b) <= 1);

/** Share of the supplier's words found in the line, 0–1. */
function overlap(supplierWords: string[], lineWords: string[]): number {
  if (supplierWords.length === 0) return 0;
  const hits = supplierWords.filter((w) => lineWords.some((l) => sameWord(w, l))).length;
  return hits / supplierWords.length;
}

const DOCUMENT_WORDS = /\b(tax invoice|invoice|delivery docket|docket|receipt|delivery note|statement|credit note)\b.*$/i;

function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/(^|[\s(&/-])([a-z])/g, (_m, p: string, c: string) => p + c.toUpperCase());
}

/**
 * Who the docket is addressed to: the store's organisation and site names. A docket prints
 * the customer near the top too ("Metro Petroleum Truganina"), and that must never be read,
 * or remembered, as the supplier.
 */
export type Customer = { orgName: string; siteNames: string[] };

function isCustomer(normalised: string, customer: Customer | undefined): boolean {
  if (!customer || !normalised) return false;
  const org = normaliseSupplierName(customer.orgName);
  if (org && ` ${normalised} `.includes(` ${org} `)) return true;
  return customer.siteNames.some((site) => normaliseSupplierName(site) === normalised);
}

/** The first letterhead line that reads like a business name, and is not the customer's. */
export function printedSupplierName(lines: string[], customer?: Customer): string | null {
  for (const raw of letterheadOf(lines)) {
    if (isCustomer(normaliseSupplierName(raw), customer)) continue;
    const name = raw
      .split(/\s{3,}|\s+[-–—|]\s+/)[0]                  // the left-hand column only
      .replace(/\s+\S{0,4}\s*\d{2}\s?\d{3}\s?\d{3}\s?\d{3}.*$/, '') // "Aasn 32 000 031 569": a mangled ABN label
      .replace(DOCUMENT_WORDS, '')
      .replace(/\b(pty\.?\s*ltd|limited|ltd)\.?\s*$/i, '')
      .replace(/[^a-z0-9&'.()\s-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const letters = name.replace(/[^a-z]/gi, '').length;
    if (letters >= 4 && /[a-z]{3,}/i.test(name) && !/\d/.test(name) && !isCustomer(normaliseSupplierName(name), customer)) {
      return titleCase(name);
    }
  }
  return null;
}

/**
 * The ABN only when the docket prints exactly one: a large tax invoice may also print the
 * buyer's, and learning the store's own ABN onto a supplier would match it to every docket.
 */
export function supplierClues(lines: string[], customer?: Customer): SupplierClues {
  const abns = abnsIn(lines);
  return { abn: abns.length === 1 ? abns[0] : null, printedName: printedSupplierName(lines, customer) };
}

export function identifySupplier(lines: string[], suppliers: KnownSupplier[], customer?: Customer): SupplierIdentity {
  const abns = abnsIn(lines);
  const byAbn = suppliers.find((s) => s.abn && abns.includes(s.abn));
  if (byAbn) return { kind: 'matched', supplierId: byAbn.id, via: 'abn' };

  // An alias is a whole printed name someone confirmed for a supplier, so it has to be this
  // docket's printed name exactly, not merely appear somewhere near the top.
  const printed = printedSupplierName(lines, customer);
  const printedKey = printed ? normaliseSupplierName(printed) : '';
  const byAlias = printedKey ? suppliers.find((s) => s.aliases.includes(printedKey)) : undefined;
  if (byAlias) return { kind: 'matched', supplierId: byAlias.id, via: 'alias' };

  const letterheadWords = letterheadOf(lines)
    .map((l) => normaliseSupplierName(l))
    .filter((l) => !isCustomer(l, customer))
    .map((l) => l.split(' ').filter(Boolean));

  const scored = suppliers
    .map((s) => {
      const words = normaliseSupplierName(s.name).split(' ').filter(Boolean);
      return { id: s.id, score: Math.max(0, ...letterheadWords.map((l) => overlap(words, l))) };
    })
    .filter((s) => s.score >= 0.5)
    .sort((a, b) => b.score - a.score);

  const whole = scored.filter((s) => s.score === 1);
  if (whole.length === 1) return { kind: 'matched', supplierId: whole[0].id, via: 'name' };
  if (scored.length > 0) return { kind: 'suggested', supplierIds: scored.slice(0, 3).map((s) => s.id) };
  return { kind: 'unknown' };
}

/**
 * What to remember once the operator has confirmed a supplier for this docket. Nothing, when
 * the docket already led straight to that supplier; otherwise its printed name as an alias
 * and its ABN, so the next docket from them is recognised without help.
 */
export function docketLessons(
  lines: string[],
  suppliers: KnownSupplier[],
  confirmedId: string,
  customer?: Customer,
): { alias: string | null; abn: string | null } {
  const identity = identifySupplier(lines, suppliers, customer);
  const clues = supplierClues(lines, customer);
  const confirmed = suppliers.find((s) => s.id === confirmedId);
  const abn = clues.abn && !confirmed?.abn ? clues.abn : null;
  if (identity.kind === 'matched' && identity.supplierId === confirmedId) return { alias: null, abn };
  return { alias: clues.printedName ? normaliseSupplierName(clues.printedName) : null, abn };
}
