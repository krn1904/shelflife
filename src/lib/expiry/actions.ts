'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireSession } from '@/lib/auth/session';
import type { ActionState } from '@/lib/supabase/types';

export type ActionResult = { status: 'idle' } | { status: 'error'; message: string };

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
