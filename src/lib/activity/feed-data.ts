import 'server-only';
import type { createClient } from '@/lib/supabase/server';
import { buildFeed, type ActivityItem } from './feed';

type Db = Awaited<ReturnType<typeof createClient>>;

const WINDOW_DAYS = 7;   // older than a week is history, not activity
const PER_SOURCE = 25;   // enough of each kind to fill the list after merging
export const FEED_LENGTH = 15;

export type Activity = ActivityItem & { actor: string | null };

/** The site's latest activity, newest first, each with the name of who did it. */
export async function loadActivity(supabase: Db, siteId: string, now: Date): Promise<Activity[]> {
  const since = new Date(now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: deliveries }, { data: waste }, { data: answers }, { data: fixtures }] = await Promise.all([
    supabase
      .from('deliveries')
      .select('id, closed_at, received_by, suppliers(name), delivery_lines(count)')
      .eq('site_id', siteId).eq('status', 'closed').gte('closed_at', since)
      .order('closed_at', { ascending: false }).limit(PER_SOURCE),
    supabase
      .from('waste_events')
      .select('id, wasted_at, wasted_by, batch_id, qty, reason, products(name)')
      .eq('site_id', siteId).gte('wasted_at', since)
      .order('wasted_at', { ascending: false }).limit(PER_SOURCE),
    supabase
      .from('expiry_actions')
      .select('id, actioned_at, actioned_by, batch_id, action, stock_batches(status, marked_down_at, products(name))')
      .eq('site_id', siteId).eq('state', 'done').gte('actioned_at', since)
      .order('actioned_at', { ascending: false }).limit(PER_SOURCE),
    supabase
      .from('rotation_checks')
      .select('id, checked_at, checked_by, fixture')
      .eq('site_id', siteId).eq('state', 'done').gte('checked_at', since)
      .order('checked_at', { ascending: false }).limit(PER_SOURCE),
  ]);

  const feed = buildFeed({
    deliveries: (deliveries ?? []).flatMap((d) => (d.closed_at ? [{
      id: d.id, closedAt: d.closed_at, receivedBy: d.received_by, supplier: d.suppliers?.name ?? null,
      lines: d.delivery_lines?.[0]?.count ?? 0,
    }] : [])),
    waste: (waste ?? []).map((w) => ({
      id: w.id, wastedAt: w.wasted_at, wastedBy: w.wasted_by, batchId: w.batch_id,
      product: w.products?.name ?? null, qty: w.qty, reason: w.reason,
    })),
    answers: (answers ?? []).flatMap((a) => (a.actioned_at ? [{
      id: a.id, actionedAt: a.actioned_at, actionedBy: a.actioned_by, batchId: a.batch_id, action: a.action,
      product: a.stock_batches?.products?.name ?? null, batchStatus: a.stock_batches?.status ?? null,
      markedDown: Boolean(a.stock_batches?.marked_down_at),
    }] : [])),
    fixtures: (fixtures ?? []).flatMap((f) => (f.checked_at ? [{
      id: f.id, checkedAt: f.checked_at, checkedBy: f.checked_by, fixture: f.fixture,
    }] : [])),
  }, FEED_LENGTH);

  const actorIds = [...new Set(feed.flatMap((i) => (i.actorId ? [i.actorId] : [])))];
  const { data: people } = actorIds.length > 0
    ? await supabase.from('profiles').select('id, full_name').in('id', actorIds)
    : { data: [] };
  const nameOf = new Map((people ?? []).map((p) => [p.id, p.full_name]));
  return feed.map((item) => ({ ...item, actor: item.actorId ? nameOf.get(item.actorId) ?? null : null }));
}
