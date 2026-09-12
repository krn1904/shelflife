'use server';

import { createClient } from '@/lib/supabase/server';
import { activeSite, requireSession } from '@/lib/auth/session';

export type ParsedLine = {
  productId: string;
  name: string;
  brand: string | null;
  size: string | null;
  qty: number;
  confidence: number;
};

export type DocketParseResult = {
  supplierId: string | null;
  supplierName: string | null;
  lines: ParsedLine[];
  rawText: string;
};

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function fuzzyScore(needle: string, haystack: string): number {
  const a = normalize(needle);
  const b = normalize(haystack);
  if (!a || !b) return 0;
  if (b.includes(a)) return 1;
  if (a.includes(b) && b.length >= 4) return 0.9;

  const words = needle.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  if (words.length === 0) return 0;

  let matches = 0;
  for (const word of words) {
    if (b.includes(normalize(word))) matches++;
  }
  return matches / words.length;
}

/**
 * Extracts quantity + product name pairs from raw OCR text.
 *
 * Delivery dockets typically have lines like:
 *   "2 x Coca-Cola Zero 1.25L"
 *   "3  Sprite 600ml"
 *   "Pepsi Max 375ml  x4"
 *   "1 Coffee"
 */
const SKIP_LINE = new RegExp(
  '^(' +
  'date|time|invoice|docket|total|subtotal|gst|abn|phone|fax|address|page|delivery|' +
  'bill\\s*to|deliver\\s*to|customer|contact|contractor|shipment|payment|' +
  'material|number|description|price|extended|net|charge|taxable|' +
  'cash|cheque|card|tc\\s|epod|bpay|pallets|terms|missing|' +
  'product\\s*total|total\\s*quantity|total\\s*returned|total\\s*price|total\\s*gst|' +
  'tax\\s*invoice|po\\s*number|equip|web|www\\.|vic$|nsw$|qld$|sa$|wa$|tas$|act$|nt$' +
  ')',
  'i',
);

const SKIP_FULL = new RegExp(
  '(' +
  '\\d{2}[/\\-.]\\d{2}[/\\-.]\\d{2,4}|' +        // dates
  '\\d{4,}\\s*$|' +                                // bare numbers (postcodes, refs)
  '^[A-Z\\s]{2,}\\d{4}$|' +                        // "TRUGANINA 3029" — suburb + postcode
  '\\d+\\s+[A-Z]+\\s+RD|ST|AVE|DR|HWY|LANE|' +    // street addresses
  'PTY\\s*(LTD|LIMITED)|' +                         // company suffixes
  'PETROLEUM|METRO|TRUGANINA|' +                    // known non-product entities (common on fuel dockets)
  'ABN\\s*:?\\s*\\d|' +
  '^\\d{5,}$' +                                     // bare long numbers
  ')',
  'i',
);

function extractRawLines(text: string): { name: string; qty: number }[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const results: { name: string; qty: number }[] = [];

  for (const line of lines) {
    if (line.length < 3 || line.length > 120) continue;
    if (SKIP_LINE.test(line)) continue;
    if (SKIP_FULL.test(line)) continue;

    let qty = 1;
    let name = line;

    // Structured docket line: "955732 * 600Ml PET X 24 Coca-Cola... 2 $3.29 ..."
    const skuLine = line.match(/^\d{4,}\s*\*\s*(.+)/);
    if (skuLine) {
      name = skuLine[1];
    }

    // Strip prices first so they don't interfere with qty extraction
    name = name.replace(/\$\s?\d+[,.]?\d*\.?\d*/g, '').trim();

    // Pattern: "3 x Product Name" or "3x Product Name"
    const leadingQty = name.match(/^(\d+)\s*[xX×]\s+(.+)/);
    if (leadingQty) {
      qty = parseInt(leadingQty[1], 10);
      name = leadingQty[2];
    } else {
      // Pattern: "3  Product Name" (number followed by spaces then text)
      const leadingNum = name.match(/^(\d+)\s{2,}(.+)/);
      if (leadingNum) {
        qty = parseInt(leadingNum[1], 10);
        name = leadingNum[2];
      } else {
        // Pattern: "Product Name x4" or "Product Name  4"
        const trailingQty = name.match(/(.+?)\s+[xX×]\s*(\d+)\s*$/);
        if (trailingQty) {
          name = trailingQty[1];
          qty = parseInt(trailingQty[2], 10);
        } else {
          const trailingNum = name.match(/(.+?)\s{2,}(\d+)\s*$/);
          if (trailingNum && parseInt(trailingNum[2], 10) <= 999) {
            name = trailingNum[1];
            qty = parseInt(trailingNum[2], 10);
          }
        }
      }
    }

    // Strip remaining prices and trailing hash codes
    name = name.replace(/\$?\d+\.\d{2}/g, '').trim();
    name = name.replace(/\s*#\w+$/, '').trim();
    // Strip CDS/P/C column values (single short tokens at the end)
    name = name.replace(/\s+[A-Z]{1,3}\/[A-Z]{1,3}\s*$/, '').trim();

    if (name.length >= 3 && qty > 0 && qty <= 9999) {
      results.push({ name, qty });
    }
  }

  return results;
}

export async function parseDocketText(ocrText: string): Promise<DocketParseResult> {
  const session = await requireSession();
  const site = activeSite(session);
  const supabase = await createClient();

  if (!site) {
    return { supplierId: null, supplierName: null, lines: [], rawText: ocrText };
  }

  const [{ data: suppliers }, { data: products }] = await Promise.all([
    supabase.from('suppliers').select('id, name').eq('active', true),
    supabase
      .from('products')
      .select('id, name, brand, size, tracking_mode')
      .order('name')
      .limit(2000),
  ]);

  // Match supplier: find which supplier name appears in the OCR text
  let bestSupplier: { id: string; name: string } | null = null;
  let bestSupplierScore = 0;
  const textLower = ocrText.toLowerCase();

  for (const supplier of suppliers ?? []) {
    const score = fuzzyScore(supplier.name, textLower);
    if (score > bestSupplierScore && score >= 0.5) {
      bestSupplierScore = score;
      bestSupplier = supplier;
    }
  }

  // Extract raw lines from OCR text
  const rawLines = extractRawLines(ocrText);

  // Match each extracted line against the product catalogue
  const matched: ParsedLine[] = [];
  const usedProducts = new Set<string>();

  for (const raw of rawLines) {
    let bestProduct: (typeof products extends (infer T)[] | null ? T : never) | null = null;
    let bestScore = 0;

    for (const product of products ?? []) {
      if (usedProducts.has(product.id)) continue;

      const candidates = [
        product.name,
        `${product.brand ?? ''} ${product.name}`.trim(),
        `${product.name} ${product.size ?? ''}`.trim(),
      ];

      for (const candidate of candidates) {
        const score = fuzzyScore(raw.name, candidate);
        if (score > bestScore) {
          bestScore = score;
          bestProduct = product;
        }
      }
    }

    if (bestProduct && bestScore >= 0.6) {
      usedProducts.add(bestProduct.id);
      matched.push({
        productId: bestProduct.id,
        name: bestProduct.name,
        brand: bestProduct.brand,
        size: bestProduct.size,
        qty: raw.qty,
        confidence: Math.round(bestScore * 100),
      });
    }
  }

  return {
    supplierId: bestSupplier?.id ?? null,
    supplierName: bestSupplier?.name ?? null,
    lines: matched,
    rawText: ocrText,
  };
}
