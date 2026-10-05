'use server';

import { revalidatePath } from 'next/cache';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { aliasToKeep, SupplierEdit, SupplierMerge, supplierError } from './upkeep';

export type SupplierState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'saved'; message: string };

const firstIssue = (issues: { message: string }[]) => issues[0]?.message ?? 'That did not look right.';

function refresh() {
  revalidatePath('/manage/suppliers');
  revalidatePath('/manage/deliveries');
  revalidatePath('/app/deliveries/new');
}

/** Rename, set the ABN, or switch a supplier on or off. The old name stays as a docket alias. */
export async function saveSupplier(_prev: SupplierState, formData: FormData): Promise<SupplierState> {
  await requireRole('manager');
  const abn = String(formData.get('abn') ?? '').trim();
  const parsed = SupplierEdit.safeParse({
    supplier_id: formData.get('supplier_id'),
    name: String(formData.get('name') ?? ''),
    abn: abn === '' ? null : abn,
    active: formData.get('active') === 'on',
  });
  if (!parsed.success) return { status: 'error', message: firstIssue(parsed.error.issues) };
  const edit = parsed.data;

  // RLS scopes this read to the caller's organisation; the database function checks again.
  const supabase = await createClient();
  const { data: current } = await supabase.from('suppliers').select('name').eq('id', edit.supplier_id).maybeSingle();
  if (!current) return { status: 'error', message: 'That supplier no longer exists.' };

  const { error } = await supabase.rpc('update_supplier', {
    p_supplier_id: edit.supplier_id,
    p_name: edit.name,
    p_abn: edit.abn,
    p_active: edit.active,
    p_old_alias: aliasToKeep(current.name, edit.name),
  });
  if (error) return { status: 'error', message: supplierError(error) };

  refresh();
  return { status: 'saved', message: 'Saved.' };
}

/** Folds a duplicate into the supplier being kept. Owners only; the database enforces it. */
export async function mergeSupplier(_prev: SupplierState, formData: FormData): Promise<SupplierState> {
  await requireRole('owner');
  const parsed = SupplierMerge.safeParse({ keep_id: formData.get('keep_id'), remove_id: formData.get('remove_id') });
  if (!parsed.success) return { status: 'error', message: firstIssue(parsed.error.issues) };
  const { keep_id: keepId, remove_id: removeId } = parsed.data;

  const supabase = await createClient();
  const { data: pair } = await supabase.from('suppliers').select('id, name').in('id', [keepId, removeId]);
  const keep = pair?.find((s) => s.id === keepId);
  const remove = pair?.find((s) => s.id === removeId);
  if (!keep || !remove) return { status: 'error', message: 'One of those suppliers no longer exists.' };

  const { data: moved, error } = await supabase.rpc('merge_suppliers', {
    p_keep_id: keepId,
    p_remove_id: removeId,
    p_alias: aliasToKeep(remove.name, keep.name),
  });
  if (error) return { status: 'error', message: supplierError(error) };

  refresh();
  const count = Number(moved ?? 0);
  return { status: 'saved', message: `Merged into ${keep.name}: ${count} ${count === 1 ? 'delivery' : 'deliveries'} moved.` };
}
