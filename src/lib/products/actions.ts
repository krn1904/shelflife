'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { activeSite, requireRole, requireSession } from '@/lib/auth/session';
import { isValidGtin, normaliseBarcode } from '@/lib/barcode/gtin';
import type { Product, SiteProduct } from '@/lib/supabase/types';

const MAX_SHELF_LIFE_DAYS = 3650; // ten years — anything longer is a typo, not a product

/** '' from an untouched form input means "not set", not "set to empty". */
function blank(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? '').trim();
  return text === '' ? null : text;
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'That did not look right.';
}

const trackingMode = z.enum(['rotation', 'batch', 'none']);

const optionalPositiveInt = (max: number) =>
  z.union([z.null(), z.coerce.number().int().positive().max(max)]);

const CatalogueProduct = z.object({
  barcode: z.string().refine(isValidGtin, {
    message: 'That barcode failed its check digit — re-scan it or re-type it.',
  }),
  name: z.string().trim().min(2, { message: 'Give the product a name.' }).max(120),
  brand: z.union([z.null(), z.string().max(80)]),
  size: z.union([z.null(), z.string().max(40)]),
  category: z.union([z.null(), z.string().max(60)]),
  tracking_mode: trackingMode,
  default_shelf_life_days: optionalPositiveInt(MAX_SHELF_LIFE_DAYS),
});

const SiteOverrides = z.object({
  product_id: z.string().uuid(),
  site_id: z.string().uuid(),
  retail_price: z.union([z.null(), z.coerce.number().nonnegative().max(99999)]),
  unit_cost: z.union([z.null(), z.coerce.number().nonnegative().max(99999)]),
  par_level: optionalPositiveInt(9999),
  fixture: z.union([z.null(), z.string().max(60)]),
  tracking_mode_override: z.union([z.null(), trackingMode]),
  active: z.boolean(),
});

export type ProductFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'saved'; productId: string };

export type SiteProductFormState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'saved' };

export type CatalogueMatch = Pick<
  Product,
  'id' | 'barcode' | 'name' | 'brand' | 'size' | 'category' | 'tracking_mode' | 'default_shelf_life_days'
>;

export type BarcodeLookup =
  | { status: 'invalid'; barcode: string }
  | { status: 'unknown'; barcode: string }
  | {
      status: 'found';
      barcode: string;
      product: CatalogueMatch;
      ranged: Pick<SiteProduct, 'id' | 'fixture' | 'par_level' | 'tracking_mode_override' | 'active'> | null;
      siteName: string | null;
    };

const CATALOGUE_COLUMNS =
  'id, barcode, name, brand, size, category, tracking_mode, default_shelf_life_days';

/**
 * Resolves a scanned code to a catalogue product, and to whether this user's site
 * already ranges it. Both answers are needed at once: an unranged product is a
 * different screen from an unknown one, and the scanner cannot tell them apart.
 */
export async function lookupBarcode(raw: string, siteId?: string | null): Promise<BarcodeLookup> {
  const session = await requireSession();
  const barcode = normaliseBarcode(raw);

  if (!isValidGtin(barcode)) return { status: 'invalid', barcode };

  const supabase = await createClient();
  const { data: product } = await supabase
    .from('products')
    .select(CATALOGUE_COLUMNS)
    .eq('barcode', barcode)
    .maybeSingle();

  if (!product) return { status: 'unknown', barcode };

  const site = activeSite(session, siteId);
  if (!site) return { status: 'found', barcode, product, ranged: null, siteName: null };

  const { data: ranged } = await supabase
    .from('site_products')
    .select('id, fixture, par_level, tracking_mode_override, active')
    .eq('site_id', site.id)
    .eq('product_id', product.id)
    .maybeSingle();

  return { status: 'found', barcode, product, ranged: ranged ?? null, siteName: site.name };
}

/**
 * Writes a new product to the GLOBAL catalogue, so every tenant benefits from one
 * person scanning an unknown barcode. Any signed-in user may do this by design —
 * commercially sensitive fields live on site_products, never here.
 */
export async function addCatalogueProduct(
  _prev: ProductFormState,
  formData: FormData,
): Promise<ProductFormState> {
  const session = await requireSession();

  const parsed = CatalogueProduct.safeParse({
    barcode: normaliseBarcode(String(formData.get('barcode') ?? '')),
    name: String(formData.get('name') ?? ''),
    brand: blank(formData.get('brand')),
    size: blank(formData.get('size')),
    category: blank(formData.get('category')),
    tracking_mode: formData.get('tracking_mode'),
    default_shelf_life_days: blank(formData.get('default_shelf_life_days')),
  });

  if (!parsed.success) return { status: 'error', message: firstIssue(parsed.error) };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('products')
    .insert({ ...parsed.data, created_by: session.userId })
    .select('id')
    .single();

  if (error) {
    // The unique index on barcode is the race-safe check; the lookup above is only a hint.
    if (error.code === '23505') {
      return { status: 'error', message: 'Someone just added that barcode. Scan it again to see it.' };
    }
    return { status: 'error', message: `Could not save the product (${error.code ?? 'unknown'}).` };
  }

  revalidatePath('/manage/products');
  return { status: 'saved', productId: data.id };
}

/**
 * Ranges a product at a site and stores that site's overrides in one upsert, so
 * "add to my site" and "edit my site's settings" are the same operation.
 */
export async function saveSiteProduct(
  _prev: SiteProductFormState,
  formData: FormData,
): Promise<SiteProductFormState> {
  const session = await requireRole('manager');

  const parsed = SiteOverrides.safeParse({
    product_id: String(formData.get('product_id') ?? ''),
    site_id: String(formData.get('site_id') ?? ''),
    retail_price: blank(formData.get('retail_price')),
    unit_cost: blank(formData.get('unit_cost')),
    par_level: blank(formData.get('par_level')),
    fixture: blank(formData.get('fixture')),
    tracking_mode_override: blank(formData.get('tracking_mode_override')),
    active: formData.get('active') === 'on',
  });

  if (!parsed.success) return { status: 'error', message: firstIssue(parsed.error) };

  // Re-resolve the site through the session rather than trusting the posted id:
  // a Server Action is reachable by direct POST, not only through our own form.
  const site = activeSite(session, parsed.data.site_id);
  if (!site || site.id !== parsed.data.site_id) {
    return { status: 'error', message: 'That site is not yours to change.' };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from('site_products')
    .upsert({ ...parsed.data, org_id: site.orgId }, { onConflict: 'site_id,product_id' });

  if (error) {
    return { status: 'error', message: `Could not save the site settings (${error.code ?? 'unknown'}).` };
  }

  revalidatePath('/manage/products');
  revalidatePath(`/manage/products/${parsed.data.product_id}`);
  return { status: 'saved' };
}
