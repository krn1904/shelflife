import Link from 'next/link';
import { requireSession } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { Stat } from '@/components/stat';

export default async function ShiftPage() {
  const session = await requireSession();
  const supabase = await createClient();

  // RLS scopes both of these to what this user may see, so no explicit filter is needed.
  const [{ count: catalogue }, { data: sites }] = await Promise.all([
    supabase.from('site_products').select('*', { count: 'exact', head: true }),
    supabase.from('sites').select('name'),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold">Shift</h1>
      <p className="mt-1 text-sm text-neutral-500">
        {session.fullName ?? session.email} · {sites?.map((s) => s.name).join(', ') || 'no site assigned'}
      </p>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Ranged products" value={catalogue ?? 0} hint="active at your site" />
        <Stat label="To action today" value="—" hint="expiry engine lands in batch 5" />
        <Stat label="Open deliveries" value="—" hint="intake lands in batch 4" />
      </div>

      <Link
        href="/app/scan"
        className="mt-6 inline-block rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
      >
        Scan a product
      </Link>
    </div>
  );
}
