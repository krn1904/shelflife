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

const SIZE_WORD = /^\d+(\.\d+)?(ml|l|g|kg|oz|pk|pack)$/i;

function matchScore(ocrLine: string, productName: string): number {
  const ocrNorm = normalize(ocrLine);
  const prodNorm = normalize(productName);
  if (!ocrNorm || !prodNorm) return 0;

  if (ocrNorm.includes(prodNorm)) return 1;

  const prodWords = [...new Set(
    productName.toLowerCase().split(/\s+/)
      .filter((w) => w.length >= 3 && !SIZE_WORD.test(w))
      .map(normalize)
  )];
  if (prodWords.length === 0) return 0;

  let hits = 0;
  for (const word of prodWords) {
    if (ocrNorm.includes(word)) hits++;
  }

  const ratio = hits / prodWords.length;
  if (hits < Math.min(2, prodWords.length)) return 0;

  if (prodWords.length > 2 && !ocrNorm.includes(prodWords[0])) {
    return ratio * 0.5;
  }

  return ratio;
}

const SKIP_LINE = new RegExp(
  '^(' +
  'date|time|invoice|docket|total|subtotal|gst|abn|phone|fax|address|page|delivery|' +
  'bill\\s*to|deliver\\s*to|customer|contact|contractor|shipment|payment|' +
  'material|number|description|price|extended|net|charge|taxable|' +
  'cash|cheque|card|tc\\s|epod|bpay|pallets|terms|missing|' +
  'product\\s*total|total\\s*quantity|total\\s*returned|total\\s*price|total\\s*gst|' +
  'tax\\s*invoice|po\\s*number|equip|web|www\\.|vic$|nsw$|qld$|sa$|wa$|tas$|act$|nt$|' +
  'sold\\s*to|route|product\\s*code|product\\s*description|' +
  'units|order\\s*qty|delvr|uom|unit\\s*price|qty\\s*ordered|qty\\s*supplied|' +
  'crates|cartons|eaches|ordered|picked|delivered|^code\\s' +
  ')',
  'i',
);

const SKIP_FULL = new RegExp(
  '(' +
  '\\d{2}[/\\-.]\\d{2}[/\\-.]\\d{2,4}|' +
  '\\d{4,}\\s*$|' +
  '^[A-Z\\s]{2,}\\d{4}$|' +
  '\\d+\\s+[A-Z]+\\s+(RD|ST|AVE|DR|HWY|LANE|ROAD|STREET|AVENUE|DRIVE)\\b|' +
  'PTY\\s*(LTD|LIMITED)|' +
  'ABN\\s*:?\\s*\\d|' +
  '^\\d{5,}$|' +
  'TOTAL\\s+WEIGHT|' +
  'TOTAL\\s+QUANTITY|' +
  'CUSTOMER\\s*#|' +
  'DELIVERY\\s*#' +
  ')',
  'i',
);

function extractRawLines(text: string): { name: string; qty: number }[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const results: { name: string; qty: number }[] = [];

  for (const line of lines) {
    if (line.length < 3 || line.length > 200) continue;
    if (SKIP_LINE.test(line)) continue;
    if (SKIP_FULL.test(line)) continue;

    let qty = 1;
    let name = line;
    let handled = false;

    // Format: Bega/Lion Dairy — pipe-separated code and description
    const begaMatch = line.match(/\|EA\s+EA\s*\|\s*(.+?)\s+(\d+)\s+(\d+)\s*$/);
    if (begaMatch) {
      name = begaMatch[1];
      qty = parseInt(begaMatch[3], 10) || parseInt(begaMatch[2], 10);
      handled = true;
    }

    // Format: CCA structured — SKU * description
    if (!handled) {
      const skuLine = line.match(/^\d{4,}\s*\*\s*(.+)/);
      if (skuLine) {
        name = skuLine[1];
        name = name.replace(/\$\s?\d+[,.]?\d*\.?\d*/g, '').trim();
        const parts = name.split(/\s{2,}/);
        if (parts.length > 1) {
          const lastPart = parts[parts.length - 1].trim();
          if (/^\d{1,3}$/.test(lastPart)) {
            qty = parseInt(lastPart, 10);
            parts.pop();
            name = parts.join(' ');
          }
        }
        handled = true;
      }
    }

    // Format: Suntory — code + desc + units + orderQty + delvrQty + UoM + price
    if (!handled) {
      const suntoryMatch = line.match(/^\d{4}\s+(.+?)\s+\d+\s+\d+\s+(\d+)\s+CTN\s+[\d.]+\s*$/);
      if (suntoryMatch) {
        name = suntoryMatch[1];
        qty = parseInt(suntoryMatch[2], 10);
        name = name.replace(/\s+\d*x?\d+pk\s+\w+\s+AU$/i, '').trim();
        name = name.replace(/\s+x\d+\s+\w+\s+AU$/i, '').trim();
        name = name.replace(/\s+\d+x\d+pk\s+\w+\s+AU$/i, '').trim();
        handled = true;
      }
    }

    // Format: PFD — code + sizeSpec + description + EA + qtyOrdered + qtySupplied + price
    if (!handled) {
      const pfdMatch = line.match(/^\d{5,6}\s+(.+?)\s+EA\s+([\d.]+)\s+([\d.]+|NOT\s+AVAIL)\s+[\d.]+\s*$/);
      if (pfdMatch) {
        name = pfdMatch[1];
        const supplied = pfdMatch[3];
        qty = /NOT\s+AVAIL/i.test(supplied) ? 0 : Math.round(parseFloat(supplied));
        const words = name.split(/\s+/);
        while (words.length > 1 && /^\d/.test(words[0])) {
          words.shift();
        }
        name = words.join(' ');
        handled = true;
      }
    }

    // Format: CCA non-asterisk — 6-digit code + description + qty + prices
    if (!handled) {
      const ccaMatch = line.match(/^(\d{6})\s+(.+)/);
      if (ccaMatch) {
        name = ccaMatch[2];
        name = name.replace(/\$\s?\d+[,.]?\d*\.?\d*/g, '').trim();
        const parts = name.split(/\s{2,}/);
        if (parts.length > 1) {
          while (parts.length > 1) {
            const last = parts[parts.length - 1].trim();
            if (/^\d{1,4}$/.test(last)) {
              qty = parseInt(last, 10);
              parts.pop();
            } else break;
          }
          name = parts.join(' ');
        }
        handled = true;
      }
    }

    // Simple/generic formats
    if (!handled) {
      name = name.replace(/\$\s?\d+[,.]?\d*\.?\d*/g, '').trim();

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

    name = name.replace(/\$\d+\.\d{2}/g, '').trim();
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

  // Filter out lines that are the supplier name
  const filteredLines = rawLines.filter((raw) => {
    if (!bestSupplier) return true;
    const rawNorm = normalize(raw.name);
    const supplierNorm = normalize(bestSupplier.name);
    if (rawNorm.includes(supplierNorm)) return false;
    const supplierWords = bestSupplier.name.toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
    if (supplierWords.length === 0) return true;
    let hits = 0;
    for (const word of supplierWords) {
      if (rawNorm.includes(normalize(word))) hits++;
    }
    return hits / supplierWords.length < 0.7;
  });

  const matched: ParsedLine[] = [];
  const usedProducts = new Set<string>();

  for (const raw of filteredLines) {
    let bestProduct: (typeof products extends (infer T)[] | null ? T : never) | null = null;
    let bestScore = 0;

    for (const product of products ?? []) {
      if (usedProducts.has(product.id)) continue;

      let score = matchScore(raw.name, product.name);

      // Try brand+name only if the brand actually appears in the OCR line
      if (product.brand) {
        const brandNorm = normalize(product.brand);
        const rawNorm = normalize(raw.name);
        if (brandNorm.length >= 3 && rawNorm.includes(brandNorm)) {
          const brandScore = matchScore(raw.name, `${product.brand} ${product.name}`);
          score = Math.max(score, brandScore);
        }
      }

      if (score > bestScore) {
        bestScore = score;
        bestProduct = product;
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
