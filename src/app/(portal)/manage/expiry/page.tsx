import Link from 'next/link';
import { differenceInCalendarDays, format, parseISO } from 'date-fns';
import { activeSite, requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { today } from '@/lib/intake/expiry';
import { BUCKET_LABEL, bucketFor, type ExpiryBucket } from '@/lib/analytics/aggregate';
import { boardWindow, daysLeftShort, daysLeftTone, WATCH_DAYS, WATCH_PREVIEW } from '@/lib/expiry/display';
import { firstParam } from '@/lib/search-params';
import { PageHeader } from '@/components/ui';

const GROUPS: ExpiryBucket[] = ['overdue', 'today', 'soon', 'watch'];

// The filter dot beside each bucket name. It is never the only cue: the name is written.
const DOT: Record<ExpiryBucket, string> = {
  overdue: 'bg-critical-fill',
  today: 'bg-warning-fill',
  soon: 'bg-ink',
  watch: 'bg-line-strong',
};

/** Days-left bars are scaled to the board's horizon: a full bar is a month away. */
const HORIZON_DAYS = WATCH_DAYS;

/** "Show all" still has a ceiling, so one busy site cannot send thousands of rows. */
const WATCH_LIMIT = 500;

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
  const shown = GROUPS.find((g) => g === firstParam(params.show)) ?? null;
  const supabase = await createClient();
  const asOf = today();

  const { soonEnd, watchEnd } = boardWindow(asOf);
  const listWatch = shown === null || shown === 'watch';

  // Ask the database only for what the board shows: every urgent batch, a page of the next
  // three weeks (all of it when that group is opened), and a bare count beyond 30 days.
  // Loading every dated batch made the board thousands of rows long and slow on a phone.
  const batches = (count?: 'exact', head = false) =>
    supabase
      .from('stock_batches')
      .select('id, expiry_date, expiry_source, qty_remaining, products(name, brand, size)', { count, head })
      .eq('site_id', site!.id)
      .eq('status', 'active')
      .gt('qty_remaining', 0)
      .not('expiry_date', 'is', null);

  const [urgent, watch, beyond] = site
    ? await Promise.all([
        batches().lte('expiry_date', soonEnd).order('expiry_date'),
        batches('exact', !listWatch)
          .gt('expiry_date', soonEnd)
          .lte('expiry_date', watchEnd)
          .order('expiry_date')
          .limit(shown === 'watch' ? WATCH_LIMIT : WATCH_PREVIEW),
        batches('exact', true).gt('expiry_date', watchEnd),
      ])
    : [null, null, null];

  const cards: BoardCard[] = [...(urgent?.data ?? []), ...(listWatch ? watch?.data ?? [] : [])].flatMap((b) => {
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

  const watchTotal = watch?.count ?? 0;
  const beyondTotal = beyond?.count ?? 0;
  const groups = GROUPS.map((bucket) => {
    const rows = cards.filter((c) => bucketFor(c.daysLeft) === bucket);
    // Urgent groups are loaded whole; "Within 30 days" is counted by the database.
    return { bucket, cards: rows, total: bucket === 'watch' ? watchTotal : rows.length };
  });
  const allTotal = groups.reduce((sum, g) => sum + g.total, 0) + beyondTotal;
  const visible = groups.filter((g) => (shown ? g.bucket === shown : g.total > 0));

  // Filters are plain links that keep the chosen site, so the board stays a server page.
  const filterHref = (bucket: ExpiryBucket | null) => {
    const query = new URLSearchParams();
    if (site && session.sites.length > 1) query.set('site', site.id);
    if (bucket) query.set('show', bucket);
    const qs = query.toString();
    return qs ? `/manage/expiry?${qs}` : '/manage/expiry';
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expiry board"
        subtitle={site ? `${site.name} · ${allTotal} dated ${allTotal === 1 ? 'batch' : 'batches'} on shelf` : 'No site'}
        actions={
          session.sites.length > 1 && site ? (
            <form className="flex items-end gap-2">
              {shown && <input type="hidden" name="show" value={shown} />}
              <label className="flex flex-col gap-1 text-xs font-semibold text-muted">
                Site
                <select name="site" defaultValue={site.id} className="field min-w-44">
                  {session.sites.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn btn-outline">Show</button>
            </form>
          ) : undefined
        }
      />

      <nav aria-label="Filter by days left" className="flex flex-wrap gap-2">
        <Link
          href={filterHref(null)}
          aria-current={shown === null ? 'true' : undefined}
          className={`btn btn-sm ${shown === null ? 'bg-ink text-paper' : 'btn-outline'}`}
        >
          All · <span className="font-mono">{allTotal - beyondTotal}</span>
        </Link>
        {groups.map(({ bucket, total }) => (
          <Link
            key={bucket}
            href={filterHref(bucket)}
            aria-current={shown === bucket ? 'true' : undefined}
            className={`btn btn-sm ${shown === bucket ? 'bg-ink text-paper' : 'btn-outline'}`}
          >
            <span aria-hidden className={`size-2 rounded-[2px] ${DOT[bucket]}`} />
            {BUCKET_LABEL[bucket]} · <span className="font-mono">{total}</span>
          </Link>
        ))}
      </nav>

      {allTotal === 0 ? (
        <p className="card px-5 py-6 text-sm text-muted">
          No dated stock yet. Batches appear here once a delivery with batch-tracked lines
          is closed.
        </p>
      ) : visible.length === 0 ? (
        <p className="card px-5 py-6 text-sm text-muted">
          Nothing is dated in the next {WATCH_DAYS} days.
        </p>
      ) : (
        <div className="card overflow-x-auto">
          {/* Days left sits beside the name so it never scrolls off a phone; extras drop on small screens. */}
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Product</th>
                <th scope="col">Days left</th>
                <th scope="col">Left</th>
                <th scope="col" className="max-sm:hidden">Expires</th>
                <th scope="col" className="max-md:hidden"><span className="sr-only">Note</span></th>
              </tr>
            </thead>
            {visible.map(({ bucket, cards: rows, total }) => (
              <tbody key={bucket}>
                <tr>
                  <th colSpan={5} scope="colgroup" className="bg-surface-2 !py-2 text-xs !font-bold !text-ink">
                    {BUCKET_LABEL[bucket]}
                  </th>
                </tr>
                {rows.map((card) => (
                  <tr key={card.id}>
                    <td>
                      <div className="font-semibold">{card.name}</div>
                      {card.detail && <div className="text-xs text-muted">{card.detail}</div>}
                      <div className="font-mono text-xs text-muted sm:hidden">
                        expires {format(parseISO(card.expiryDate), 'dd/MM')}
                      </div>
                      {card.predicted && (
                        <div className="text-xs font-semibold text-warning md:hidden">Date never confirmed</div>
                      )}
                    </td>
                    <td>
                      {card.daysLeft <= 0 ? (
                        <span className={`pill pill-${daysLeftTone(card.daysLeft)}`}>{daysLeftShort(card.daysLeft)}</span>
                      ) : (
                        <div className="flex items-center gap-2.5">
                          <span className={`w-6 font-mono ${bucket === 'watch' ? 'text-muted' : ''}`}>{card.daysLeft}</span>
                          <span aria-hidden className="h-1.5 w-32 rounded-full bg-surface-2 max-sm:hidden">
                            <span
                              className={`block h-1.5 rounded-full ${bucket === 'watch' ? 'bg-faint' : 'bg-ink'}`}
                              style={{ width: `${Math.min(100, (card.daysLeft / HORIZON_DAYS) * 100)}%` }}
                            />
                          </span>
                        </div>
                      )}
                    </td>
                    <td className="font-mono">{card.qty}</td>
                    <td className="font-mono max-sm:hidden">{format(parseISO(card.expiryDate), 'dd/MM')}</td>
                    <td className="text-xs font-semibold text-warning max-md:hidden">
                      {card.predicted && 'Date never confirmed'}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-sm text-muted">Nothing here.</td>
                  </tr>
                )}
                {rows.length < total && (
                  <tr>
                    <td colSpan={5} className="text-sm text-muted">
                      Showing {rows.length} of {total}.{' '}
                      {shown === bucket ? (
                        `The board lists at most ${WATCH_LIMIT}, soonest first.`
                      ) : (
                        <Link href={filterHref(bucket)} className="font-semibold text-brand-text underline">
                          Show all
                        </Link>
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
            ))}
          </table>
        </div>
      )}

      {beyondTotal > 0 && (
        <p className="px-1 text-sm text-muted">
          <span className="font-mono">{beyondTotal}</span> more {beyondTotal === 1 ? 'batch is' : 'batches are'} dated
          more than {WATCH_DAYS} days out. They join the board as their dates come closer.
        </p>
      )}
    </div>
  );
}
