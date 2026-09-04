'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth/session';
import { validateBarcode } from './barcode';
import type { Product, TrackingMode } from '@/lib/supabase/types';

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string };

const trackingModes = ['rotation', 'batch', 'none'] as const;

const createProductSchema = z.object({
  barcode: z.string().min(1),
  name: z.string().min(2, 'Give the product a name'),
  brand: z.string().optional(),
  size: z.string().optional(),
  category: z.string().optional(),
  defaultShelfLifeDays: z.coerce.number().int().positive().nullable().optional(),
  trackingMode: z.enum(trackingModes),
});

export type BarcodeLookup = {
  barcode: string;
  product: Product | null;
  rangedAtSite: boolean;
};

/** Resolves a scanned barcode against the global catalogue and this site's range. */
export async function lookupBarcode(siteId: string, raw: string): Promise<ActionResult<BarcodeLookup>> {
  await requireRole('staff');

  const check = validateBarcode(raw);
  if (!check.ok) return { ok: false, error: check.reason };

  const supabase = await createClient();
  const { data: product, error } = await supabase
    .from('products').select('*').eq('barcode', check.normalised).maybeSingle();
  if (error) return { ok: false, error: error.message };

  if (!product) return { ok: true, data: { barcode: check.normalised, product: null, rangedAtSite: false } };

  const { count } = await supabase
    .from('site_products').select('*', { count: 'exact', head: true })
    .eq('site_id', siteId).eq('product_id', product.id);

  return { ok: true, data: { barcode: check.normalised, product, rangedAtSite: (count ?? 0) > 0 } };
}

/** Adds an unknown barcode to the shared catalogue. Any signed-in user may do this. */
export async function createProduct(formData: FormData): Promise<ActionResult<Product>> {
  const session = await requireRole('staff');

  const parsed = createProductSchema.safeParse({
    barcode: formData.get('barcode'),
    name: formData.get('name'),
    brand: formData.get('brand') || undefined,
    size: formData.get('size') || undefined,
    category: formData.get('category') || undefined,
    defaultShelfLifeDays: formData.get('defaultShelfLifeDays') || null,
    trackingMode: formData.get('trackingMode'),
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const check = validateBarcode(parsed.data.barcode);
  if (!check.ok) return { ok: false, error: check.reason };

  const supabase = await createClient();
  const { data, error } = await supabase.from('products').insert({
    barcode: check.normalised,
    name: parsed.data.name,
    brand: parsed.data.brand ?? null,
    size: parsed.data.size ?? null,
    category: parsed.data.category ?? null,
    default_shelf_life_days: parsed.data.defaultShelfLifeDays ?? null,
    tracking_mode: parsed.data.trackingMode,
    created_by: session.userId,
  }).select().single();

  if (error) {
    return {
      ok: false,
      error: error.code === '23505'
        ? 'That barcode is already in the catalogue.'
        : error.message,
    };
  }

  revalidatePath('/manage/products');
  return { ok: true, data };
}

/** Ranges a catalogue product at a site. Idempotent so a double-tap is harmless. */
export async function rangeProduct(siteId: string, productId: string): Promise<ActionResult> {
  const session = await requireRole('manager');

  const site = session.sites.find((s) => s.id === siteId);
  if (!site) return { ok: false, error: 'That site is not in your scope.' };

  const supabase = await createClient();
  const { error } = await supabase.from('site_products').upsert(
    { org_id: site.orgId, site_id: siteId, product_id: productId, active: true },
    { onConflict: 'site_id,product_id' },
  );
  if (error) return { ok: false, error: error.message };

  revalidatePath('/manage/products');
  return { ok: true, data: undefined };
}

const updateSchema = z.object({
  parLevel: z.coerce.number().int().min(0).nullable(),
  fixture: z.string().nullable(),
  trackingModeOverride: z.enum(trackingModes).nullable(),
  active: z.boolean(),
});

export async function updateSiteProduct(
  siteProductId: string,
  patch: { parLevel: number | null; fixture: string | null; trackingModeOverride: TrackingMode | null; active: boolean },
): Promise<ActionResult> {
  await requireRole('manager');

  const parsed = updateSchema.safeParse(patch);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { error } = await supabase.from('site_products').update({
    par_level: parsed.data.parLevel,
    fixture: parsed.data.fixture,
    tracking_mode_override: parsed.data.trackingModeOverride,
    active: parsed.data.active,
  }).eq('id', siteProductId);

  if (error) return { ok: false, error: error.message };

  revalidatePath('/manage/products');
  return { ok: true, data: undefined };
}
