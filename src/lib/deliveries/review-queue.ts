import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { latestArrivals, type NewItemArrival } from './review';

type Db = Awaited<ReturnType<typeof createClient>>;

// Lines, not products: a busy backlog is a few hundred lines, and this caps a runaway one.
const LINE_LIMIT = 1000;

/**
 * Items staff added from dockets that arrived at this site and no manager has reviewed,
 * each with the delivery it last came in on. The home tile and Deliveries both count this.
 */
export async function newItemsToReview(supabase: Db, siteId: string): Promise<NewItemArrival[]> {
  const { data } = await supabase
    .from('delivery_lines')
    .select('product_id, delivery_id, products!inner(name, org_id, reviewed_at), deliveries!inner(site_id, status, closed_at, suppliers(name))')
    .eq('deliveries.site_id', siteId)
    .eq('deliveries.status', 'closed')
    .not('products.org_id', 'is', null)
    .is('products.reviewed_at', null)
    .limit(LINE_LIMIT);

  return latestArrivals((data ?? []).map((l) => ({
    productId: l.product_id,
    name: l.products.name,
    deliveryId: l.delivery_id,
    closedAt: l.deliveries.closed_at,
    supplier: l.deliveries.suppliers?.name ?? null,
  })));
}
