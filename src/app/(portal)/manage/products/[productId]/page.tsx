import Link from 'next/link';
import { notFound } from 'next/navigation';
import { activeSite, requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { TRACKING_HINT, TRACKING_LABEL, effectiveTrackingMode } from '@/lib/products/tracking';
import { firstParam } from '@/lib/search-params';
import { OverridesForm } from './overrides-form';
import { ReviewForm } from './review-form';

export default async function ProductDetailPage(props: PageProps<'/manage/products/[productId]'>) {
  const session = await requireRole('manager');
  const { productId } = await props.params;
  const params = await props.searchParams;
  const site = activeSite(session, firstParam(params.site));
  const supabase = await createClient();

  const { data: product } = await supabase
    .from('products')
    .select('id, org_id, reviewed_at, barcode, name, brand, size, category, tracking_mode, default_shelf_life_days')
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
  // Added from one of this organisation's dockets: theirs to correct, unlike the shared catalogue.
  const fromDocket = product.org_id !== null;
  const fromDelivery = firstParam(params.from);
  const backToDelivery = fromDelivery && /^[0-9a-f-]{36}$/i.test(fromDelivery) ? `/manage/deliveries/${fromDelivery}` : null;

  return (
    <div>
      <Link href={backToDelivery ?? '/manage/products'} className="inline-flex min-h-8 items-center text-sm font-semibold text-muted hover:text-ink">
        {backToDelivery ? '← Back to the delivery' : '← All products'}
      </Link>

      <h1 className="mt-3 text-[1.875rem] font-bold leading-tight tracking-tight sm:text-[2rem]">{product.name}</h1>
      <p className="mt-1 text-sm text-muted">
        {[product.brand, product.size, product.category].filter(Boolean).join(' · ') || 'No details recorded.'}
      </p>
      <p className="mt-1 font-mono text-sm tabular-nums text-muted">{product.barcode}</p>

      {fromDocket ? (
        <section className="mt-6 card p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="section-title">Added from a docket</h2>
            <span className={`badge ${product.reviewed_at ? 'badge-neutral' : 'bg-warning-soft text-warning'}`}>
              {product.reviewed_at ? 'reviewed' : 'to review'}
            </span>
          </div>
          <p className="mt-2 text-xs text-muted">
            Staff added this from your organisation&apos;s docket, named as the docket printed it. Only your
            organisation sees it, so correct it here.
          </p>
          <div className="mt-4">
            {site ? (
              <ReviewForm
                productId={product.id}
                siteId={site.id}
                reviewed={product.reviewed_at !== null}
                values={{
                  name: product.name,
                  brand: product.brand,
                  size: product.size,
                  barcode: product.barcode,
                  trackingMode: product.tracking_mode,
                  shelfLifeDays: product.default_shelf_life_days,
                  fixture: ranged?.fixture ?? null,
                }}
              />
            ) : (
              <p className="text-sm text-muted">You are not assigned to a site, so there is nothing to review this against.</p>
            )}
          </div>
        </section>
      ) : (
        <section className="mt-6 card p-4">
          <h2 className="section-title">
            Catalogue defaults
          </h2>
          <p className="mt-2 text-sm">
            <span className="font-medium">{TRACKING_LABEL[product.tracking_mode]}</span>
            {product.default_shelf_life_days !== null && (
              <> · typically {product.default_shelf_life_days} days shelf life</>
            )}
          </p>
          <p className="mt-1 text-xs text-muted">{TRACKING_HINT[product.tracking_mode]}</p>
          <p className="mt-2 text-xs text-muted">
            Shared with every organisation. Change it at your site below rather than here.
          </p>
        </section>
      )}

      <section className="mt-6 card p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="section-title">
            At {site?.name ?? 'your site'}
          </h2>
          <span className="text-xs text-muted">
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
            <p className="text-sm text-muted">
              You are not assigned to a site, so there is nothing to range this against.
            </p>
          )}
        </div>
      </section>
    </div>
  );
}
