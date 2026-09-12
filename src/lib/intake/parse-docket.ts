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

/**
 * Scores how well a product name matches an OCR line.
 *
 * The question is: "does this product appear in this OCR text?"
 * So we check whether the product's significant words appear in the OCR line,
 * not the other way around.
 */
function matchScore(ocrLine: string, productName: string): number {
  const ocrNorm = normalize(ocrLine);
  const prodNorm = normalize(productName);
  if (!ocrNorm || !prodNorm) return 0;

  // Full product name found inside the OCR line
  if (ocrNorm.includes(prodNorm)) return 1;

  // Word-level: what fraction of the product's words appear in the OCR line?
  const prodWords = productName.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  if (prodWords.length === 0) return 0;

  let hits = 0;
  for (const word of prodWords) {
    if (ocrNorm.includes(normalize(word))) hits++;
  }

  // Require at least 2 words to match (or all of them if product has only 1-2 words)
  const ratio = hits / prodWords.length;
  if (hits < Math.min(2, prodWords.length)) return 0;
  return ratio;
}

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
  '\\d{2}[/\\-.]\\d{2}[/\\-.]\\d{2,4}|' +
  '\\d{4,}\\s*$|' +
  '^[A-Z\\s]{2,}\\d{4}$|' +
  '\\d+\\s+[A-Z]+\\s+(RD|ST|AVE|DR|HWY|LANE)\\b|' +
  'PTY\\s*(LTD|LIMITED)|' +
  'ABN\\s*:?\\s*\\d|' +
  '^\\d{5,}$' +
  ')',
  'i',
);

/**
 * Extracts quantity + product description from OCR text.
 *
 * Handles two formats:
 * 1. Structured: "955732 * 600Ml PET X 24 Coca-Cola  2  $3.29  $68.75  $137.50"
 * 2. Simple: "2 x Coca-Cola Zero 1.25L" or "Pepsi Max 375ml x4"
 */
function extractRawLines(text: string): { name: string; qty: number }[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const results: { name: string; qty: number }[] = [];

  for (const line of lines) {
    if (line.length < 3 || line.length > 120) continue;
    if (SKIP_LINE.test(line)) continue;
    if (SKIP_FULL.test(line)) continue;

    let qty = 1;
    let name = line;

    // Structured docket: "955732 * 600Ml PET X 24 Coca-Cola  2  $3.29 ..."
    // The SKU number prefix and trailing price columns are noise.
    const skuLine = line.match(/^\d{4,}\s*\*\s*(.+)/);
    if (skuLine) {
      name = skuLine[1];
      // Strip prices
      name = name.replace(/\$\s?\d+[,.]?\d*\.?\d*/g, '').trim();
      // For structured dockets, qty is typically a standalone number among the columns.
      // Extract the last standalone small number (1-999) as qty after stripping prices.
      const parts = name.split(/\s{2,}/);
      if (parts.length > 1) {
        const lastPart = parts[parts.length - 1].trim();
        if (/^\d{1,3}$/.test(lastPart)) {
          qty = parseInt(lastPart, 10);
          parts.pop();
          name = parts.join(' ');
        }
      }
      // Keep the full description including size info (e.g. "600Ml PET X 24 Coca-Cola")
      // — the product matcher will score against it.
    } else {
      // Strip prices
      name = name.replace(/\$\s?\d+[,.]?\d*\.?\d*/g, '').trim();

      // Simple formats
      const leadingQty = name.match(/^(\d{1,3})\s*[xX×]\s+(.+)/);
      if (leadingQty) {
        qty = parseInt(leadingQty[1], 10);
        name = leadingQty[2];
      } else {
        const leadingNum = name.match(/^(\d{1,3})\s{2,}(.+)/);
        if (leadingNum) {
          qty = parseInt(leadingNum[1], 10);
          name = leadingNum[2];
        } else {
          const trailingQty = name.match(/(.+?)\s+[xX×]\s*(\d{1,3})\s*$/);
          if (trailingQty) {
            name = trailingQty[1];
            qty = parseInt(trailingQty[2], 10);
          } else {
            const trailingNum = name.match(/(.+?)\s{2,}(\d{1,3})\s*$/);
            if (trailingNum) {
              name = trailingNum[1];
              qty = parseInt(trailingNum[2], 10);
            }
          }
        }
      }
    }

    name = name.replace(/\$?\d+\.\d{2}/g, '').trim();
    name = name.replace(/\s*#\w+$/, '').trim();
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
    const words = supplier.name.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
    if (words.length === 0) continue;
    let hits = 0;
    for (const word of words) {
      if (textLower.includes(word)) hits++;
    }
    const score = hits / words.length;
    if (score > bestSupplierScore && score >= 0.5) {
      bestSupplierScore = score;
      bestSupplier = supplier;
    }
  }

  const rawLines = extractRawLines(ocrText);

  // Match each extracted line against the product catalogue.
  // For each OCR line, find the product whose name best appears IN the OCR text.
  const matched: ParsedLine[] = [];
  const usedProducts = new Set<string>();

  for (const raw of rawLines) {
    let bestProduct: (typeof products extends (infer T)[] | null ? T : never) | null = null;
    let bestScore = 0;

    for (const product of products ?? []) {
      if (usedProducts.has(product.id)) continue;

      // Score: does this product's name/brand appear in the OCR line?
      const candidates = [
        product.name,
        product.brand ? `${product.brand} ${product.name}` : null,
      ].filter((c): c is string => !!c);

      for (const candidate of candidates) {
        const score = matchScore(raw.name, candidate);
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
