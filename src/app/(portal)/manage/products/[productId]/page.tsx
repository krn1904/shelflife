import Link from 'next/link';
import { notFound } from 'next/navigation';
import { activeSite, requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { TRACKING_HINT, TRACKING_LABEL, effectiveTrackingMode } from '@/lib/products/tracking';
import { firstParam } from '@/lib/search-params';
import { OverridesForm } from './overrides-form';

export default async function ProductDetailPage(props: PageProps<'/manage/products/[productId]'>) {
  const session = await requireRole('manager');
  const { productId } = await props.params;
  const params = await props.searchParams;
  const site = activeSite(session, firstParam(params.site));
  const supabase = await createClient();

  const { data: product } = await supabase
    .from('products')
    .select('id, barcode, name, brand, size, category, tracking_mode, default_shelf_life_days')
    .eq('id', productId)
    .maybeSingle();

  if (!product) notFound();

  const { data: ranged } = site
    ? await supabase
        .from('site_products')
        .select('retail_price, unit_cost, par_level, fixture, tracking_mode_override, active')
        .eq('site_id', site.id)
        .eq('product_id', product.id)
        .maybeSingle()
    : { data: null };

  const mode = effectiveTrackingMode(product.tracking_mode, ranged?.tracking_mode_override);

  return (
    <div>
      <Link href="/manage/products" className="text-sm text-neutral-500 underline">
        ← All products
      </Link>

      <h1 className="mt-3 text-xl font-semibold">{product.name}</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {[product.brand, product.size, product.category].filter(Boolean).join(' · ') || 'No details recorded.'}
      </p>
      <p className="mt-1 font-mono text-sm tabular-nums text-neutral-500">{product.barcode}</p>

      <section className="mt-6 rounded border border-neutral-200 p-4">
        <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
          Catalogue defaults
        </h2>
        <p className="mt-2 text-sm">
          <span className="font-medium">{TRACKING_LABEL[product.tracking_mode]}</span>
          {product.default_shelf_life_days !== null && (
            <> · typically {product.default_shelf_life_days} days shelf life</>
          )}
        </p>
        <p className="mt-1 text-xs text-neutral-500">{TRACKING_HINT[product.tracking_mode]}</p>
        <p className="mt-2 text-xs text-neutral-500">
          Shared with every tenant. Change it at your site below rather than here.
        </p>
      </section>

      <section className="mt-6 rounded border border-neutral-200 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-medium uppercase tracking-wide text-neutral-500">
            At {site?.name ?? 'your site'}
          </h2>
          <span className="text-xs text-neutral-500">
            Effective tracking: <span className="font-medium">{TRACKING_LABEL[mode]}</span>
          </span>
        </div>

        <div className="mt-4">
          {site ? (
            <OverridesForm
              productId={product.id}
              siteId={site.id}
              catalogueMode={product.tracking_mode}
              values={ranged ?? null}
            />
          ) : (
            <p className="text-sm text-neutral-500">
              You are not assigned to a site, so there is nothing to range this against.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
