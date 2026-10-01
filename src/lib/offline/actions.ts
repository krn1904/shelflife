'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/auth/session';

/**
 * The single server entry point the outbox replays through.
 *
 * One action rather than one per kind, because the queue has to be able to send anything
 * it holds without knowing which import to reach for. `permanent` is the important part
 * of the reply: it tells the queue whether to keep trying or to stop and say so.
 */
export type ReplayReply = { ok: true } | { ok: false; permanent: boolean; message: string };

const WastePayload = z.object({
  batch_id: z.string().uuid(),
  qty: z.coerce.number().int().positive().max(9999),
  reason: z.enum(['expired', 'damaged', 'spoiled', 'recalled', 'staff_error', 'other']),
  note: z.union([z.null(), z.string().max(280)]),
});

const StatePayload = z.object({
  id: z.string().uuid(),
  state: z.enum(['done', 'dismissed']),
});

const BatchStepPayload = z.object({
  batch_id: z.string().uuid(),
  step: z.enum(['checked', 'marked_down', 'sold', 'pulled']),
  qty: z.union([z.null(), z.coerce.number().int().min(0).max(9999)]),
});

// Postgres classes we know will be rejected identically on every retry.
// P0002 is "batch not found": gone, or another organisation's.
const PERMANENT_CODES = new Set(['23514', '23503', '22P02', '42501', 'PGRST116', 'P0002']);

function permanent(message: string): ReplayReply {
  return { ok: false, permanent: true, message };
}

export async function replayOutboxEntry(
  clientId: string,
  kind: string,
  payload: Record<string, unknown>,
): Promise<ReplayReply> {
  const session = await requireSession();
  const supabase = await createClient();

  if (!z.string().uuid().safeParse(clientId).success) {
    return permanent('That queued change had no valid id.');
  }

  if (kind === 'waste') {
    const parsed = WastePayload.safeParse(payload);
    if (!parsed.success) return permanent('That queued write-off was malformed.');

    // client_id makes this safe to send twice: the function returns the existing row
    // rather than decrementing the batch again.
    const { error } = await supabase.rpc('record_waste', {
      p_batch_id: parsed.data.batch_id,
      p_qty: parsed.data.qty,
      p_reason: parsed.data.reason,
      p_note: parsed.data.note ?? undefined,
      p_client_id: clientId,
    });

    if (error) {
      const isPermanent = PERMANENT_CODES.has(error.code ?? '') || error.message.includes('cannot waste');
      return { ok: false, permanent: isPermanent, message: error.message };
    }

    revalidatePath('/app/today');
    return { ok: true };
  }

  if (kind === 'batch-step') {
    const parsed = BatchStepPayload.safeParse(payload);
    if (!parsed.success) return permanent('That queued answer was malformed.');

    // client_id makes a replayed "pulled" write its waste once; the other steps are
    // naturally safe to repeat.
    const { error } = await supabase.rpc('resolve_batch_step', {
      p_batch_id: parsed.data.batch_id,
      p_step: parsed.data.step,
      p_qty: parsed.data.qty ?? undefined,
      p_client_id: clientId,
    });

    if (error) {
      const isPermanent = PERMANENT_CODES.has(error.code ?? '') || error.message.includes('cannot pull');
      return { ok: false, permanent: isPermanent, message: error.message };
    }

    revalidatePath('/app');
    revalidatePath('/app/today');
    return { ok: true };
  }

  if (kind === 'action-state' || kind === 'rotation-check') {
    const parsed = StatePayload.safeParse(payload);
    if (!parsed.success) return permanent('That queued tick was malformed.');

    const stamped = new Date().toISOString();

    // Written as two explicit calls rather than one with a computed table name: the two
    // tables have different columns, and supabase-js can only type a literal table.
    // Setting the same state twice is naturally idempotent, so neither needs a client_id.
    const { data, error } =
      kind === 'action-state'
        ? await supabase
            .from('expiry_actions')
            .update({ state: parsed.data.state, actioned_by: session.userId, actioned_at: stamped })
            .eq('id', parsed.data.id)
            .select('id')
        : await supabase
            .from('rotation_checks')
            .update({ state: parsed.data.state, checked_by: session.userId, checked_at: stamped })
            .eq('id', parsed.data.id)
            .select('id');

    if (error) {
      return { ok: false, permanent: PERMANENT_CODES.has(error.code ?? ''), message: error.message };
    }
    // Zero rows means it is gone or was never ours. Retrying will never change that.
    if (!data || data.length === 0) return permanent('That item no longer exists.');

    revalidatePath('/app/today');
    return { ok: true };
  }

  return permanent(`Unknown queued change: ${kind}`);
}
