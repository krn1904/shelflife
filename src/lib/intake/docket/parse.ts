/**
 * Turns the OCR text of a supplier docket into delivery lines, with no per-supplier rules.
 *
 * Every OCR line gets a verdict. Most of a docket is not about what arrived — letterhead,
 * addresses, ABNs, totals, payment terms, promos, signatures — so the parser's main job is
 * to say *why* a line is dropped as plainly as why one is kept. A line is kept when it
 * matches a product the store stocks (the catalogue is the dictionary), or when it looks
 * like a product line on its own (a pack or size plus a quantity) so a new product still
 * reaches the operator instead of vanishing.
 */

export type CatalogueItem = { id: string; name: string; barcode?: string | null };

export type DropReason =
  | 'too short'
  | 'column headings'
  | 'company or contact details'
  | 'address'
  | 'reference or date'
  | 'totals or tax'
  | 'payment or terms'
  | 'sign-off'
  | 'promotion or note'
  | 'no product found';

export type Quantities = {
  ordered: number | null;
  supplied: number | null;
  /** How the quantity was read, shown to the operator when it looks wrong. */
  how: 'labelled' | 'n x name' | 'name xN' | 'first column' | 'two columns' | 'one number' | 'none';
};

export type DocketLine = {
  /** Index of the first OCR line this came from. */
  source: number;
  text: string;
  productId: string | null;
  productName: string | null;
  /** 1 = certain (barcode), 0 = no catalogue product (a possible new product). */
  confidence: number;
  via: 'barcode' | 'name' | 'new product?';
  pack: number | null;
  size: string | null;
  ordered: number | null;
  supplied: number | null;
  qtyHow: Quantities['how'];
  code: string | null;
};

export type LineVerdict =
  | { index: number; text: string; kept: true; lineIndex: number }
  | { index: number; text: string; kept: false; reason: DropReason }
  /** Folded into the product line above it: its barcode, its "Ord 5 Sup 4", or a wrapped description. */
  | { index: number; text: string; kept: 'merged'; into: number; what: 'barcode' | 'quantities' | 'description' };

export type DocketParse = { lines: DocketLine[]; verdicts: LineVerdict[] };

// ---------------------------------------------------------------------------------------
// Text clean-up

/** Fix the misreads OCR makes on docket text before anything else looks at it. */
export function normalise(raw: string): string {
  let s = ` ${raw} `;
  s = s.replace(/(\d)\s?m[l1|!I]?(?![a-z0-9])/gi, '$1ml');               // 500m| 500m! 500m → 500ml
  s = s.replace(/[|]/g, ' | ');                                         // pipes are column breaks
  s = s.replace(/(\d)\s*(?:lt|ltr|litres?)\b/gi, '$1l');                   // 2Lt → 2l
  s = s.replace(/(\d)[oOe]([0-9oOe]*)\s*ml/gi, (_m, a: string, b: string) => `${a}0${b.replace(/[oOe]/g, '0')}ml`); // 60eML → 600ml
  s = s.replace(/\bC[I1l]N\b/g, 'CTN');
  s = s.replace(/\b0([a-z]{2,})/gi, 'o$1');                             // 0AK → oAK
  s = s.replace(/(\d+(?:\.\d+)?)\s*(ml|l|g|kg)\b/gi, (_m, n: string, u: string) => `${n}${u.toLowerCase()}`);
  return s.replace(/\s+/g, ' ').trim();
}

const canonicalSize = (n: number, unit: string) =>
  unit === 'l' ? `${Math.round(n * 1000)}ml` : unit === 'kg' ? `${Math.round(n * 1000)}g` : `${n}${unit}`;

/** Pack and unit size: "24x500ml", "24 x 375ml", "12X1.25L", "170g ctn 12", "BOX 48". */
export function packOf(text: string): { pack: number | null; size: string | null } {
  const t = text.toLowerCase();
  const multi = t.match(/(\d{1,3})\s*x\s*(\d+(?:\.\d+)?)(ml|l|g|kg)\b/);
  if (multi) return { pack: Number(multi[1]), size: canonicalSize(Number(multi[2]), multi[3]) };
  const size = t.match(/(\d+(?:\.\d+)?)(ml|l|g|kg)\b/);
  const count = t.match(/\b(?:ctn|box|carton|pk|pack)\s*(\d{1,3})\b/) ?? t.match(/\b(\d{1,3})\s*pk\b/)
    ?? t.match(/\((\d{1,3})\)/);                                          // "500ml BTL (6)"
  return {
    pack: count ? Number(count[1]) : null,
    size: size ? canonicalSize(Number(size[1]), size[2]) : null,
  };
}

/** The quantities on a line once pack, size, codes and prices are out of the way. */
export function quantitiesOf(raw: string): Quantities {
  const t = normalise(raw);
  // Next to an Ord/Sup label a letter can only be a misread digit, but only the safe swaps.
  const digit = (v: string) => {
    const d = v.replace(/[oO]/g, '0').replace(/[iIl]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
    return /^\d+$/.test(d) ? Number(d) : null;
  };
  // Only the short column labels: prose like "back orders will be supplied" must not count.
  const labelled = t.match(/\bord\.?\s*([0-9oOiIlSB]{1,4})\b.*?\bsup\.?\s*([0-9a-zA-Z]{1,4})\b/i);
  if (labelled) return { ordered: digit(labelled[1]), supplied: digit(labelled[2]), how: 'labelled' };

  const lead = t.match(/^(\d{1,3})\s*x\s+[a-z]/i);                        // "2 x MARS BAR"
  if (lead) return { ordered: null, supplied: Number(lead[1]), how: 'n x name' };
  const tail = t.match(/\bx\s*(\d{1,3})\s*$/i);                           // "loaf 700g x6"
  if (tail) return { ordered: null, supplied: Number(tail[1]), how: 'name xN' };
  const firstColumn = t.match(/^(\d{1,4})\s*\|/);                           // "12 | 101204 | PURA…"
  if (firstColumn) return { ordered: null, supplied: Number(firstColumn[1]), how: 'first column' };

  const stripped = t
    .replace(/\d{1,3}\s*x\s*\d+(?:\.\d+)?(ml|l|g|kg)\b/gi, ' ')           // 24x500ml
    .replace(/\d+(?:\.\d+)?(ml|l|g|kg)\b/gi, ' ')                         // 500ml 170g
    .replace(/\b(ctn|box|carton|pk|pack)\s*\d{1,3}\b/gi, ' ')              // ctn 12
    .replace(/\b\d{1,3}\s*pk\b/gi, ' ')                                   // 24PK
    .replace(/\$?\d+[.,]\d{2}\b/g, ' ')                                    // prices
    .replace(/\b[a-z]*\d[a-z0-9]*[a-z][a-z0-9]*\b/gi, ' ')                 // codes mixing letters and digits
    .replace(/\b\d{5,}\b/g, ' ')                                          // numeric codes, barcodes
    .replace(/\b\d{1,3}s\b/gi, ' ');                                      // 25s
  const nums = [...stripped.matchAll(/\b(\d{1,4})\b/g)].map((m) => Number(m[1]));
  if (nums.length >= 2) return { ordered: nums[0], supplied: nums[1], how: 'two columns' };
  if (nums.length === 1) return { ordered: null, supplied: nums[0], how: 'one number' };
  return { ordered: null, supplied: null, how: 'none' };
}

// ---------------------------------------------------------------------------------------
// Irrelevant text: what a docket line is, when it is not a product

const NOISE: [DropReason, RegExp][] = [
  ['company or contact details', /\b(abn|acn|pty\.?\s*ltd|limited|ph|phone|tel|fax|mobile|email)\b|@\S+|\bwww\.|\.com(\.au)?\b|\b1[38]00\s?\d{3}\s?\d{3}\b|\b0[2-478][\s-]\d{4}[\s-]\d{4}\b/i],
  // A phone number needs its spaces: a bare ten-digit run is a product or account code.
  ['totals or tax', /\b(sub\s?total|total|gst|tax|amount due|balance|net amount|items?\s+\d+|eftpos|cash|change)\b/i],
  ['payment or terms', /\b(bsb|acc(ount)?\s*(no|#|\d)|bpay|eft|cheque|payment|terms|due date|refunds?|claims?|returns?|e\s?&\s?oe|property of|credited|back ?orders?)\b/i],
  ['sign-off', /\b(signature|sig|signed|received by|driver|thank you|thanks|checked by|pallets?|crates?|chep)\b/i],
  ['promotion or note', /%|\b(off|promo|special|ask your|now available|visit|member|points|keep refrigerated|note)\b/i],
  ['reference or date', /\b(invoice|inv|docket|dkt|delivery|route|stop|trans|reg|order no|po\s*(no|number)?|cust(omer)?|acct|account|page \d|date)\b|\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{1,2}:\d{2}\b/i],
  ['address', /\b(st|street|rd|road|ave|avenue|dr|drive|hwy|highway|lane|ln|pde|parade|cres|court|ct|place|pl|unit|shop|level|po box)\b.*\b(vic|nsw|qld|sa|wa|tas|nt|act)\b|\b(vic|nsw|qld|sa|wa|tas|nt|act)\s*\d{4}\b|\b(deliver|ship|bill|sold)\s*to\b/i],
];
const HEADING_WORDS = /\b(qty|quantity|description|desc|code|item|price|amount|amt|unit|uom|ord|sup|ext|value|product|ordered|picked|delivered|supplied)\b/gi;
const TABLE_END = /\b(sub\s?total|total|gst|amount due|balance)\b/i;

/** Why a line that is not a product line is on the docket at all. */
function noiseReason(text: string): DropReason | null {
  if ((text.match(HEADING_WORDS) ?? []).length >= 2 && !/\d(ml|l|g|kg)\b/i.test(text)) return 'column headings';
  for (const [reason, pattern] of NOISE) if (pattern.test(text)) return reason;
  return null;
}

/** Looks like a product line even when the catalogue does not know the product. */
const PRODUCT_SHAPED = /\d{1,3}\s*x\s*\d|\d(ml|l|g|kg)\b|\b\d{1,3}\s*pk\b|\bx\s*\d{1,3}\s*$|^\d{1,3}\s*x\s/i;

// ---------------------------------------------------------------------------------------
// Catalogue matching

const ALIASES: Record<string, string> = {
  coke: 'cocacola', coca: 'cocacola', smiths: 'smith', kelloggs: 'kellogg', tobys: 'toby', sf: 'sugarfree',
};
const STOP = new Set(['the', 'and', 'of', 'pet', 'btl', 'bottle', 'each', 'ea', 'ctn', 'box', 'pk', 'pack', 'x']);

const words = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9.\s-]/g, ' ').replace(/-/g, '')
  .split(/\s+/).filter(Boolean)
  .map((w) => ALIASES[w] ?? w)
  .map((w) => (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w))
  .filter((w) => /[a-z]/.test(w) && !/\d/.test(w) && w.length > 1 && !STOP.has(w));

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

const sameWord = (w: string, t: string) => t === w || (t.length >= 5 && w.length >= 4 && levenshtein(t, w) <= 1);

type Indexed = CatalogueItem & { tokens: string[]; size: string | null };

function buildIndex(catalogue: CatalogueItem[]) {
  const docs: Indexed[] = catalogue.map((p) => ({ ...p, tokens: [...new Set(words(p.name))], size: packOf(p.name).size }));
  const df = new Map<string, number>();
  for (const d of docs) for (const t of d.tokens) df.set(t, (df.get(t) ?? 0) + 1);
  // Rare words ("zero", "light", "classic") decide between near-duplicates; common ones barely count.
  const idf = (t: string) => Math.log(1 + docs.length / (df.get(t) ?? 0.5));
  return { docs, idf, vocab: new Set(df.keys()) };
}

type Index = ReturnType<typeof buildIndex>;

function bestMatch(index: Index, text: string) {
  const lineWords = words(text);
  const { size } = packOf(text);
  let best: { item: Indexed; score: number } | null = null;
  for (const d of index.docs) {
    const total = d.tokens.reduce((s, t) => s + index.idf(t), 0);
    if (total === 0) continue;
    let hit = 0;
    for (const t of d.tokens) if (lineWords.some((w) => sameWord(w, t))) hit += index.idf(t);
    // Catalogue words on the line that this product lacks ("classic" against a Zero) count against it.
    let extra = 0;
    for (const w of lineWords) if (index.vocab.has(w) && !d.tokens.some((t) => sameWord(w, t))) extra += index.idf(w) * 0.5;
    let score = hit / (total + extra);
    // Sizes separate 375ml from 500ml. An unreadable size never decides between variants.
    if (d.size && size) score += d.size === size ? 0.15 : -0.35;
    if (!best || score > best.score) best = { item: d, score };
  }
  return best;
}

// ---------------------------------------------------------------------------------------

const MATCH_AT = 0.55;

export function parseDocket(ocrLines: string[], catalogue: CatalogueItem[]): DocketParse {
  const index = buildIndex(catalogue);
  const byBarcode = new Map(catalogue.filter((p) => p.barcode).map((p) => [p.barcode!, p]));
  const lines: DocketLine[] = [];
  const verdicts: LineVerdict[] = [];

  // Most dockets are a table: a column-headings row, product rows, then totals. Inside it a
  // row is a product unless it plainly is not; outside it, text has to earn its place.
  const heading = ocrLines.findIndex((l) => noiseReason(normalise(l)) === 'column headings');
  const end = heading < 0 ? -1 : ocrLines.findIndex((l, i) => i > heading && TABLE_END.test(l));
  const inTable = (i: number) => heading >= 0 && i > heading && (end < 0 || i < end);

  ocrLines.forEach((raw, i) => {
    const text = normalise(raw);
    const drop = (reason: DropReason) => verdicts.push({ index: i, text: raw, kept: false, reason });
    if (text.replace(/[^a-z0-9]/gi, '').length < 3) return drop('too short');

    const codes = [...text.matchAll(/\b(\d{5,14})\b/g)].map((m) => m[1]);
    const previous = lines.at(-1);

    // A line that is only a barcode (and a price) belongs to the product line above it.
    const barcode = codes.find((c) => byBarcode.has(c));
    if (barcode && words(text).length === 0 && previous) {
      const product = byBarcode.get(barcode)!;
      Object.assign(previous, { productId: product.id, productName: product.name, via: 'barcode', confidence: 1 });
      return verdicts.push({ index: i, text: raw, kept: 'merged', into: lines.length - 1, what: 'barcode' });
    }

    // A line that only carries "Ord 5 Sup 4" belongs to the product line above it.
    const qty = quantitiesOf(text);
    if (qty.how === 'labelled' && previous && !words(text).some((w) => index.vocab.has(w))) {
      Object.assign(previous, { ordered: qty.ordered, supplied: qty.supplied, qtyHow: qty.how });
      return verdicts.push({ index: i, text: raw, kept: 'merged', into: lines.length - 1, what: 'quantities' });
    }

    const noise = noiseReason(text);
    const match = bestMatch(index, text);
    const { pack, size } = packOf(text);
    const line = (productId: string | null, productName: string | null, confidence: number, via: DocketLine['via']) => {
      lines.push({
        source: i, text: raw, productId, productName, confidence: Number(confidence.toFixed(2)), via,
        pack, size, ordered: qty.ordered, supplied: qty.supplied, qtyHow: qty.how, code: codes[0] ?? null,
      });
      verdicts.push({ index: i, text: raw, kept: true, lineIndex: lines.length - 1 });
    };

    // A strong product match wins even on a line that also mentions, say, "delivery".
    if (match && match.score >= MATCH_AT && (!noise || match.score >= 0.8 || inTable(i))) {
      return line(match.item.id, match.item.name, Math.min(1, match.score), 'name');
    }
    if (inTable(i)) {
      // Row or wrapped fragment? Judged on the raw words: matching ignores packaging words
      // like "bottle", but a fragment reading "Bottle" is still the row above continuing.
      const named = text.match(/[a-z]{3,}/gi) ?? [];
      const firstToken = text.split(' ')[0];
      const startsWithCode = /^[a-z]*\d[a-z0-9]*$/i.test(firstToken) && firstToken.length >= 4
        && !/^\d+(\.\d+)?(ml|l|g|kg)$/i.test(firstToken);
      // A product row carries a number (code, size or quantity); OCR'd ruling lines do not.
      if ((named.length >= 2 && /\d/.test(text)) || (startsWithCode && named.length >= 1)) {
        return line(null, null, 0, 'new product?');
      }
      // A fragment under a row ("Bottle", "400mL (6)") is that row's description wrapping.
      if (previous && (named.length >= 1 || packOf(text).size)) {
        previous.text = `${previous.text} ${raw.replace(/[|§]/g, ' ').replace(/\s+/g, ' ').trim()}`;
        const wrapped = packOf(normalise(previous.text));
        previous.pack ??= wrapped.pack;
        previous.size ??= wrapped.size;
        return verdicts.push({ index: i, text: raw, kept: 'merged', into: lines.length - 1, what: 'description' });
      }
    }
    if (noise) return drop(noise);
    if (PRODUCT_SHAPED.test(text) && words(text).length >= 2) return line(null, null, 0, 'new product?');
    return drop('no product found');
  });

  return { lines, verdicts };
}
