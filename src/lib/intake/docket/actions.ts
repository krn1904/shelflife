'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { activeSite, requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';

const MAX_COLUMNS = 40;
const MAX_LINES = 300;

const Cell = z.string().max(500);
const ScanInput = z.object({
  supplierName: z.string().max(200).nullable(),
  docketNumber: z.string().max(200).nullable(),
  docketDate: z.string().max(100).nullable(),
  columns: z.array(z.string().max(200)).min(1).max(MAX_COLUMNS),
  expiryNotNeeded: z.boolean(),
  lines: z.array(z.object({
    cells: z.array(Cell).max(MAX_COLUMNS),
    expiryDate: z.union([z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  })).min(1).max(MAX_LINES),
});

export type ScanInput = z.infer<typeof ScanInput>;
export type SaveScanResult = { status: 'saved'; id: string; lines: number } | { status: 'error'; message: string };

/**
 * Saves a docket read from a photo, with the expiry dates the operator entered, against
 * the operator's own site. The database repeats the expiry rule, so a direct call cannot
 * skip it either.
 */
export async function saveDocketScan(input: ScanInput): Promise<SaveScanResult> {
  const session = await requireSession();
  const site = activeSite(session);
  if (!site) return { status: 'error', message: 'You are not assigned to a site.' };

  const parsed = ScanInput.safeParse(input);
  if (!parsed.success) return { status: 'error', message: 'Those lines did not make sense.' };
  const scan = parsed.data;
  if (!scan.expiryNotNeeded && scan.lines.some((l) => !l.expiryDate)) {
    return { status: 'error', message: 'Every line needs an expiry date, or tick "No expiry dates needed".' };
  }

  const supabase = await createClient();
  const { data: id, error } = await supabase.rpc('save_docket_scan', {
    p_site_id: site.id,
    p_supplier_name: scan.supplierName ?? '',
    p_docket_number: scan.docketNumber ?? '',
    p_docket_date: scan.docketDate ?? '',
    p_columns: scan.columns,
    p_expiry_not_needed: scan.expiryNotNeeded,
    // "No expiry dates needed" allows empty dates; any the operator did enter are kept.
    p_lines: scan.lines.map((l) => ({ cells: l.cells, expiry_date: l.expiryDate })),
  });
  if (error || !id) {
    return { status: 'error', message: `Could not save the docket (${error?.code ?? 'no id returned'}).` };
  }

  revalidatePath('/app/deliveries/docket-test');
  return { status: 'saved', id, lines: scan.lines.length };
}
