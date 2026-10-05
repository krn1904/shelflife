import 'server-only';
import { addDays, format, parseISO } from 'date-fns';
import { createClient } from '@/lib/supabase/server';
import { fetchAllPages } from '@/lib/pagination';
import { todayIn } from '@/lib/intake/expiry';
import { settingsFromRow } from '@/lib/expiry/engine';
import { buildBoard, type Board, type BoardBatch, type OpenReminder } from '@/lib/expiry/board';

const BATCH_COLUMNS = 'id, expiry_date, expiry_source, qty_remaining, marked_down_at, products(name, brand, size)';

type BatchRow = {
  id: string;
  expiry_date: string | null;
  expiry_source: string;
  qty_remaining: number;
  marked_down_at: string | null;
  products: { name: string; brand: string | null; size: string | null } | null;
};

/**
 * Reads one site's board: today's open reminders (the same rows the Today list shows), its
 * reminder settings, whose early-check days set how far "Coming up" looks ahead, and only
 * the dated stock that can appear as a card. RLS limits all of it to the viewer's sites.
 *
 * A card is a batch with an open reminder, one on or before the end of the look-ahead
 * window, or one already on half price (see `buildBoard`). Everything else is only
 * counted: a busy site holds hundreds of batches dated months out, and loading them all
 * made the board slow to open.
 */
export async function loadBoard(siteId: string, timeZone: string): Promise<Board> {
  const supabase = await createClient();
  const today = todayIn(timeZone);

  const [{ data: reminders }, { data: settingsRow }] = await Promise.all([
    supabase.from('expiry_actions').select('id, batch_id, action').eq('site_id', siteId).eq('state', 'open'),
    supabase
      .from('reminder_settings')
      .select('short_max_days, medium_max_days, short_markdown_days, medium_markdown_days, long_check_days, long_markdown_days')
      .eq('site_id', siteId)
      .maybeSingle(),
  ]);
  const lookAheadDays = settingsFromRow(settingsRow).longCheckDays;
  const windowEnd = format(addDays(parseISO(today), lookAheadDays), 'yyyy-MM-dd');
  const open: OpenReminder[] = (reminders ?? []).map((r) => ({ id: r.id, batchId: r.batch_id, action: r.action }));

  // The same set of batches the board has always been built from.
  const dated = (count?: 'exact', head = false) =>
    supabase
      .from('stock_batches')
      .select(BATCH_COLUMNS, { count, head })
      .eq('site_id', siteId)
      .eq('status', 'active')
      .gt('qty_remaining', 0)
      .not('expiry_date', 'is', null);

  const [near, beyond, reminded] = await Promise.all([
    // Paged: a busy site can hold more batches in the window than one PostgREST page.
    fetchAllPages<BatchRow>((from, to) =>
      dated()
        .or(`expiry_date.lte.${windowEnd},marked_down_at.not.is.null`)
        .order('id')
        .range(from, to)),
    // Past the window and not on half price: counted, unless a reminder brings it in below.
    dated('exact', true).gt('expiry_date', windowEnd).is('marked_down_at', null),
    // Batches with a reminder today, wherever their date falls (long-life early checks).
    batchesById(open.map((r) => r.batchId), (ids) => dated().in('id', ids)),
  ]);

  const byId = new Map<string, BatchRow>();
  for (const row of [...near, ...reminded]) byId.set(row.id, row);

  const rows: BoardBatch[] = [...byId.values()].flatMap((b) => (b.expiry_date ? [{
    id: b.id,
    expiryDate: b.expiry_date,
    qtyRemaining: b.qty_remaining,
    markedDownOn: b.marked_down_at,
    name: b.products?.name ?? 'Unknown product',
    detail: [b.products?.brand, b.products?.size].filter(Boolean).join(' · '),
    // A date nobody confirmed is where a surprise write-off comes from.
    predicted: b.expiry_source === 'predicted',
  }] : []));

  // Batches past the window that a reminder brought onto the board are cards, not "later".
  const shownBeyond = reminded.filter((b) => b.expiry_date && b.expiry_date > windowEnd && !b.marked_down_at).length;
  const board = buildBoard(rows, open, today, lookAheadDays);
  return { ...board, laterCount: board.laterCount + Math.max(0, (beyond.count ?? 0) - shownBeyond) };
}

/** Reads batches by id in chunks, so a long reminder list never makes an oversized URL. */
async function batchesById(
  ids: string[],
  query: (ids: string[]) => PromiseLike<{ data: BatchRow[] | null; error: { message: string } | null }>,
): Promise<BatchRow[]> {
  const CHUNK = 100;
  const unique = [...new Set(ids)];
  const chunks = Array.from({ length: Math.ceil(unique.length / CHUNK) }, (_, i) => unique.slice(i * CHUNK, (i + 1) * CHUNK));
  const results = await Promise.all(chunks.map((chunk) => query(chunk)));
  return results.flatMap(({ data, error }) => {
    if (error) throw new Error(error.message);
    return data ?? [];
  });
}
