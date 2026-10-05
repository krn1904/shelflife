'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import {
  checkCorrection,
  correctionError,
  isUnchanged,
  LineCorrection,
  productReviewFrom,
  removesLine,
} from './corrections';

export type CorrectionState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'saved'; message: string };

/**
 * A manager's correction to one line of a closed delivery. The line and its dated stock
 * change together in the database, which also refuses to un-receive stock already gone.
 */
export async function correctDeliveryLine(_prev: CorrectionState, formData: FormData): Promise<CorrectionState> {
  await requireRole('manager');

  let batches: unknown;
  try {
    batches = JSON.parse(String(formData.get('batches') ?? '[]'));
  } catch {
    return { status: 'error', message: 'Those dates did not make sense.' };
  }
  const parsed = LineCorrection.safeParse({
    line_id: formData.get('line_id'),
    qty_docketed: formData.get('qty_docketed'),
    qty_received: formData.get('qty_received'),
    batches,
  });
  if (!parsed.success) return { status: 'error', message: parsed.error.issues[0]?.message ?? 'That did not look right.' };
  const input = parsed.data;

  // RLS scopes this read to the manager's sites; the database function checks again.
  const supabase = await createClient();
  const { data: line } = await supabase
    .from('delivery_lines')
    .select('id, delivery_id, qty_docketed, qty_received, products(tracking_mode), stock_batches(id, expiry_date, qty_received)')
    .eq('id', input.line_id)
    .maybeSingle();
  if (!line) return { status: 'error', message: 'That line no longer exists.' };

  const check = checkCorrection(input, line.products?.tracking_mode ?? 'none');
  if (!check.ok) return { status: 'error', message: check.message };

  const current = {
    qtyDocketed: line.qty_docketed,
    qtyReceived: line.qty_received,
    batches: (line.stock_batches ?? []).map((b) => ({ id: b.id, expiryDate: b.expiry_date, qty: b.qty_received })),
  };
  if (isUnchanged(current, input)) return { status: 'saved', message: 'Nothing changed.' };

  const { error } = await supabase.rpc('correct_delivery_line', {
    p_line_id: input.line_id,
    p_qty_docketed: input.qty_docketed,
    p_qty_received: input.qty_received,
    p_batches: input.batches,
  });
  if (error) return { status: 'error', message: correctionError(error) };

  revalidatePath(`/manage/deliveries/${line.delivery_id}`);
  revalidatePath('/manage/deliveries');
  revalidatePath('/manage/expiry');
  return { status: 'saved', message: removesLine(input) ? 'Line removed.' : 'Saved.' };
}

/**
 * A manager's review of a product staff added from a docket: details, barcode, tracking
 * and the fixture it is checked on. Leaving dated tracking takes its stock off the board.
 */
export async function reviewDocketProduct(_prev: CorrectionState, formData: FormData): Promise<CorrectionState> {
  await requireRole('manager');
  const parsed = productReviewFrom(formData);
  if (!parsed.success) return { status: 'error', message: parsed.error.issues[0]?.message ?? 'That did not look right.' };
  const r = parsed.data;

  const supabase = await createClient();
  const { data: offBoard, error } = await supabase.rpc('review_docket_product', {
    p_product_id: r.product_id,
    p_site_id: r.site_id,
    p_name: r.name,
    p_brand: r.brand,
    p_size: r.size,
    p_barcode: r.barcode,
    p_tracking_mode: r.tracking_mode,
    p_shelf_life_days: r.default_shelf_life_days,
    p_fixture: r.fixture,
  });

  if (error?.code === '23505' && r.barcode) {
    const { data: owner } = await supabase.from('products').select('name').eq('barcode', r.barcode).maybeSingle();
    return {
      status: 'error',
      message: owner
        ? `That barcode is already "${owner.name}" in the catalogue. Leave the barcode empty for now; merging the two is not built yet.`
        : 'That barcode already belongs to another product.',
    };
  }
  if (error) return { status: 'error', message: correctionError(error) };

  revalidatePath(`/manage/products/${r.product_id}`);
  revalidatePath('/manage/products');
  revalidatePath('/manage/deliveries', 'layout');
  revalidatePath('/manage');
  const count = Number(offBoard ?? 0);
  return {
    status: 'saved',
    message: count > 0
      ? `Reviewed. ${count} dated ${count === 1 ? 'batch' : 'batches'} left the expiry board.`
      : 'Reviewed.',
  };
}
