import Link from 'next/link';
import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { Stat } from '@/components/stat';

export default async function ManagePage() {
  await requireRole('manager');
  const supabase = await createClient();

  const [{ data: suppliers }, { count: ranged }, { data: sites }] = await Promise.all([
    supabase.from('suppliers').select('name').order('name'),
    supabase.from('site_products').select('*', { count: 'exact', head: true }),
    supabase.from('sites').select('id, name').order('name'),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold">Site</h1>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Sites in scope" value={sites?.length ?? 0} />
        <Stat label="Suppliers" value={suppliers?.length ?? 0} />
        <Stat label="Ranged products" value={ranged ?? 0} />
      </div>

      <Link
        href="/manage/products"
        className="mt-6 inline-block rounded bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
      >
        Products &amp; ranging
      </Link>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">Suppliers</h2>
      <ul className="mt-2 divide-y divide-neutral-200 rounded border border-neutral-200">
        {(suppliers ?? []).map((s) => (
          <li key={s.name} className="px-4 py-2 text-sm">{s.name}</li>
        ))}
        {!suppliers?.length && <li className="px-4 py-2 text-sm text-neutral-500">None yet.</li>}
      </ul>
    </div>
  );
}
