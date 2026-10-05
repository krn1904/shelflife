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
  how: 'labelled' | 'n x name' | 'name xN' | 'first column' | 'two columns' | 'one number' | 'none'
    | 'by heading' | 'from cartons';
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
  /** Printed cartons and loose units, when the docket has those columns. */
  cartons: number | null;
  eaches: number | null;
  /** cartons × pack + eaches against the quantity: a free check on the OCR. */
  check: 'agrees' | 'disagrees' | null;
  code: string | null;
  /** The OCR engine was unsure of this row's description or quantities (Textract only). */
  unsure?: boolean;
  /** Price of one unit as printed, when a table column makes that certain (Textract only). */
  unitPrice?: number | null;
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
  s = s.replace(/\b([0-9SOo]{2,4})(?=\s?(ml|l|g|kg)\b)/gi, (m: string) => (/\d/.test(m) ? m.replace(/S/gi, '5').replace(/O/gi, '0') : m)); // S00ml → 500ml
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
// Quantities by column heading
//
// When the docket has a headings row, a number's column says what it is: the first number
// after the description sits under the first quantity heading after "Description". The
// words are general (Ordered, Qty, Picked, Delivered, Supplied, Cartons, Eaches), never a
// particular supplier's layout.

type Column = 'ordered' | 'picked' | 'delivered' | 'qty' | 'cartons' | 'eaches';

const COLUMN_WORDS: [Column, RegExp][] = [
  ['ordered', /^(ordered|order|ord)$/i],
  ['picked', /^pick(ed)?$/i],
  ['delivered', /^(deliv\w*|delv\w*|supplied|supp?|received|recd?)$/i],
  ['qty', /^(qty|quantity)$/i],
  ['cartons', /^(cartons?|crates?|ctns?|cases?)$/i],
  ['eaches', /^(eaches|each|units?)$/i],
];
const UNIT_WORDS = /^(ea|each|ctn|ctns|carton|cartons|box|pk|pack|unit|units|uom|btl|pet|can)$/i;

export type Columns = { before: Column[]; after: Column[] };

export function columnsOf(heading: string): Columns {
  const tokens = normalise(heading).split(/[\s/|]+/);
  const split = tokens.findIndex((t) => /^(description|desc|product)$/i.test(t));
  const columns = (list: string[]) => list.flatMap((t) => {
    const hit = COLUMN_WORDS.find(([, re]) => re.test(t.replace(/[^a-z]/gi, '')));
    return hit ? [hit[0]] : [];
  });
  if (split < 0) return { before: [], after: columns(tokens) };
  return { before: columns(tokens.slice(0, split)), after: columns(tokens.slice(split + 1)) };
}

/** A bare quantity, forgiving the stray mark OCR leaves beside it: "18)", "9|", "12f", "—6". */
const QTY_TOKEN = /^[—_~-]?(\d{1,4})[^\d\s]?$/;
const SKIP_TOKEN = (t: string) =>
  /^\d+(\.\d+)?(ml|l|g|kg)$/i.test(t) || /^\(\d{1,3}\)$/.test(t) || /^\d{1,3}x\d/i.test(t)
  || /^\$?\d+[.,]\d{2}$/.test(t) || /^\d{1,3}pk$/i.test(t) || UNIT_WORDS.test(t);

export function quantitiesInColumns(raw: string, columns: Columns) {
  const tokens = normalise(raw).split(' ').filter((t) => t !== '|');
  const descStart = tokens.findIndex((t) => /^[a-z][a-z'&.-]{2,}$/i.test(t) && !UNIT_WORDS.test(t));
  if (descStart < 0) return null;

  const found: Partial<Record<Column, number>> = {};
  // Before the description: small numbers only; long runs are delivery numbers and codes.
  const before = tokens.slice(0, descStart).filter((t) => /^\d{1,3}$/.test(t)).map(Number);
  const beforeCols = [...columns.before];
  // "Cartons" is often lost from an OCR'd heading; a number ahead of "Eaches" is cartons.
  if (beforeCols.includes('eaches') && !beforeCols.includes('cartons') && before.length >= 2) {
    beforeCols.splice(beforeCols.indexOf('eaches'), 0, 'cartons');
  }
  // Aligned from the right: the columns nearest the description are the ones OCR keeps.
  beforeCols.slice(-before.length).forEach((c, k) => { found[c] = before[before.length - Math.min(before.length, beforeCols.length) + k]; });

  const after: number[] = [];
  for (const t of tokens.slice(descStart + 1)) {
    if (SKIP_TOKEN(t)) continue;
    const q = t.match(QTY_TOKEN);
    if (q) after.push(Number(q[1]));
  }
  columns.after.forEach((c, k) => { if (after[k] !== undefined) found[c] ??= after[k]; });
  return found;
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

/** Every plausible product for a line, best first. */
function rankMatches(index: Index, text: string, only?: Set<string>) {
  const lineWords = words(text);
  const { size } = packOf(text);
  const ranked: { item: Indexed; score: number }[] = [];
  for (const d of index.docs) {
    if (only && !only.has(d.id)) continue;
    // Two different sizes are two different products: better unmatched than wrong.
    if (d.size && size && d.size !== size) continue;
    const total = d.tokens.reduce((s, t) => s + index.idf(t), 0);
    if (total === 0) continue;
    let hit = 0;
    let exact = false;
    for (const t of d.tokens) {
      if (lineWords.includes(t)) exact = true;
      if (lineWords.some((w) => sameWord(w, t))) hit += index.idf(t);
    }
    // A near-spelling alone ("Greek" for "Green") is not a match: one word must be spelt out.
    if (!exact) continue;
    // Catalogue words on the line that this product lacks ("classic" against a Zero) count against it.
    let extra = 0;
    for (const w of lineWords) if (index.vocab.has(w) && !d.tokens.some((t) => sameWord(w, t))) extra += index.idf(w) * 0.5;
    let score = hit / (total + extra);
    // Matching sizes separate 375ml from 500ml. An unreadable size never decides between variants.
    if (d.size && size) score += 0.15;
    ranked.push({ item: d, score });
  }
  return ranked.sort((x, y) => y.score - x.score);
}

function bestMatch(index: Index, text: string, only?: Set<string>) {
  return rankMatches(index, text, only)[0] ?? null;
}

const MATCH_AT = 0.55;

export type ParseOptions = {
  /**
   * Products this supplier has delivered to this site before. They are tried first, so an
   * abbreviated docket line settles on the product that actually comes from this supplier
   * rather than a look-alike elsewhere in the catalogue. They never add lines of their own.
   */
  preferred?: string[];
};

// Scores this close are a tie, which the supplier's own history may break.
const TIE = 0.05;

function matcherFor(catalogue: CatalogueItem[], options: ParseOptions) {
  const index = buildIndex(catalogue);
  const preferred = new Set(options.preferred ?? []);
  return {
    index,
    match(text: string) {
      const best = bestMatch(index, text);
      if (preferred.size === 0 || !best) return best;
      // History only settles a near-tie: it never beats a clearly better match, such as
      // the 1.25L the docket names over the 600ml this supplier usually sends.
      const likely = bestMatch(index, text, preferred);
      return likely && likely.score >= MATCH_AT && likely.score >= best.score - TIE ? likely : best;
    },
  };
}

/** Cartons × pack + each is the docket checking itself. Run once rows are whole. */
function checkCartons(lines: DocketLine[]) {
  for (const l of lines) {
    if (l.cartons === null || l.eaches === null || l.pack === null) continue;
    const expected = l.cartons * l.pack + l.eaches;
    if (l.ordered === null && l.supplied === null) {
      Object.assign(l, { ordered: expected, supplied: expected, qtyHow: 'from cartons', check: 'agrees' });
    } else {
      l.check = (l.ordered ?? l.supplied) === expected ? 'agrees' : 'disagrees';
    }
  }
}

/**
 * Printed Ordered against Delivered. A docket with a Picked column is a pick-and-check
 * sheet: Picked and Delivered are ticked or written by hand, and handwriting reads as noise.
 * The printed Ordered figure is the claim; the operator confirms what actually arrived.
 */
function orderedAndSupplied(found: Partial<Record<Column, number | null>>, handFilled: boolean) {
  const ordered = found.ordered ?? null;
  const delivered = handFilled ? null : found.delivered ?? found.qty ?? null;
  const supplied = delivered !== null && (ordered === null || delivered <= ordered) ? delivered : ordered;
  return { ordered, supplied, how: (ordered === null && supplied === null ? 'none' : 'by heading') as Quantities['how'] };
}

// ---------------------------------------------------------------------------------------

export function parseDocket(ocrLines: string[], catalogue: CatalogueItem[], options: ParseOptions = {}): DocketParse {
  const { index, match: matchText } = matcherFor(catalogue, options);
  const byBarcode = new Map(catalogue.filter((p) => p.barcode).map((p) => [p.barcode!, p]));
  const lines: DocketLine[] = [];
  const verdicts: LineVerdict[] = [];

  // Most dockets are a table: a column-headings row, product rows, then totals. Inside it a
  // row is a product unless it plainly is not; outside it, text has to earn its place.
  const heading = ocrLines.findIndex((l) => noiseReason(normalise(l)) === 'column headings');
  const end = heading < 0 ? -1 : ocrLines.findIndex((l, i) => i > heading && TABLE_END.test(l));
  const inTable = (i: number) => heading >= 0 && i > heading && (end < 0 || i < end);
  const columns = heading >= 0 ? columnsOf(ocrLines[heading]) : null;
  const quantityColumns = columns && [...columns.before, ...columns.after].some((c) => c !== 'cartons' && c !== 'eaches');

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
    const match = matchText(text);
    const { pack, size } = packOf(text);
    const line = (productId: string | null, productName: string | null, confidence: number, via: DocketLine['via']) => {
      let { ordered, supplied, how } = qty;
      const byColumn = inTable(i) && columns && quantityColumns ? quantitiesInColumns(raw, columns) : null;
      if (byColumn) {
        // Inside a headed table the columns decide. Nothing readable under them means the
        // operator fills it in; the crates and eaches ahead of the description are not it.
        ({ ordered, supplied, how } = orderedAndSupplied(byColumn, columns!.after.includes('picked')));
      }
      lines.push({
        source: i, text: raw, productId, productName, confidence: Number(confidence.toFixed(2)), via,
        pack, size, ordered, supplied, qtyHow: how,
        cartons: byColumn?.cartons ?? null, eaches: byColumn?.eaches ?? null, check: null, code: codes[0] ?? null,
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
      const fragment = packOf(text);
      if (previous && (named.length >= 1 || fragment.size || fragment.pack)) {
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

  // After the loop, since a pack size often sits on a wrapped line ("400mL (6)").
  checkCartons(lines);
  return { lines, verdicts };
}

// ---------------------------------------------------------------------------------------
// Tables read cell by cell (AWS Textract)
//
// Textract returns the product table as a grid, so a quantity is known by the heading of the
// column it sits in, not by counting numbers along a line. An empty Delivered cell stays
// empty instead of pulling the next number into its place.

export type TableCell = { text: string; confidence: number; header?: boolean };

// Below this Textract confidence, a row is worth a second look.
const SURE_AT = 80;

// unitPrice: "Unit Price", "Price Each". price: a bare "Price", which may be per unit or
// the line total. amount: the line total ("Amount", "Ext", "Total").
type PriceRole = 'unitPrice' | 'price' | 'amount';
type ColumnRole = Column | PriceRole | 'description' | 'code' | null;
const isPriceRole = (role: ColumnRole): role is PriceRole => role === 'unitPrice' || role === 'price' || role === 'amount';

function roleOf(heading: string): ColumnRole {
  const t = heading.toLowerCase();
  // "Product Description" is the description and "Product Code" the code: the second word
  // decides, since "product" heads both.
  if (/\b(description|desc|details)\b/.test(t)) return 'description';
  // A bare "Item" heads the item number; "Item Description" was caught above.
  if (/\b(code|sku|article|barcode|plu|item)\b/.test(t) && !/\bqty\b/.test(t)) return 'code';
  // "Delivery #", "Invoice No": a reference number, not a quantity column.
  if (/#|\bno\.?$|\bnumber\b/.test(t)) return null;
  if (/\bproduct\b/.test(t)) return 'description';
  // Money columns, checked before quantities so "Unit Price" is not read as a units count.
  // A quantity word wins ("Total Delivered", "Total Qty"); "Order Total" is still money.
  const countWord = t.split(/[\s/|.]+/).some((word) =>
    COLUMN_WORDS.some(([column, re]) => column !== 'ordered' && re.test(word.replace(/[^a-z]/g, ''))));
  if (/\b(amount|amt|total|ext\w*|value|nett?)\b/.test(t) && !countWord) return 'amount';
  if (/\bunit\s*(price|cost)\b|\b(price|cost)\s*(ea|each|per\b.*)\b|\brate\b/.test(t)) return 'unitPrice';
  if (/\b(price|cost)\b/.test(t)) return 'price';
  for (const word of t.split(/[\s/|.]+/)) {
    const hit = COLUMN_WORDS.find(([, re]) => re.test(word.replace(/[^a-z]/g, '')));
    if (hit) return hit[0];
  }
  return null;
}

const headingLike = (row: TableCell[]) =>
  row.some((c) => c.header) || row.filter((c) => (c.text.match(HEADING_WORDS) ?? []).length > 0).length >= 2;

/** A bare count in a cell: "18", "18.00", "18 ea". Prices and sizes are not counts. */
function countIn(text: string): number | null {
  const t = normalise(text).replace(/\b(ea|each|ctn|ctns|units?)\b/gi, '').trim();
  const m = t.match(/^[—_~-]?(\d{1,4})(?:\.0+)?[^\d\s]?$/);
  return m ? Number(m[1]) : null;
}

/** Money in a cell: "$3.20", "3.20", "1,250.00". Whole numbers are not prices here. */
function moneyIn(text: string): number | null {
  const m = text.replace(/\s/g, '').match(/^\$?(\d{1,3}(?:,\d{3})*|\d+)\.(\d{2})$/);
  return m ? Number(`${m[1].replace(/,/g, '')}.${m[2]}`) : null;
}

/**
 * The price of one unit, only when the table makes it certain. A "Unit Price" column is
 * taken as is; a bare "Price" only when an amount column proves it is per unit. When an
 * amount is printed, price × quantity must match it, which also catches carton prices
 * beside a unit count. Anything doubtful is null: no price beats a wrong one.
 */
function unitPriceOf(
  cells: Partial<Record<PriceRole, number | null>>,
  qty: number | null,
  qtyFromCartons: boolean,
): number | null {
  const amount = cells.amount ?? null;
  const price = cells.unitPrice ?? (amount !== null ? cells.price ?? null : null);
  if (price === null || price <= 0) return null;
  if (amount !== null) {
    if (!qty) return null;
    return Math.abs(price * qty - amount) <= Math.max(0.02, amount * 0.01) ? price : null;
  }
  // No amount to check against, and the count was worked out from cartons: the price is
  // probably per carton, so leave it.
  return qtyFromCartons ? null : price;
}

/** True when a table's heading row looks like a product table's. */
export function isProductTable(rows: TableCell[][]): boolean {
  const heading = rows.findIndex(headingLike);
  if (heading < 0) return false;
  const roles = rows[heading].map((c) => roleOf(c.text));
  return roles.includes('description') || (roles.some((r) => r && r !== 'code' && !isPriceRole(r)) && rows.length - heading > 1);
}

export function parseDocketTable(rows: TableCell[][], catalogue: CatalogueItem[], options: ParseOptions = {}): DocketParse {
  const heading = rows.findIndex(headingLike);
  const joined = (row: TableCell[]) => row.map((c) => c.text).filter(Boolean).join(' | ');
  // No headings: nothing to read columns by, so the row text goes through the line parser.
  if (heading < 0) return parseDocket(rows.map(joined), catalogue, options);

  const { match: matchText } = matcherFor(catalogue, options);
  const byBarcode = new Map(catalogue.filter((p) => p.barcode).map((p) => [p.barcode!, p]));
  const roles = rows[heading].map((c) => roleOf(c.text));
  // No Description heading: the description is whichever column carries the most words.
  let description = roles.indexOf('description');
  if (description < 0) {
    const letters = roles.map((_, c) => rows.slice(heading + 1).reduce((n, r) => n + (r[c]?.text.match(/[a-z]/gi)?.length ?? 0), 0));
    description = letters.indexOf(Math.max(...letters));
  }
  const handFilled = roles.includes('picked');
  const lines: DocketLine[] = [];
  const verdicts: LineVerdict[] = [];
  let ended = false;

  rows.forEach((row, i) => {
    const text = joined(row);
    const drop = (reason: DropReason) => verdicts.push({ index: i, text, kept: false, reason });
    if (i < heading) return drop(noiseReason(normalise(text)) ?? 'reference or date');
    if (i === heading) return drop('column headings');
    if (ended || TABLE_END.test(text)) { ended = true; return drop('totals or tax'); }

    const desc = row[description]?.text.trim() ?? '';
    const found: Partial<Record<Column, number | null>> = {};
    const money: Partial<Record<PriceRole, number | null>> = {};
    roles.forEach((role, c) => {
      if (isPriceRole(role)) money[role] ??= moneyIn(row[c]?.text ?? '');
      else if (role && role !== 'description' && role !== 'code') found[role] ??= countIn(row[c]?.text ?? '');
    });
    const counts = Object.values(found).filter((n) => n !== null && n !== undefined);
    const codeCell = roles.indexOf('code');
    const code = (codeCell >= 0 ? row[codeCell]?.text.trim() : '') || text.match(/\b(\d{5,14})\b/)?.[1] || null;
    const previous = lines.at(-1);

    if (desc.replace(/[^a-z0-9]/gi, '').length < 3 && counts.length === 0) return drop('too short');
    // Counts under an empty description are the table's own totals, even unlabelled.
    if (desc.replace(/[^a-z]/gi, '').length < 3 && lines.length > 0) return drop('totals or tax');
    // A row with words but no counts and no code is the description above wrapping.
    if (counts.length === 0 && !code && previous) {
      previous.text = `${previous.text} ${desc}`;
      const wrapped = packOf(normalise(previous.text));
      previous.pack ??= wrapped.pack;
      previous.size ??= wrapped.size;
      return verdicts.push({ index: i, text, kept: 'merged', into: lines.length - 1, what: 'description' });
    }

    const barcode = code && byBarcode.get(code.replace(/\D/g, ''));
    // Matched on the cleaned-up text, as the line parser does: "2Lt" is 2L, "S00ml" is 500ml.
    const match = barcode ? null : matchText(normalise(desc));
    const noise = noiseReason(normalise(desc));
    if (!barcode && noise && !(match && match.score >= MATCH_AT)) return drop(noise);

    const quantity = orderedAndSupplied(found, handFilled);
    const { pack, size } = packOf(normalise(desc));
    const qtyCells = roles.map((r, c) => (r && r !== 'code' && !isPriceRole(r) ? c : -1)).filter((c) => c >= 0);
    const unsure = qtyCells.some((c) => row[c]?.text && row[c].confidence < SURE_AT);
    const product = barcode
      ? { id: barcode.id, name: barcode.name, confidence: 1, via: 'barcode' as const }
      : match && match.score >= MATCH_AT
        ? { id: match.item.id, name: match.item.name, confidence: Math.min(1, match.score), via: 'name' as const }
        : { id: null, name: null, confidence: 0, via: 'new product?' as const };

    lines.push({
      source: i, text: desc || text, productId: product.id, productName: product.name,
      confidence: Number(product.confidence.toFixed(2)), via: product.via,
      pack, size, ordered: quantity.ordered, supplied: quantity.supplied, qtyHow: quantity.how,
      cartons: found.cartons ?? null, eaches: found.eaches ?? null, check: null, code, unsure,
      unitPrice: unitPriceOf(money, quantity.supplied ?? quantity.ordered, quantity.how === 'from cartons'),
    });
    verdicts.push({ index: i, text, kept: true, lineIndex: lines.length - 1 });
  });

  checkCartons(lines);
  return { lines, verdicts };
}

/**
 * The product's name as the docket prints it, for when the OCR is trusted over the catalogue:
 * the row's text without the unit column Textract folds in ("EA I"), a leading product code,
 * and the quantities and prices trailing after it.
 */
export function printedProductName(text: string): string {
  return text
    .replace(/[|]/g, ' ')
    .replace(/^\s*(?:ea|each|ctn|ctns|unit|units|uom)\b\s*(?:[il1|]\s+)?/i, '')
    .replace(/^\s*(?:\d{4,14}|[a-z]*\d[a-z0-9]{3,})\s+/i, '')
    .replace(/(?:\s+(?:\$?\d+(?:[.,]\d{2})?|x\s*\d{1,3}))+\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}
