'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { activeSite, requireSession } from '@/lib/auth/session';
import type { ActionState, WasteReason } from '@/lib/supabase/types';

export type ActionResult = { status: 'idle' } | { status: 'error'; message: string };

const WASTE_REASONS = ['expired', 'damaged', 'spoiled', 'recalled', 'staff_error', 'other'] as const;

export const WASTE_REASON_LABEL: Record<WasteReason, string> = {
  expired: 'Expired',
  damaged: 'Damaged',
  spoiled: 'Spoiled',
  recalled: 'Recalled',
  staff_error: 'Staff error',
  other: 'Other',
};

const WasteInput = z.object({
  batch_id: z.string().uuid(),
  qty: z.coerce.number().int().positive().max(9999),
  reason: z.enum(WASTE_REASONS),
  note: z.union([z.null(), z.string().max(280)]),
});

/**
 * Marks an expiry action done or dismissed.
 *
 * RLS scopes the update to sites this user can see, so a forged id changes nothing —
 * `.select()` then tells us whether a row actually moved, rather than reporting a
 * cheerful success for a write that silently matched nothing.
 */
export async function setActionState(
  actionId: string,
  state: Exclude<ActionState, 'open'>,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('expiry_actions')
    .update({ state, actioned_by: session.userId, actioned_at: new Date().toISOString() })
    .eq('id', actionId)
    .select('id');

  if (error) return { status: 'error', message: `Could not update that (${error.code ?? 'unknown'}).` };
  if (!data || data.length === 0) {
    return { status: 'error', message: 'That item is no longer on your list.' };
  }

  revalidatePath('/app/today');
  return { status: 'idle' };
}

export async function setRotationCheckState(
  checkId: string,
  state: Exclude<ActionState, 'open'>,
): Promise<ActionResult> {
  const session = await requireSession();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('rotation_checks')
    .update({ state, checked_by: session.userId, checked_at: new Date().toISOString() })
    .eq('id', checkId)
    .select('id');

  if (error) return { status: 'error', message: `Could not update that (${error.code ?? 'unknown'}).` };
  if (!data || data.length === 0) {
    return { status: 'error', message: 'That check is no longer on your list.' };
  }

  revalidatePath('/app/today');
  return { status: 'idle' };
}

/**
 * Records waste through the record_waste function rather than as two writes.
 *
 * Inserting the event and decrementing the batch have to happen together: a crash between
 * them would leave stock written off on paper but still counted on the shelf, or the
 * reverse. The function also takes a row lock, so two staff wasting the same batch at
 * once cannot both read the same qty_remaining and drive it negative.
 */
export async function recordWaste(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireSession();

  const parsed = WasteInput.safeParse({
    batch_id: String(formData.get('batch_id') ?? ''),
    qty: String(formData.get('qty') ?? ''),
    reason: formData.get('reason'),
    note: String(formData.get('note') ?? '').trim() || null,
  });

  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Check those details.' };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc('record_waste', {
    p_batch_id: parsed.data.batch_id,
    p_qty: parsed.data.qty,
    p_reason: parsed.data.reason,
    p_note: parsed.data.note ?? undefined,
  });

  if (error) {
    // The function raises check_violation when the quantity exceeds what is left, which
    // is a normal thing for a staff member to get wrong, not a system fault.
    if (error.code === '23514' || error.message.includes('cannot waste')) {
      return { status: 'error', message: 'That is more than the batch has left.' };
    }
    return { status: 'error', message: `Could not record the waste (${error.code ?? 'unknown'}).` };
  }

  revalidatePath('/app/today');
  revalidatePath('/app/waste');
  return { status: 'idle' };
}

/** Batches of a scanned product that still have stock, soonest expiry first. */
export async function batchesForBarcode(barcode: string, siteId?: string | null) {
  const session = await requireSession();
  const site = activeSite(session, siteId);
  if (!site) return { batches: [], product: null };

  const supabase = await createClient();
  const { data: product } = await supabase
    .from('products')
    .select('id, name, brand, size')
    .eq('barcode', barcode)
    .maybeSingle();

  if (!product) return { batches: [], product: null };

  const { data: batches } = await supabase
    .from('stock_batches')
    .select('id, expiry_date, qty_remaining')
    .eq('site_id', site.id)
    .eq('product_id', product.id)
    .eq('status', 'active')
    .gt('qty_remaining', 0)
    .order('expiry_date', { ascending: true, nullsFirst: false });

  return { batches: batches ?? [], product };
}
