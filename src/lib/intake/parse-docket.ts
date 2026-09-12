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
  if (b.includes(a)) return 1;
  if (a.includes(b)) return 0.9;

  let matches = 0;
  const words = needle.toLowerCase().split(/\s+/);
  for (const word of words) {
    if (b.includes(normalize(word))) matches++;
  }
  return words.length > 0 ? matches / words.length : 0;
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
function extractRawLines(text: string): { name: string; qty: number }[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const results: { name: string; qty: number }[] = [];

  for (const line of lines) {
    // Skip lines that are clearly headers/footers
    if (/^(date|time|invoice|docket|total|subtotal|gst|abn|phone|fax|address|page|delivery)/i.test(line)) continue;
    if (/^\d{2}[/\-.]\d{2}[/\-.]\d{2,4}$/.test(line)) continue;
    if (line.length < 3 || line.length > 120) continue;

    let qty = 1;
    let name = line;

    // Pattern: "3 x Product Name" or "3x Product Name"
    const leadingQty = line.match(/^(\d+)\s*[xX×]\s+(.+)/);
    if (leadingQty) {
      qty = parseInt(leadingQty[1], 10);
      name = leadingQty[2];
    } else {
      // Pattern: "3  Product Name" (number followed by spaces then text)
      const leadingNum = line.match(/^(\d+)\s{2,}(.+)/);
      if (leadingNum) {
        qty = parseInt(leadingNum[1], 10);
        name = leadingNum[2];
      } else {
        // Pattern: "Product Name x4" or "Product Name  4"
        const trailingQty = line.match(/(.+?)\s+[xX×]\s*(\d+)\s*$/);
        if (trailingQty) {
          name = trailingQty[1];
          qty = parseInt(trailingQty[2], 10);
        } else {
          const trailingNum = line.match(/(.+?)\s{2,}(\d+)\s*$/);
          if (trailingNum && parseInt(trailingNum[2], 10) <= 999) {
            name = trailingNum[1];
            qty = parseInt(trailingNum[2], 10);
          }
        }
      }
    }

    // Strip prices (e.g. "$5.99", "5.99")
    name = name.replace(/\$?\d+\.\d{2}/g, '').trim();
    // Strip trailing hash codes
    name = name.replace(/\s*#\w+$/, '').trim();

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

      // Score against product name, brand+name, and name+size
      const candidates = [
        product.name,
        `${product.brand ?? ''} ${product.name}`,
        product.brand ?? '',
      ];

      for (const candidate of candidates) {
        const score = fuzzyScore(raw.name, candidate);
        if (score > bestScore) {
          bestScore = score;
          bestProduct = product;
        }
      }
    }

    if (bestProduct && bestScore >= 0.4) {
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
