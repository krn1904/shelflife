import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { fetchAllPages } from '@/lib/pagination';
import { today } from '@/lib/intake/expiry';
import { settingsFromRow } from '@/lib/expiry/engine';
import { buildBoard, type Board, type BoardBatch, type OpenReminder } from '@/lib/expiry/board';

/**
 * Reads one site's board: its dated stock, today's open reminders (the same rows the
 * Today list shows) and its reminder settings, whose early-check days set how far
 * "Coming up" looks ahead. RLS limits all of it to sites the viewer belongs to.
 */
export async function loadBoard(siteId: string): Promise<Board> {
  const supabase = await createClient();

  const [batches, { data: reminders }, { data: settingsRow }] = await Promise.all([
    // Paged: a busy site can hold more dated batches than one PostgREST page.
    fetchAllPages<{
      id: string;
      expiry_date: string | null;
      expiry_source: string;
      qty_remaining: number;
      marked_down_at: string | null;
      products: { name: string; brand: string | null; size: string | null } | null;
    }>((from, to) =>
      supabase
        .from('stock_batches')
        .select('id, expiry_date, expiry_source, qty_remaining, marked_down_at, products(name, brand, size)')
        .eq('site_id', siteId)
        .eq('status', 'active')
        .gt('qty_remaining', 0)
        .not('expiry_date', 'is', null)
        .order('id')
        .range(from, to)),
    supabase.from('expiry_actions').select('id, batch_id, action').eq('site_id', siteId).eq('state', 'open'),
    supabase
      .from('reminder_settings')
      .select('short_max_days, medium_max_days, short_markdown_days, medium_markdown_days, long_check_days, long_markdown_days')
      .eq('site_id', siteId)
      .maybeSingle(),
  ]);

  const rows: BoardBatch[] = batches.flatMap((b) => (b.expiry_date ? [{
    id: b.id,
    expiryDate: b.expiry_date,
    qtyRemaining: b.qty_remaining,
    markedDownOn: b.marked_down_at,
    name: b.products?.name ?? 'Unknown product',
    detail: [b.products?.brand, b.products?.size].filter(Boolean).join(' · '),
    // A date nobody confirmed is where a surprise write-off comes from.
    predicted: b.expiry_source === 'predicted',
  }] : []));

  const open: OpenReminder[] = (reminders ?? []).map((r) => ({ id: r.id, batchId: r.batch_id, action: r.action }));
  return buildBoard(rows, open, today(), settingsFromRow(settingsRow).longCheckDays);
}
