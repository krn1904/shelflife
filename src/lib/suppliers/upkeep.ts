/**
 * The rules behind tidying an organisation's suppliers: what a rename or merge must remember
 * so the next docket is still recognised, which suppliers look like the same business, and
 * how refusals read. Free of the database so it can be tested.
 */

import { z } from 'zod';
import { normaliseSupplierName } from '@/lib/intake/docket/supplier';

export const SupplierEdit = z.object({
  supplier_id: z.string().uuid(),
  name: z.string().trim().min(2, { message: 'Give the supplier a name.' }).max(120),
  // Spaces are how ABNs are printed ("51 824 753 556"); they are stored as 11 digits.
  abn: z.union([z.null(), z.string().transform((v) => v.replace(/\s+/g, '')).refine((v) => /^\d{11}$/.test(v), {
    message: 'An ABN is 11 digits.',
  })]),
  active: z.boolean(),
});

export type SupplierEditInput = z.infer<typeof SupplierEdit>;

export const SupplierMerge = z.object({
  keep_id: z.string().uuid({ message: 'Pick the supplier to keep.' }),
  remove_id: z.string().uuid(),
}).refine((m) => m.keep_id !== m.remove_id, { message: 'Pick a different supplier to merge into.' });

/**
 * The alias to keep when a supplier's name changes or it is merged away: its old name,
 * normalised the way intake stores docket names. Null when the old name would match the
 * same way anyway ("Lion Dairy & Drinks" to "Lion Dairy and Drinks").
 */
export function aliasToKeep(oldName: string, newName: string): string | null {
  const before = normaliseSupplierName(oldName);
  return before && before !== normaliseSupplierName(newName) ? before : null;
}

export type SupplierSummary = { id: string; name: string; abn: string | null; active: boolean };

/**
 * Suppliers that look like the same business as this one: the same ABN, or the same name
 * once punctuation and words like "Pty Ltd" are set aside. A hint for merging, never applied.
 */
export function lookAlikes(supplier: SupplierSummary, all: SupplierSummary[]): SupplierSummary[] {
  const key = normaliseSupplierName(supplier.name);
  return all.filter((other) => other.id !== supplier.id && (
    (supplier.abn !== null && other.abn === supplier.abn)
    || (key !== '' && normaliseSupplierName(other.name) === key)
  ));
}

/** Active first, then by name: the list a manager scans for duplicates. */
export function supplierOrder<T extends SupplierSummary>(suppliers: T[]): T[] {
  return [...suppliers].sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name));
}

/** The database refuses in plain words (see the migration); this turns them into sentences. */
export function supplierError(error: { code?: string; message?: string } | null): string {
  if (!error) return 'Could not save that.';
  if (error.code === '42501') {
    return error.message?.includes('owner') ? 'Only an owner can merge suppliers.' : 'You cannot change this supplier.';
  }
  if (['23505', '23514', 'P0002'].includes(error.code ?? '')) {
    const text = (error.message ?? '').trim();
    if (text) return `${text[0].toUpperCase()}${text.slice(1)}.`;
  }
  return `Could not save that (${error.code ?? 'unknown'}).`;
}
