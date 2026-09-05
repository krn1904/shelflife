import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { WASTE_REASON_LABEL } from '@/lib/expiry/waste-reasons';

const COLUMNS = ['Date', 'Site', 'Product', 'Brand', 'Size', 'Reason', 'Quantity', 'Value AUD', 'Note'];

/**
 * Quotes a field for CSV, and defuses formula injection.
 *
 * A leading =, +, - or @ makes Excel treat the cell as a formula when the file is opened,
 * which turns a product name someone typed into executable content on the owner's
 * machine. Prefixing an apostrophe keeps the text readable and inert.
 */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET() {
  await requireRole('owner');
  const supabase = await createClient();

  // RLS scopes this to the owner's own sites; no explicit filter is needed or wanted.
  const { data: events, error } = await supabase
    .from('waste_events')
    .select('wasted_at, qty, reason, value_aud, note, sites(name), products(name, brand, size)')
    .order('wasted_at', { ascending: false })
    .limit(10000);

  if (error) {
    return new Response(`Could not build the export (${error.code ?? 'unknown'}).`, { status: 500 });
  }

  const lines = [COLUMNS.map(csvCell).join(',')];
  for (const e of events ?? []) {
    lines.push([
      new Date(e.wasted_at).toISOString().slice(0, 10),
      e.sites?.name ?? '',
      e.products?.name ?? '',
      e.products?.brand ?? '',
      e.products?.size ?? '',
      WASTE_REASON_LABEL[e.reason],
      e.qty,
      e.value_aud ?? '',
      e.note ?? '',
    ].map(csvCell).join(','));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(lines.join('\r\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="shelflife-waste-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
