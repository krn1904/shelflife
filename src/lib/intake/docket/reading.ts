import { z } from 'zod';
import {
  isProductTable,
  parseDocket,
  parseDocketTable,
  type CatalogueItem,
  type DocketParse,
  type ParseOptions,
  type TableCell,
} from './parse';

/**
 * The receive screen photographs the docket before the delivery exists, into the folder the
 * delivery will have: org / site / the delivery's id, which the browser chooses.
 */
export function docketPhotoPath(orgId: string, siteId: string, deliveryId: string) {
  return `${orgId}/${siteId}/${deliveryId}/docket.jpg`;
}

/**
 * One docket, as an OCR engine read it. Both engines produce this shape, so the intake
 * flow does not care which one ran; which engine a plan gets is a later, separate choice.
 */
export type OcrEngine = 'textract' | 'tesseract';

export type DocketReading = {
  engine: OcrEngine;
  /** Every line of text, top to bottom: the supplier's letterhead, and the products when there is no table. */
  text: string[];
  /** The product table cell by cell, when the engine returns tables (Textract). */
  table: TableCell[][] | null;
};

/** A table the engine found, with enough to tell the product table from the others. */
export type FoundTable = { rows: TableCell[][]; products: boolean };

export function describeTables(tables: TableCell[][][]): FoundTable[] {
  return tables.map((rows) => ({ rows, products: isProductTable(rows) }));
}

/** The table most likely to be the products: product-shaped first, then the longest. */
export function likelyProductTable(tables: FoundTable[]): number {
  if (tables.length === 0) return -1;
  const ranked = tables
    .map((t, i) => ({ i, score: (t.products ? 1000 : 0) + t.rows.length }))
    .sort((a, b) => b.score - a.score);
  return ranked[0].i;
}

export function parseReading(reading: DocketReading, catalogue: CatalogueItem[], options: ParseOptions = {}): DocketParse {
  return reading.table
    ? parseDocketTable(reading.table, catalogue, options)
    : parseDocket(reading.text, catalogue, options);
}

// A reading arrives from the browser before it is stored on the delivery, so it is checked
// like any other input: bounded, and shaped as above.
const Cell = z.object({
  text: z.string().max(500),
  confidence: z.number().min(0).max(100),
  header: z.boolean().optional(),
});

export const DocketReadingInput = z.object({
  engine: z.enum(['textract', 'tesseract']),
  text: z.array(z.string().max(1000)).max(500),
  table: z.union([z.null(), z.array(z.array(Cell).max(30)).max(300)]),
});

/** A stored reading, or null when there is none or it no longer fits the shape. */
export function readingFrom(value: unknown): DocketReading | null {
  const parsed = DocketReadingInput.safeParse(value);
  return parsed.success ? parsed.data : null;
}
