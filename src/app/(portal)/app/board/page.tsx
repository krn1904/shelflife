import Link from 'next/link';
import { activeSite, requireSession } from '@/lib/auth/session';
import { loadBoard } from '@/lib/expiry/board-data';
import { PageHeader } from '@/components/ui';
import { ExpiryBoard } from '@/components/expiry-board';

/** The staff view of the expiry board: their own site, answerable like the Today list. */
export default async function StaffBoardPage() {
  const session = await requireSession();
  const site = activeSite(session);

  if (!site) return <PageHeader title="Expiry board" subtitle="You are not assigned to a site yet." />;

  const board = await loadBoard(site.id, site.timeZone);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Expiry board"
        subtitle={site.name}
        actions={<Link href="/app/today" className="btn btn-outline">Today&apos;s list</Link>}
      />
      <ExpiryBoard board={board} timeZone={site.timeZone} />
    </div>
  );
}
