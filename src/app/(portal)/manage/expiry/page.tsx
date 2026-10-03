import { activeSite, requireRole } from '@/lib/auth/session';
import { firstParam } from '@/lib/search-params';
import { loadBoard } from '@/lib/expiry/board-data';
import { PageHeader } from '@/components/ui';
import { ExpiryBoard } from '@/components/expiry-board';

/** The manager's expiry board: the same board staff see, for any of their sites. */
export default async function ExpiryBoardPage(props: PageProps<'/manage/expiry'>) {
  const session = await requireRole('manager');
  const params = await props.searchParams;
  const site = activeSite(session, firstParam(params.site));

  if (!site) return <PageHeader title="Expiry board" subtitle="No site assigned" />;

  const board = await loadBoard(site.id, site.timeZone);
  const siteSites = session.sites.filter((s) => s.orgId === site.orgId);

  return (
    <div className="space-y-6">
      <PageHeader title="Expiry board" subtitle={`Dated stock at ${site.name}, by what it needs`} />

      {siteSites.length > 1 && (
        <form className="card flex flex-wrap items-end gap-3 p-4 text-sm" action="/manage/expiry">
          <label className="space-y-1">
            <span className="block text-xs text-muted">Site</span>
            <select name="site" defaultValue={site.id} className="field w-auto">
              {siteSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn-outline">Show</button>
        </form>
      )}

      {/* Keyed by site so answered cards from one site do not stay hidden on another. */}
      <ExpiryBoard key={site.id} board={board} timeZone={site.timeZone} />
    </div>
  );
}
