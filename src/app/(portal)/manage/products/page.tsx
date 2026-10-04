import Link from 'next/link';
import { activeSite, requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { TRACKING_LABEL, effectiveTrackingMode } from '@/lib/products/tracking';
import { firstParam } from '@/lib/search-params';

const RESULT_LIMIT = 200;

/**
 * PostgREST's `or` filter is comma- and paren-delimited, so a search for "Coke (1.25L)"
 * would otherwise be parsed as filter syntax rather than matched as text.
 */
function escapeFilterTerm(term: string): string {
  return term.replace(/[,()\\*%]/g, ' ').trim();
}

export default async function ProductsPage(props: PageProps<'/manage/products'>) {
  const session = await requireRole('manager');
  const params = await props.searchParams;
  const query = escapeFilterTerm(firstParam(params.q) ?? '');
  const site = activeSite(session, firstParam(params.site));
  const supabase = await createClient();

  let request = supabase
    .from('products')
    // One string literal, not a concatenation: supabase-js derives the row type from
    // this exact literal, and a `+` here collapses the result to an untyped error.
    .select('id, barcode, name, brand, size, category, tracking_mode, site_products(id, fixture, par_level, retail_price, tracking_mode_override, active)')
    .order('name')
    .limit(RESULT_LIMIT);

  if (site) request = request.eq('site_products.site_id', site.id);
  if (query) {
    request = request.or(
      `name.ilike.%${query}%,brand.ilike.%${query}%,barcode.ilike.%${query}%`,
    );
  }

  const { data: products, error } = await request;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-[1.875rem] font-bold leading-tight tracking-tight sm:text-[2rem]">Products</h1>
        <p className="text-sm text-muted">
          Ranging and prices for {site?.name ?? 'your site'}
        </p>
      </div>

      <form className="mt-4 flex flex-wrap gap-2">
        {site && session.sites.length > 1 && (
          <select
            name="site"
            defaultValue={site.id}
            className="field"
          >
            {session.sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        )}
        <input
          name="q"
          defaultValue={firstParam(params.q) ?? ''}
          placeholder="Search name, brand or barcode"
          className="min-w-64 flex-1 field"
        />
        <button
          type="submit"
          className="btn btn-primary"
        >
          Search
        </button>
      </form>

      {error && (
        <p className="mt-4 alert alert-critical">
          Could not load the catalogue ({error.code ?? 'unknown'}).
        </p>
      )}

      <ul className="mt-6 divide-y divide-line card">
        {(products ?? []).map((product) => {
          const ranged = product.site_products[0];
          const mode = effectiveTrackingMode(product.tracking_mode, ranged?.tracking_mode_override);

          return (
            <li key={product.id}>
              <Link
                href={`/manage/products/${product.id}${site ? `?site=${site.id}` : ''}`}
                className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 hover:bg-surface-2"
              >
                <span className="text-sm font-medium">{product.name}</span>
                <span className="text-xs text-muted">
                  {[product.brand, product.size].filter(Boolean).join(' · ')}
                </span>
                <span className="ml-auto flex items-center gap-2 text-xs">
                  <span className="badge badge-neutral">{TRACKING_LABEL[mode]}</span>
                  {ranged?.active ? (
                    <span className="text-muted">{ranged.fixture ?? 'Ranged'}</span>
                  ) : (
                    <span className="text-warning">Not ranged</span>
                  )}
                </span>
              </Link>
            </li>
          );
        })}

        {!error && products?.length === 0 && (
          <li className="px-4 py-3 text-sm text-muted">
            {query ? 'Nothing matched that search.' : 'The catalogue is empty.'}
          </li>
        )}
      </ul>

      {products?.length === RESULT_LIMIT && (
        <p className="mt-2 text-xs text-muted">
          Showing the first {RESULT_LIMIT}. Narrow the search to see more.
        </p>
      )}
    </div>
  );
}
