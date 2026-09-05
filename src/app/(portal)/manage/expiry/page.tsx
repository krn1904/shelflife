import { differenceInCalendarDays, parseISO } from 'date-fns';
import { activeSite, requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { today } from '@/lib/intake/expiry';
import { BUCKET_LABEL, bucketFor, type ExpiryBucket } from '@/lib/analytics/aggregate';
import { STATUS } from '@/lib/charts/tokens';
import { firstParam } from '@/lib/search-params';

const COLUMNS: ExpiryBucket[] = ['overdue', 'today', 'soon', 'watch'];

// Status colour is a block accent beside a written column heading, never the only thing
// telling two columns apart — warning and serious sit under 3:1 on white.
const ACCENT: Record<ExpiryBucket, string> = {
  overdue: STATUS.critical,
  today: STATUS.serious,
  soon: STATUS.warning,
  watch: STATUS.good,
};

type BoardCard = {
  id: string;
  name: string;
  detail: string;
  qty: number;
  expiryDate: string;
  daysLeft: number;
  predicted: boolean;
};

export default async function ExpiryBoardPage(props: PageProps<'/manage/expiry'>) {
  const session = await requireRole('manager');
  const params = await props.searchParams;
  const site = activeSite(session, firstParam(params.site));
  const supabase = await createClient();
  const asOf = today();

  const { data: batches } = site
    ? await supabase
        .from('stock_batches')
        .select('id, expiry_date, expiry_source, qty_remaining, products(name, brand, size)')
        .eq('site_id', site.id)
        .eq('status', 'active')
        .gt('qty_remaining', 0)
        .not('expiry_date', 'is', null)
        .order('expiry_date')
    : { data: [] };

  const cards: BoardCard[] = (batches ?? []).flatMap((b) => {
    if (!b.expiry_date) return [];
    return [{
      id: b.id,
      name: b.products?.name ?? 'Unknown product',
      detail: [b.products?.brand, b.products?.size].filter(Boolean).join(' · '),
      qty: b.qty_remaining,
      expiryDate: b.expiry_date,
      daysLeft: differenceInCalendarDays(parseISO(b.expiry_date), parseISO(asOf)),
      // A date nobody looked at is worth flagging: it is where a surprise write-off
      // comes from, and the manager triaging one needs to know which dates were guesses.
      predicted: b.expiry_source === 'predicted',
    }];
  });

  const board = COLUMNS.map((bucket) => ({
    bucket,
    cards: cards.filter((c) => bucketFor(c.daysLeft) === bucket),
  }));

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold">Expiry board</h1>
        <p className="text-sm text-neutral-500">{site?.name ?? 'No site'}</p>
      </div>

      {session.sites.length > 1 && site && (
        <form className="mt-4">
          <select
            name="site"
            defaultValue={site.id}
            className="rounded border border-neutral-300 px-3 py-2 text-sm"
          >
            {session.sites.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button type="submit" className="ml-2 rounded border border-neutral-300 px-3 py-2 text-sm">
            Show
          </button>
        </form>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-4">
        {board.map(({ bucket, cards: column }) => (
          <section key={bucket} className="rounded border border-neutral-200">
            <header className="flex items-center gap-2 border-b border-neutral-200 px-3 py-2">
              <span
                aria-hidden
                className="inline-block size-3 rounded-sm"
                style={{ backgroundColor: ACCENT[bucket] }}
              />
              <h2 className="text-sm font-medium">{BUCKET_LABEL[bucket]}</h2>
              <span className="ml-auto text-xs tabular-nums text-neutral-500">{column.length}</span>
            </header>

            <ul className="divide-y divide-neutral-100">
              {column.map((card) => (
                <li key={card.id} className="px-3 py-2">
                  <p className="text-sm font-medium">{card.name}</p>
                  <p className="text-xs text-neutral-500">{card.detail}</p>
                  <p className="mt-1 text-xs tabular-nums text-neutral-600">
                    {card.qty} left · {card.expiryDate}
                  </p>
                  {card.predicted && (
                    <p className="mt-1 text-xs text-amber-700">Date never confirmed</p>
                  )}
                </li>
              ))}
              {column.length === 0 && (
                <li className="px-3 py-3 text-xs text-neutral-500">Nothing here.</li>
              )}
            </ul>
          </section>
        ))}
      </div>

      {cards.length === 0 && (
        <p className="mt-6 text-sm text-neutral-500">
          No dated stock yet. Batches appear here once a delivery with batch-tracked lines
          is closed.
        </p>
      )}
    </div>
  );
}
