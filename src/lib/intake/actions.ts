'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { activeSite, requireSession, type Session } from '@/lib/auth/session';
import { expectedLines, type HistoryLine } from './expected-lines';
import { proposeExpiry, today, type ExpiryProposal } from './expiry';

// How far back to look when guessing what a delivery will contain. Three is enough to
// tell a weekly line from a one-off without dragging in stock that was dropped months ago.
const HISTORY_DELIVERIES = 3;
const MAX_QTY = 9999;

export type IntakeState = { status: 'idle' } | { status: 'error'; message: string };

const LineInput = z.object({
  product_id: z.string().uuid(),
  qty_received: z.coerce.number().int().min(0).max(MAX_QTY),
  expiry_date: z.union([z.null(), z.string().regex(/^\d{4}-\d{2}-\d{2}$/)]),
  confirmed: z.boolean(),
});

/**
 * Resolves the delivery and proves the caller may touch it, in one place.
 *
 * Every action below needs the same three facts — the delivery exists, it belongs to a
 * site this user can see, and it is still open. RLS already blocks the cross-tenant case;
 * this turns that into a readable message instead of a silent zero-row write.
 */
async function openDeliveryFor(session: Session, deliveryId: string) {
  const supabase = await createClient();
  const { data: delivery } = await supabase
    .from('deliveries')
    .select('id, org_id, site_id, supplier_id, status, docket_number, docket_photo_path')
    .eq('id', deliveryId)
    .maybeSingle();

  if (!delivery) return { ok: false as const, message: 'That delivery no longer exists.' };
  if (!session.sites.some((s) => s.id === delivery.site_id)) {
    return { ok: false as const, message: 'That delivery belongs to another site.' };
  }
  if (delivery.status === 'closed') {
    return { ok: false as const, message: 'That delivery is already closed.' };
  }
  return { ok: true as const, delivery, supabase };
}

export async function startDelivery(_prev: IntakeState, formData: FormData): Promise<IntakeState> {
  const session = await requireSession();
  const supplierId = String(formData.get('supplier_id') ?? '');
  const site = activeSite(session, String(formData.get('site_id') ?? '') || null);

  if (!site) return { status: 'error', message: 'You are not assigned to a site.' };
  if (!z.string().uuid().safeParse(supplierId).success) {
    return { status: 'error', message: 'Pick a supplier first.' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('deliveries')
    .insert({
      org_id: site.orgId,
      site_id: site.id,
      supplier_id: supplierId,
      received_by: session.userId,
      received_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error) return { status: 'error', message: `Could not start the delivery (${error.code ?? 'unknown'}).` };

  revalidatePath('/app/deliveries');
  redirect(`/app/deliveries/${data.id}`);
}

/**
 * The pre-populated tick-list: what this supplier has sent to this site lately, each
 * line carrying a proposed expiry so the common action is a tap, not typing.
 */
export async function suggestLines(deliveryId: string) {
  const session = await requireSession();
  const resolved = await openDeliveryFor(session, deliveryId);
  if (!resolved.ok) return { error: resolved.message, lines: [] };
  const { delivery, supabase } = resolved;

  const { data: past } = await supabase
    .from('deliveries')
    .select('id, closed_at')
    .eq('supplier_id', delivery.supplier_id)
    .eq('site_id', delivery.site_id)
    .eq('status', 'closed')
    .order('closed_at', { ascending: false })
    .limit(HISTORY_DELIVERIES);

  const pastIds = (past ?? []).map((d) => d.id);
  if (pastIds.length === 0) return { error: null, lines: [] };

  const { data: history } = await supabase
    .from('delivery_lines')
    .select('delivery_id, product_id, qty_received')
    .in('delivery_id', pastIds);

  // Preserve newest-first ordering: expectedLines() takes the most recent quantity.
  const order = new Map(pastIds.map((id, i) => [id, i]));
  const ordered: HistoryLine[] = (history ?? [])
    .map((l) => ({ deliveryId: l.delivery_id, productId: l.product_id, qtyReceived: l.qty_received }))
    .sort((a, b) => (order.get(a.deliveryId) ?? 0) - (order.get(b.deliveryId) ?? 0));

  const suggestions = expectedLines(ordered);
  if (suggestions.length === 0) return { error: null, lines: [] };

  const productIds = suggestions.map((s) => s.productId);
  const [{ data: products }, { data: lastBatches }] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, brand, size, tracking_mode, default_shelf_life_days')
      .in('id', productIds),
    // The most recent batch per product tells us the shelf life this supplier actually
    // delivers, which beats the catalogue's generic figure.
    supabase
      .from('stock_batches')
      .select('product_id, expiry_date, created_at')
      .eq('site_id', delivery.site_id)
      .in('product_id', productIds)
      .not('expiry_date', 'is', null)
      .order('created_at', { ascending: false }),
  ]);

  const catalogue = new Map((products ?? []).map((p) => [p.id, p]));
  const lastSeen = new Map<string, { receivedOn: string; expiryDate: string }>();
  for (const batch of lastBatches ?? []) {
    if (lastSeen.has(batch.product_id) || !batch.expiry_date) continue;
    lastSeen.set(batch.product_id, {
      receivedOn: batch.created_at.slice(0, 10),
      expiryDate: batch.expiry_date,
    });
  }

  const receivedOn = today();
  const lines = suggestions.flatMap((s) => {
    const product = catalogue.get(s.productId);
    if (!product) return [];
    const proposal: ExpiryProposal =
      product.tracking_mode === 'batch'
        ? proposeExpiry({
            receivedOn,
            defaultShelfLifeDays: product.default_shelf_life_days,
            previous: lastSeen.get(s.productId) ?? null,
          })
        : { date: null, source: 'manual', basis: 'none' };

    return [{
      productId: s.productId,
      name: product.name,
      brand: product.brand,
      size: product.size,
      trackingMode: product.tracking_mode,
      qtyDocketed: s.qtyDocketed,
      seenInDeliveries: s.seenInDeliveries,
      proposal,
    }];
  });

  return { error: null, lines };
}

/**
 * Products to add a line for by hand — the first delivery from a supplier has no history
 * to pre-fill from, and even a familiar one turns up with something new.
 *
 * Ranged stock sorts first: what the site already carries is what a delivery almost
 * always contains, and the rest of the catalogue is there for the exception.
 */
export async function searchProductsForIntake(deliveryId: string, term: string) {
  const session = await requireSession();
  const resolved = await openDeliveryFor(session, deliveryId);
  if (!resolved.ok) return { error: resolved.message, products: [] };
  const { delivery, supabase } = resolved;

  const query = term.replace(/[,()\\*%]/g, ' ').trim();
  if (query.length < 2) return { error: null, products: [] };

  const { data: matches } = await supabase
    .from('products')
    .select('id, name, brand, size, tracking_mode, default_shelf_life_days')
    .or(`name.ilike.%${query}%,brand.ilike.%${query}%,barcode.ilike.%${query}%`)
    .order('name')
    .limit(25);

  const found = matches ?? [];
  if (found.length === 0) return { error: null, products: [] };

  const { data: ranged } = await supabase
    .from('site_products')
    .select('product_id')
    .eq('site_id', delivery.site_id)
    .eq('active', true)
    .in('product_id', found.map((p) => p.id));

  const rangedHere = new Set((ranged ?? []).map((r) => r.product_id));
  const receivedOn = today();

  const products = found
    .map((p) => ({
      productId: p.id,
      name: p.name,
      brand: p.brand,
      size: p.size,
      trackingMode: p.tracking_mode,
      ranged: rangedHere.has(p.id),
      proposal:
        p.tracking_mode === 'batch'
          ? proposeExpiry({
              receivedOn,
              defaultShelfLifeDays: p.default_shelf_life_days,
              previous: null,
            })
          : ({ date: null, source: 'manual', basis: 'none' } as ExpiryProposal),
    }))
    .sort((a, b) => Number(b.ranged) - Number(a.ranged) || a.name.localeCompare(b.name));

  return { error: null, products };
}

/**
 * Saves the ticked lines and closes the docket in one go.
 *
 * Lines and batches are replaced wholesale rather than diffed: a delivery has a handful
 * of lines, a full rewrite is milliseconds, and it is always correct. Batches are only
 * created for `batch`-tracked products — that is the whole point of the tracking modes,
 * and creating them for rotation stock would bury the real expiries in noise.
 */
export async function closeDelivery(_prev: IntakeState, formData: FormData): Promise<IntakeState> {
  const session = await requireSession();
  const deliveryId = String(formData.get('delivery_id') ?? '');
  const resolved = await openDeliveryFor(session, deliveryId);
  if (!resolved.ok) return { status: 'error', message: resolved.message };
  const { delivery, supabase } = resolved;

  // The lines ride in as JSON because the count is dynamic. A Server Action is reachable
  // by direct POST, so malformed text has to fail as a message, not an unhandled throw.
  let payload: unknown;
  try {
    payload = JSON.parse(String(formData.get('lines') ?? '[]'));
  } catch {
    return { status: 'error', message: 'Those lines did not make sense.' };
  }

  const parsed = z.array(LineInput).safeParse(payload);
  if (!parsed.success) return { status: 'error', message: 'Those lines did not make sense.' };

  const received = parsed.data.filter((l) => l.qty_received > 0);
  if (received.length === 0) {
    return { status: 'error', message: 'Tick at least one line before closing.' };
  }

  const { data: products } = await supabase
    .from('products')
    .select('id, tracking_mode')
    .in('id', received.map((l) => l.product_id));
  const trackingMode = new Map((products ?? []).map((p) => [p.id, p.tracking_mode]));

  const docketNumber = String(formData.get('docket_number') ?? '').trim() || null;

  await supabase.from('delivery_lines').delete().eq('delivery_id', delivery.id);
  const { data: lines, error: lineError } = await supabase
    .from('delivery_lines')
    .insert(received.map((l) => ({
      org_id: delivery.org_id,
      delivery_id: delivery.id,
      product_id: l.product_id,
      qty_docketed: l.qty_received,
      qty_received: l.qty_received,
    })))
    .select('id, product_id');

  if (lineError) return { status: 'error', message: `Could not save the lines (${lineError.code ?? 'unknown'}).` };

  const lineByProduct = new Map((lines ?? []).map((l) => [l.product_id, l.id]));
  const batches = received
    .filter((l) => trackingMode.get(l.product_id) === 'batch' && l.expiry_date)
    .map((l) => ({
      org_id: delivery.org_id,
      site_id: delivery.site_id,
      product_id: l.product_id,
      delivery_line_id: lineByProduct.get(l.product_id) ?? null,
      expiry_date: l.expiry_date,
      // A date someone ticked is evidence; one left as proposed is a guess we should
      // still be able to tell apart later when a write-off needs explaining.
      expiry_source: l.confirmed ? ('confirmed' as const) : ('predicted' as const),
      qty_received: l.qty_received,
      qty_remaining: l.qty_received,
    }));

  if (batches.length > 0) {
    const { error: batchError } = await supabase.from('stock_batches').insert(batches);
    if (batchError) {
      return { status: 'error', message: `Could not create the stock batches (${batchError.code ?? 'unknown'}).` };
    }
  }

  const { error: closeError } = await supabase
    .from('deliveries')
    .update({ status: 'closed', docket_number: docketNumber, closed_at: new Date().toISOString() })
    .eq('id', delivery.id);

  if (closeError) return { status: 'error', message: `Could not close the delivery (${closeError.code ?? 'unknown'}).` };

  revalidatePath('/app/deliveries');
  redirect(`/app/deliveries?closed=${delivery.id}`);
}

/** Records where the uploaded docket photo landed. The upload itself happens client-side. */
export async function attachDocketPhoto(deliveryId: string, path: string): Promise<IntakeState> {
  const session = await requireSession();
  const resolved = await openDeliveryFor(session, deliveryId);
  if (!resolved.ok) return { status: 'error', message: resolved.message };
  const { delivery, supabase } = resolved;

  // The client picks the path, so it must be pinned to this delivery's own folder.
  const expectedPrefix = `${delivery.org_id}/${delivery.site_id}/${delivery.id}/`;
  if (!path.startsWith(expectedPrefix)) {
    return { status: 'error', message: 'That file does not belong to this delivery.' };
  }

  const { error } = await supabase
    .from('deliveries')
    .update({ docket_photo_path: path })
    .eq('id', delivery.id);

  if (error) return { status: 'error', message: `Could not attach the photo (${error.code ?? 'unknown'}).` };

  revalidatePath(`/app/deliveries/${delivery.id}`);
  return { status: 'idle' };
}
