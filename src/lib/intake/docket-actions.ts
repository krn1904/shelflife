'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { activeSite, requireSession } from '@/lib/auth/session';
import { cleanAbn, isValidAbn } from './docket/abn';
import type { TableCell } from './docket/parse';
import {
  identifySupplier,
  normaliseSupplierName,
  supplierClues,
  type SupplierClues,
  type SupplierIdentity,
} from './docket/supplier';
import { readDocketTables, TextractNotConfigured, textractConfigured } from './docket/textract';
import { customerFor, knownSuppliers } from './suppliers';

// Textract's synchronous call takes images up to 5 MB; the page uploads a resized JPEG.
const MAX_BYTES = 5 * 1024 * 1024;

const PhotoPath = z.string().regex(/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/docket\.jpg$/);

export type TextractResult =
  | { status: 'read'; text: string[]; tables: TableCell[][][] }
  | { status: 'error'; message: string };

/** Reads the uploaded docket photo with AWS Textract (one billed page). Nothing is kept at AWS. */
export async function readDocketWithTextract(path: string): Promise<TextractResult> {
  const session = await requireSession();
  if (!PhotoPath.safeParse(path).success) return { status: 'error', message: 'That photo path is not valid.' };
  const [orgId, siteId] = path.split('/');
  if (!session.sites.some((s) => s.id === siteId && s.orgId === orgId)) {
    return { status: 'error', message: 'That photo belongs to another site.' };
  }
  if (!textractConfigured()) {
    return { status: 'error', message: 'AWS Textract is not set up on this server. Use the free reader instead.' };
  }

  // Read back through the user's own session, so storage policies still decide access.
  const supabase = await createClient();
  const { data: photo, error } = await supabase.storage.from('dockets').download(path);
  if (error || !photo) return { status: 'error', message: 'Could not find the uploaded photo. Take it again.' };
  if (photo.size > MAX_BYTES) return { status: 'error', message: 'That photo is over 5 MB.' };

  try {
    const { text, tables } = await readDocketTables(new Uint8Array(await photo.arrayBuffer()));
    return { status: 'read', text, tables: tables.map((t) => t.rows) };
  } catch (e) {
    if (e instanceof TextractNotConfigured) return { status: 'error', message: e.message };
    // AWS names its failures (AccessDeniedException, …): what someone fixing the key needs.
    const name = e instanceof Error ? e.name : 'Error';
    return { status: 'error', message: `AWS Textract could not read it (${name}). Try the free reader.` };
  }
}

export type SupplierLookup = { identity: SupplierIdentity; clues: SupplierClues };

/** Who sent this docket, going by its text, among the suppliers of the caller's site's organisation. */
export async function identifyDocketSupplier(siteId: string, text: string[]): Promise<SupplierLookup> {
  const session = await requireSession();
  const lines = z.array(z.string().max(1000)).max(500).catch([]).parse(text);
  const site = activeSite(session, siteId);
  if (!site) return { identity: { kind: 'unknown' }, clues: supplierClues(lines) };

  const supabase = await createClient();
  const [known, customer] = await Promise.all([
    knownSuppliers(supabase, site.orgId),
    customerFor(supabase, session, site),
  ]);
  return { identity: identifySupplier(lines, known, customer), clues: supplierClues(lines, customer) };
}

export type AddSupplierResult =
  | { status: 'added' | 'existing'; supplier: { id: string; name: string } }
  | { status: 'error'; message: string };

const NewSupplier = z.object({
  name: z.string().trim().min(2, { message: 'Give the supplier a name.' }).max(120),
  abn: z.string().trim().max(20),
});

/**
 * Adds the supplier a docket came from. Staff may do this mid-delivery; the database
 * function returns the existing supplier instead when the ABN or the name is already known,
 * so a second "new" supplier for the same business is not created.
 */
export async function addSupplierFromDocket(siteId: string, name: string, abn: string): Promise<AddSupplierResult> {
  const session = await requireSession();
  const site = activeSite(session, siteId);
  if (!site) return { status: 'error', message: 'You are not assigned to a site.' };

  const parsed = NewSupplier.safeParse({ name, abn });
  if (!parsed.success) return { status: 'error', message: parsed.error.issues[0]?.message ?? 'That did not look right.' };
  const cleanedAbn = parsed.data.abn === '' ? null : cleanAbn(parsed.data.abn);
  if (parsed.data.abn !== '' && (!cleanedAbn || !isValidAbn(cleanedAbn))) {
    return { status: 'error', message: 'That ABN is not valid. Check the digits, or leave it blank.' };
  }

  const supabase = await createClient();
  // "Lion Dairy and Drinks Pty Ltd" is "Lion Dairy & Drinks": same supplier, not a new one.
  const wanted = normaliseSupplierName(parsed.data.name);
  const { data: existing } = await supabase.from('suppliers').select('id, name').eq('org_id', site.orgId);
  const same = (existing ?? []).find((s) => normaliseSupplierName(s.name) === wanted);

  const { data, error } = await supabase.rpc('add_supplier', {
    p_org_id: site.orgId,
    p_name: same ? same.name : parsed.data.name,
    p_abn: cleanedAbn,
  });
  const row = data?.[0];
  if (error || !row) return { status: 'error', message: `Could not add the supplier (${error?.code ?? 'unknown'}).` };

  const { data: supplier } = await supabase.from('suppliers').select('id, name').eq('id', row.supplier_id).single();
  return {
    status: row.existing ? 'existing' : 'added',
    supplier: supplier ?? { id: row.supplier_id, name: parsed.data.name },
  };
}
