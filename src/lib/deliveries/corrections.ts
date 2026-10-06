/**
 * What a manager may change on a delivery staff already closed, and on a product staff added
 * from a docket. Free of the database so it can be tested; the database functions
 * (correct_delivery_line, review_docket_product) enforce the same rules again, together with
 * the ones only they can see, such as stock already written off.
 */

import { z } from 'zod';
import { isValidGtin, normaliseBarcode } from '@/lib/barcode/gtin';
import type { TrackingMode } from '@/lib/supabase/types';

const MAX_QTY = 9999;
const MAX_DATES = 20; // one SKU on one docket carrying more dates than this is a typo
const MAX_SHELF_LIFE_DAYS = 3650;

/** A real calendar day as YYYY-MM-DD: "2026-02-30" passes a pattern but is not a day. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const day = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value;
}

const qty = z.coerce.number().int().min(0, { message: 'Quantities cannot be negative.' })
  .max(MAX_QTY, { message: `Quantities stop at ${MAX_QTY}.` });

export const LineCorrection = z.object({
  line_id: z.string().uuid(),
  qty_docketed: qty,
  qty_received: qty,
  batches: z.array(z.object({
    id: z.union([z.null(), z.string().uuid()]).default(null),
    expiry_date: z.string().refine(isCalendarDate, { message: 'Every expiry needs a real date.' }),
    qty: z.coerce.number().int().min(1, { message: 'Every date needs a quantity above 0.' }).max(MAX_QTY),
  })).max(MAX_DATES, { message: `A line can carry at most ${MAX_DATES} dates.` }),
});

export type LineCorrectionInput = z.infer<typeof LineCorrection>;

/** The line as it stands, for comparing a correction against. */
export type CurrentLine = {
  qtyDocketed: number;
  qtyReceived: number;
  batches: { id: string; expiryDate: string | null; qty: number }[];
};

export type Check = { ok: true } | { ok: false; message: string };

/**
 * The rules a correction must meet before it is sent. Only dated (batch) stock carries
 * dates, the dates cannot account for more than arrived, and one batch is listed once.
 */
export function checkCorrection(input: LineCorrectionInput, trackingMode: TrackingMode): Check {
  if (trackingMode !== 'batch' && input.batches.length > 0) {
    return { ok: false, message: 'This product is not tracked by expiry date, so it carries no dates.' };
  }
  const dated = input.batches.reduce((sum, b) => sum + b.qty, 0);
  if (dated > input.qty_received) {
    return { ok: false, message: `The dates add up to ${dated}, but only ${input.qty_received} arrived.` };
  }
  const ids = input.batches.flatMap((b) => (b.id ? [b.id] : []));
  if (new Set(ids).size !== ids.length) return { ok: false, message: 'The same stock is listed twice.' };
  return { ok: true };
}

/** Units that arrived with no date on them: they never reach the expiry board. */
export function undatedQty(received: number, batches: { qty: number }[]): number {
  return Math.max(0, received - batches.reduce((sum, b) => sum + b.qty, 0));
}

/** True when the correction would leave the line exactly as it is, so there is nothing to save. */
export function isUnchanged(current: CurrentLine, input: LineCorrectionInput): boolean {
  if (current.qtyDocketed !== input.qty_docketed || current.qtyReceived !== input.qty_received) return false;
  if (current.batches.length !== input.batches.length) return false;
  const wanted = new Map(input.batches.map((b) => [b.id, b]));
  return current.batches.every((b) => {
    const w = wanted.get(b.id);
    return w !== undefined && w.qty === b.qty && w.expiry_date === b.expiryDate;
  });
}

/** Removing a line is the same correction as saying none was on the docket and none arrived. */
export const removesLine = (input: Pick<LineCorrectionInput, 'qty_docketed' | 'qty_received'>) =>
  input.qty_docketed === 0 && input.qty_received === 0;

/**
 * The database explains a refused correction in plain words (see the migration); this makes
 * them read as a sentence, and replaces the codes a person cannot act on.
 */
export function correctionError(error: { code?: string; message?: string } | null): string {
  if (!error) return 'Could not save that.';
  if (error.code === '42501') return 'You cannot change this delivery.';
  if (error.code === '23514' || error.code === 'P0002') {
    const text = (error.message ?? '').trim();
    if (text) return `${text[0].toUpperCase()}${text.slice(1)}.`;
  }
  return `Could not save that (${error.code ?? 'unknown'}).`;
}

// ---------------------------------------------------------------------------------------
// Reviewing a product staff added from a docket

const optionalText = (max: number) => z.union([z.null(), z.string().trim().max(max)]);

export const ProductReview = z.object({
  product_id: z.string().uuid(),
  site_id: z.string().uuid(),
  name: z.string().trim().min(2, { message: 'Give the product a name.' }).max(120),
  brand: optionalText(80),
  size: optionalText(40),
  barcode: z.union([z.null(), z.string().refine(isValidGtin, {
    message: 'That barcode failed its check digit. Scan or type it again.',
  })]),
  tracking_mode: z.enum(['batch', 'rotation', 'none']),
  default_shelf_life_days: z.union([z.null(), z.coerce.number().int().positive().max(MAX_SHELF_LIFE_DAYS)]),
  fixture: optionalText(60),
}).refine((r) => r.tracking_mode !== 'rotation' || Boolean(r.fixture), {
  message: 'Rotation stock is checked by fixture. Say which fixture it sits on.',
  path: ['fixture'],
});

/** '' from an untouched input means "not set". Barcodes are stored without spaces or dashes. */
export function productReviewFrom(form: FormData) {
  const text = (key: string) => {
    const value = String(form.get(key) ?? '').trim();
    return value === '' ? null : value;
  };
  const barcode = text('barcode');
  return ProductReview.safeParse({
    product_id: form.get('product_id'),
    site_id: form.get('site_id'),
    name: String(form.get('name') ?? ''),
    brand: text('brand'),
    size: text('size'),
    barcode: barcode === null ? null : normaliseBarcode(barcode),
    tracking_mode: form.get('tracking_mode'),
    default_shelf_life_days: text('default_shelf_life_days'),
    fixture: text('fixture'),
  });
}
