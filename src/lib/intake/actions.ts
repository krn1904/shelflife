'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { activeSite, requireSession, type Session } from '@/lib/auth/session';
import { fetchAllPages } from '@/lib/pagination';
import { expectedLines, type HistoryLine } from './expected-lines';
import { proposeExpiry, today, type ExpiryProposal } from './expiry';
import { normalise, packOf, type CatalogueItem } from './docket/parse';
import { ClosingLines, docketRows, MAX_QTY, planDelivery, readableSize, recordable, type IntakeProduct } from './plan';
import { docketPhotoPath, parseReading, readingFrom, DocketReadingInput } from './docket/reading';
import { docketLessons } from './docket/supplier';
import { customerFor, knownSuppliers } from './suppliers';

// How far back to look when guessing what a delivery will contain. Three is enough to
// tell a weekly line from a one-off without dragging in stock that was dropped months ago.
const HISTORY_DELIVERIES = 3;
// How far back a supplier's own products count when matching its docket lines to the catalogue.
const MATCHING_DELIVERIES = 10;

export type IntakeState = { status: 'idle' } | { status: 'error'; message: string };

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

/**
 * Opens the delivery once the supplier is settled. When the docket was read first, the
 * delivery takes the id its photo was filed under, keeps the reading, and the supplier
 * remembers what its docket printed (name and ABN) so the next one is recognised outright.
 */
export async function startDelivery(_prev: IntakeState, formData: FormData): Promise<IntakeState> {
  const session = await requireSession();
  const supplierId = String(formData.get('supplier_id') ?? '');
  const site = activeSite(session, String(formData.get('site_id') ?? '') || null);

  if (!site) return { status: 'error', message: 'You are not assigned to a site.' };
  if (!z.string().uuid().safeParse(supplierId).success) {
    return { status: 'error', message: 'Pick a supplier first.' };
  }

  const requestedId = String(formData.get('delivery_id') ?? '');
  const deliveryId = z.string().uuid().safeParse(requestedId).success ? requestedId : crypto.randomUUID();
  // The browser names the photo; it only counts if it sits in this delivery's own folder.
  const photoPath = String(formData.get('docket_photo_path') ?? '');
  const docketPhoto = photoPath === docketPhotoPath(site.orgId, site.id, deliveryId) ? photoPath : null;

  let reading = null;
  const rawReading = String(formData.get('docket_reading') ?? '');
  if (rawReading) {
    try {
      const parsed = DocketReadingInput.safeParse(JSON.parse(rawReading));
      if (!parsed.success) return { status: 'error', message: 'The docket reading did not make sense. Read it again.' };
      reading = parsed.data;
    } catch {
      return { status: 'error', message: 'The docket reading did not make sense. Read it again.' };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase.from('deliveries').insert({
    id: deliveryId,
    org_id: site.orgId,
    site_id: site.id,
    supplier_id: supplierId,
    docket_photo_path: docketPhoto,
    docket_reading: reading,
    received_by: session.userId,
    received_at: new Date().toISOString(),
  });

  // A second tap on Start, after the first already went through: carry on with that one.
  if (error?.code === '23505') redirect(`/app/deliveries/${deliveryId}`);
  if (error) return { status: 'error', message: `Could not start the delivery (${error.code ?? 'unknown'}).` };

  if (reading) {
    const [known, customer] = await Promise.all([
      knownSuppliers(supabase, site.orgId),
      customerFor(supabase, session, site),
    ]);
    const lessons = docketLessons(reading.text, known, supplierId, customer);
    // Best effort: the delivery is open either way, and the next docket can teach it again.
    if (lessons.alias || lessons.abn) {
      await supabase.rpc('remember_supplier_docket', {
        p_supplier_id: supplierId,
        p_alias: lessons.alias,
        p_abn: lessons.abn,
      });
    }
  }

  revalidatePath('/app/deliveries');
  redirect(`/app/deliveries/${deliveryId}`);
}

type Db = Awaited<ReturnType<typeof createClient>>;

export type { DocketRow, IntakeProduct } from './plan';

/**
 * The products as intake shows them, each with a proposed expiry. The most recent batch
 * per product tells us the shelf life this site actually receives, which beats the
 * catalogue's generic figure.
 */
async function intakeProducts(supabase: Db, siteId: string, productIds: string[]): Promise<Map<string, IntakeProduct>> {
  if (productIds.length === 0) return new Map();
  const [{ data: products }, { data: lastBatches }] = await Promise.all([
    supabase
      .from('products')
      .select('id, name, brand, size, tracking_mode, default_shelf_life_days')
      .in('id', productIds),
    supabase
      .from('stock_batches')
      .select('product_id, expiry_date, created_at')
      .eq('site_id', siteId)
      .in('product_id', productIds)
      .not('expiry_date', 'is', null)
      .order('created_at', { ascending: false }),
  ]);

  const lastSeen = new Map<string, { receivedOn: string; expiryDate: string }>();
  for (const batch of lastBatches ?? []) {
    if (lastSeen.has(batch.product_id) || !batch.expiry_date) continue;
    lastSeen.set(batch.product_id, {
      receivedOn: batch.created_at.slice(0, 10),
      expiryDate: batch.expiry_date,
    });
  }

  const receivedOn = today();
  return new Map((products ?? []).map((product) => [product.id, {
    productId: product.id,
    name: product.name,
    brand: product.brand,
    size: product.size,
    trackingMode: product.tracking_mode,
    proposal: product.tracking_mode === 'batch'
      ? proposeExpiry({
          receivedOn,
          defaultShelfLifeDays: product.default_shelf_life_days,
          previous: lastSeen.get(product.id) ?? null,
        })
      : { date: null, source: 'manual', basis: 'none' },
  }]));
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

  const products = await intakeProducts(supabase, delivery.site_id, suggestions.map((s) => s.productId));
  const lines = suggestions.flatMap((s) => {
    const product = products.get(s.productId);
    if (!product) return [];
    return [{ ...product, qtyDocketed: s.qtyDocketed, seenInDeliveries: s.seenInDeliveries }];
  });

  return { error: null, lines };
}

export type DocketVerdict = { text: string; kept: 'kept' | 'joined' | 'dropped'; reason: string | null };

/**
 * The docket's rows, checked against the catalogue. A row is linked to a product only when
 * its barcode or name leaves no doubt; otherwise the OCR is trusted, the row keeps the name
 * the docket prints, and it becomes a new catalogue product when the delivery closes. Null
 * when this delivery has no reading.
 */
export async function docketLines(deliveryId: string) {
  const session = await requireSession();
  const resolved = await openDeliveryFor(session, deliveryId);
  if (!resolved.ok) return null;
  const { delivery, supabase } = resolved;

  const { data: row } = await supabase.from('deliveries').select('docket_reading').eq('id', delivery.id).single();
  const reading = readingFrom(row?.docket_reading);
  if (!reading) return null;

  // This supplier's own products at this site break near-ties between look-alikes.
  const { data: past } = await supabase
    .from('deliveries')
    .select('id')
    .eq('supplier_id', delivery.supplier_id)
    .eq('site_id', delivery.site_id)
    .eq('status', 'closed')
    .order('closed_at', { ascending: false })
    .limit(MATCHING_DELIVERIES);
  const pastIds = (past ?? []).map((d) => d.id);
  const [catalogue, { data: history }] = await Promise.all([
    fetchAllPages<CatalogueItem>((from, to) =>
      supabase.from('products').select('id, name, barcode').order('id').range(from, to)),
    pastIds.length > 0
      ? supabase.from('delivery_lines').select('product_id').in('delivery_id', pastIds)
      : Promise.resolve({ data: [] as { product_id: string }[] }),
  ]);

  const parsed = parseReading(reading, catalogue, {
    preferred: [...new Set((history ?? []).map((h) => h.product_id))],
  });

  const ids = [...new Set(parsed.lines.flatMap((l) => (l.productId ? [l.productId] : [])))];
  const products = await intakeProducts(supabase, delivery.site_id, ids);
  const rows = docketRows(parsed.lines, products);

  const verdicts: DocketVerdict[] = parsed.verdicts.map((v) => ({
    text: v.text,
    kept: v.kept === true ? 'kept' : v.kept === 'merged' ? 'joined' : 'dropped',
    reason: v.kept === false ? v.reason : v.kept === 'merged' ? `${v.what} of the row above` : null,
  }));

  return { engine: reading.engine, rows, verdicts };
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

  // Every word must appear somewhere in the name, brand or barcode, so "coca cola zero"
  // finds "Coca-Cola Zero Sugar" and the order people type words in does not matter.
  let search = supabase
    .from('products')
    .select('id, name, brand, size, tracking_mode, default_shelf_life_days');
  for (const word of query.split(/\s+/).slice(0, 5)) {
    search = search.or(`name.ilike.%${word}%,brand.ilike.%${word}%,barcode.ilike.%${word}%`);
  }
  const { data: matches } = await search.order('name').limit(25);

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

  const parsed = ClosingLines.safeParse(payload);
  if (!parsed.success) return { status: 'error', message: 'Those lines did not make sense.' };

  const record = recordable(parsed.data);
  if (!record.ok) return { status: 'error', message: record.message };
  const kept = record.lines;

  // Rows trusted from the docket become this organisation's own products, unless one by that
  // exact name is already visible to it (shared, or added from an earlier docket).
  const newProductIds = new Map<string, string>();
  for (const l of kept) {
    if (!l.new_product) continue;
    const key = l.new_product.name.toLowerCase();
    if (newProductIds.has(key)) continue;
    const { data: existing } = await supabase
      .from('products').select('id').ilike('name', l.new_product.name.replace(/[%_\\]/g, '\\$&')).limit(1).maybeSingle();
    if (existing) {
      newProductIds.set(key, existing.id);
      continue;
    }
    const { data: created, error: productError } = await supabase
      .from('products')
      .insert({
        name: l.new_product.name,
        size: readableSize(packOf(normalise(l.new_product.name)).size),
        tracking_mode: l.new_product.tracking_mode,
        // The docket's wording is this organisation's, not the shared catalogue's.
        org_id: delivery.org_id,
        created_by: session.userId,
      })
      .select('id')
      .single();
    if (productError || !created) {
      return { status: 'error', message: `Could not add ${l.new_product.name} to your products (${productError?.code ?? 'unknown'}).` };
    }
    newProductIds.set(key, created.id);
  }
  const received = kept.map((l) => ({
    ...l,
    product_id: l.product_id ?? newProductIds.get(l.new_product!.name.toLowerCase())!,
  }));

  const { data: products } = await supabase
    .from('products')
    .select('id, tracking_mode')
    .in('id', [...new Set(received.map((l) => l.product_id))]);
  const trackingMode = new Map((products ?? []).map((p) => [p.id, p.tracking_mode]));

  const docketNumber = String(formData.get('docket_number') ?? '').trim() || null;

  const plan = planDelivery(received, trackingMode);

  await supabase.from('delivery_lines').delete().eq('delivery_id', delivery.id);
  const { data: lines, error: lineError } = await supabase
    .from('delivery_lines')
    .insert(plan.lines.map((line) => ({
      org_id: delivery.org_id,
      delivery_id: delivery.id,
      product_id: line.productId,
      qty_docketed: line.qtyDocketed,
      qty_received: line.qtyReceived,
    })))
    .select('id, product_id');

  if (lineError) return { status: 'error', message: `Could not save the lines (${lineError.code ?? 'unknown'}).` };

  const lineByProduct = new Map((lines ?? []).map((l) => [l.product_id, l.id]));
  const batches = plan.batches.map((b) => ({
    org_id: delivery.org_id,
    site_id: delivery.site_id,
    product_id: b.productId,
    delivery_line_id: lineByProduct.get(b.productId) ?? null,
    expiry_date: b.expiry,
    // A date someone ticked is evidence; one left as proposed is a guess we should
    // still be able to tell apart later when a write-off needs explaining.
    expiry_source: b.confirmed ? ('confirmed' as const) : ('predicted' as const),
    qty_received: b.qty,
    qty_remaining: b.qty,
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
