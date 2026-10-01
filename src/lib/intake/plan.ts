/**
 * The decisions behind receiving a delivery, kept free of the database and the browser so
 * they can be tested: which docket rows are linked to a catalogue product, what a closing
 * delivery records, and what the intake screen sends to be recorded.
 */

import { z } from 'zod';
import { printedProductName, type DocketLine } from './docket/parse';
import type { ExpiryProposal } from './expiry';
import type { TrackingMode } from '@/lib/supabase/types';

export const MAX_QTY = 9999;

// A name match this strong means the product is already in the catalogue; anything weaker is
// only offered as a suggestion, and the docket's own name is trusted instead.
export const LINKED_AT = 0.85;

export type IntakeProduct = {
  productId: string;
  name: string;
  brand: string | null;
  size: string | null;
  trackingMode: TrackingMode;
  proposal: ExpiryProposal;
};

/** One row of the docket, as intake shows it. */
export type DocketRow = {
  key: string;
  /** The row as the reader found it, and the product name as printed on it. */
  docketText: string;
  name: string;
  qtyDocketed: number;
  qtyReceived: number;
  /** The reader was unsure of this row's count, or could not find one. */
  unsure: boolean;
  /** The catalogue product this row is, when the docket leaves no doubt. */
  product: IntakeProduct | null;
  /** A catalogue product it might be, offered but never applied on its own. */
  suggestion: IntakeProduct | null;
};

/**
 * Every parsed docket line becomes a row. It is linked to a product only when its barcode
 * or name leaves no doubt; otherwise the OCR is trusted and the row keeps the docket's name.
 * Two rows are never folded into one product: the first sure match keeps it, later ones stay
 * their own rows with that product offered.
 */
export function docketRows(lines: DocketLine[], products: Map<string, IntakeProduct>): DocketRow[] {
  const linked = new Set<string>();
  return lines.map((line) => {
    const received = line.supplied ?? line.ordered;
    const candidate = line.productId ? products.get(line.productId) ?? null : null;
    const sure = candidate !== null && (line.via === 'barcode' || line.confidence >= LINKED_AT)
      && !linked.has(candidate.productId);
    if (sure) linked.add(candidate.productId);
    return {
      key: `row-${line.source}`,
      docketText: line.text,
      name: printedProductName(line.text) || line.text,
      qtyDocketed: Math.min(MAX_QTY, line.ordered ?? line.supplied ?? 0),
      qtyReceived: Math.min(MAX_QTY, received ?? 0),
      unsure: Boolean(line.unsure || received === null || line.check === 'disagrees'),
      product: sure ? candidate : null,
      suggestion: sure ? null : candidate,
    };
  });
}

/** "2000ml" → "2L", "1000g" → "1kg", "750ml" stays: sizes written the way the catalogue writes them. */
export function readableSize(size: string | null): string | null {
  const m = size?.match(/^(\d+(?:\.\d+)?)(ml|g)$/);
  if (!m) return size;
  const n = Number(m[1]);
  return n >= 1000 ? `${n / 1000}${m[2] === 'ml' ? 'L' : 'kg'}` : size;
}

type Counted = { qty_received: number; qty_docketed: number | null };

/**
 * The lines a closing delivery records. A docket line that did not arrive at all is kept
 * (0 received against its docketed quantity): that gap is the short-delivery record.
 * Anything else needs a count, and something must have arrived.
 */
export function recordable<T extends Counted>(lines: T[]): { ok: true; lines: T[] } | { ok: false; message: string } {
  const kept = lines.filter((l) => l.qty_received > 0 || (l.qty_docketed ?? 0) > 0);
  if (!kept.some((l) => l.qty_received > 0)) return { ok: false, message: 'Tick at least one line before closing.' };
  return { ok: true, lines: kept };
}

/**
 * The lines the intake screen posts to close a delivery. A Server Action is reachable by
 * direct POST, so every line is checked: each is either a catalogue product or a new item
 * named as the docket prints it (the OCR is trusted), never both and never neither.
 */
export const ClosingLines = z.array(z.object({
  product_id: z.union([z.null(), z.string().uuid()]).default(null),
  new_product: z.union([z.null(), z.object({
    name: z.string().trim().min(2).max(120),
    tracking_mode: z.enum(['batch', 'rotation', 'none']),
  })]).default(null),
  qty_received: z.coerce.number().int().min(0).max(MAX_QTY),
  // What the docket said arrived. Null when no docket was read: the count is then all there is.
  qty_docketed: z.union([z.null(), z.coerce.number().int().min(0).max(MAX_QTY)]).default(null),
  expiry_date: z.union([z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  confirmed: z.boolean(),
}).refine((l) => (l.product_id === null) !== (l.new_product === null))).max(500);

export type ClosingLine = Counted & {
  product_id: string;
  expiry_date: string | null;
  confirmed: boolean;
};

export type DeliveryPlan = {
  /** One per product: a delivery holds each product once. */
  lines: { productId: string; qtyDocketed: number; qtyReceived: number }[];
  /** One per received, dated row: two rows of one product can carry two different dates. */
  batches: { productId: string; qty: number; expiry: string; confirmed: boolean }[];
};

/**
 * Rows that turn out to be the same product add up into one delivery line. Without a docket
 * reading the docketed figure is the count itself. Only dated (batch) stock that arrived gets
 * a batch, and only once someone gave it a date.
 */
export function planDelivery(lines: ClosingLine[], tracking: Map<string, TrackingMode>): DeliveryPlan {
  const perProduct = new Map<string, { docketed: number; received: number }>();
  for (const l of lines) {
    const sum = perProduct.get(l.product_id) ?? { docketed: 0, received: 0 };
    perProduct.set(l.product_id, {
      docketed: sum.docketed + (l.qty_docketed ?? l.qty_received),
      received: sum.received + l.qty_received,
    });
  }
  return {
    lines: [...perProduct].map(([productId, qty]) => ({
      productId,
      qtyDocketed: Math.min(MAX_QTY, qty.docketed),
      qtyReceived: Math.min(MAX_QTY, qty.received),
    })),
    batches: lines.flatMap((l) =>
      l.qty_received > 0 && tracking.get(l.product_id) === 'batch' && l.expiry_date
        ? [{ productId: l.product_id, qty: l.qty_received, expiry: l.expiry_date, confirmed: l.confirmed }]
        : []),
  };
}

// ---------------------------------------------------------------------------------------
// The intake screen's side

/** A line as the intake screen holds it: a catalogue product, or a new item taken as printed. */
export type ScreenRow = {
  product: { productId: string; trackingMode: TrackingMode } | null;
  name: string;
  newTracking: TrackingMode;
  ticked: boolean;
  qty: number;
  expiry: string | null;
  confirmed: boolean;
  /** What the docket said arrived; null when no docket was read. */
  docketed: number | null;
  fromDocket: boolean;
};

export const trackingOf = (row: ScreenRow): TrackingMode => row.product?.trackingMode ?? row.newTracking;

/** What the screen shows before closing: what is recorded, and what needs attention. */
export function intakeSummary<T extends ScreenRow>(rows: T[]) {
  // An unticked docket line still goes in, as 0 received: that is the short-delivery record.
  const recorded = rows.filter((r) => (r.ticked && r.qty > 0) || (r.fromDocket && (r.docketed ?? 0) > 0));
  const received = recorded.filter((r) => r.ticked && r.qty > 0);
  return {
    recorded,
    received,
    undated: received.filter((r) => trackingOf(r) === 'batch' && !r.expiry),
    short: recorded.filter((r) => r.docketed !== null && (r.ticked ? r.qty : 0) < r.docketed),
    unnamed: recorded.filter((r) => !r.product && r.name.trim().length < 2),
    newItems: recorded.filter((r) => !r.product),
  };
}

/** The lines the screen sends to close the delivery, in the shape `closeDelivery` checks. */
export function intakePayload(rows: ScreenRow[], docketRead: boolean) {
  return intakeSummary(rows).recorded.map((r) => ({
    product_id: r.product?.productId ?? null,
    new_product: r.product ? null : { name: r.name.trim(), tracking_mode: r.newTracking },
    qty_received: r.ticked ? r.qty : 0,
    qty_docketed: docketRead ? r.docketed ?? 0 : null,
    expiry_date: trackingOf(r) === 'batch' && r.ticked ? r.expiry : null,
    confirmed: r.confirmed,
  }));
}
