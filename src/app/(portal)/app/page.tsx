import Link from 'next/link';
import { activeSite, requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { Stat } from '@/components/stat';
import { DemoJump } from '@/components/demo-jump';
import { demoEnabled } from '@/lib/demo/actions';

export default async function ShiftPage() {
  const session = await requireSession();
  const site = activeSite(session);
  if (!site) {
    return (
      <div>
        <h1 className="text-xl font-semibold">Shift</h1>
        <p className="mt-2 text-sm text-neutral-500">You are not assigned to a store yet.</p>
      </div>
    );
  }

  const supabase = await createClient();

  // RLS scopes all of these to what this user may see, so no explicit filter is needed.
  const [{ count: catalogue }, { data: sites }, { count: openDeliveries }, { count: openActions }] =
    await Promise.all([
      supabase.from('site_products').select('*', { count: 'exact', head: true }).eq('site_id', site.id),
      supabase.from('sites').select('name').eq('id', site.id).maybeSingle(),
      supabase.from('deliveries').select('*', { count: 'exact', head: true }).eq('site_id', site.id).eq('status', 'draft'),
      supabase.from('expiry_actions').select('*', { count: 'exact', head: true }).eq('site_id', site.id).eq('state', 'open'),
    ]);

  return (
    <div>
      <h1 className="text-xl font-semibold">Shift</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {session.fullName ?? session.email} · {sites?.name ?? site.name}
      </p>

      {(await demoEnabled()) && (
        <div className="mt-6">
          <DemoJump />
        </div>
      )}

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Ranged products" value={catalogue ?? 0} hint="active at your site" />
        <Stat label="To action today" value={openActions ?? 0} hint="dated stock needing a decision" />
        <Stat label="Open deliveries" value={openDeliveries ?? 0} hint="started but not closed" />
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <Link
          href="/app/today"
          className="rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
        >
          Today’s list
        </Link>
        <Link
          href="/app/deliveries"
          className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium"
        >
          Receive a delivery
        </Link>
        <Link
          href="/app/waste"
          className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium"
        >
          Scan to waste
        </Link>
        <Link
          href="/app/scan"
          className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium"
        >
          Look up a product
        </Link>
        <Link
          href="/app/settings"
          className="rounded border border-neutral-300 px-4 py-2 text-sm font-medium"
        >
          Notifications
        </Link>
      </div>
    </div>
  );
}
