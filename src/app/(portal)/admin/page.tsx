import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { Stat } from '@/components/stat';

export default async function AdminPage() {
  await requireRole('platform_admin');
  const supabase = await createClient();

  // is_platform_admin() widens every policy, so these reads span all tenants.
  const [{ data: orgs }, { count: products }, { data: sites }] = await Promise.all([
    supabase.from('orgs').select('id, name, slug').order('name'),
    supabase.from('products').select('*', { count: 'exact', head: true }),
    supabase.from('sites').select('id, org_id'),
  ]);

  const sitesByOrg = new Map<string, number>();
  for (const s of sites ?? []) sitesByOrg.set(s.org_id, (sitesByOrg.get(s.org_id) ?? 0) + 1);

  return (
    <div>
      <h1 className="text-xl font-semibold">Platform</h1>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Tenants" value={orgs?.length ?? 0} />
        <Stat label="Sites" value={sites?.length ?? 0} />
        <Stat label="Catalogue products" value={products ?? 0} hint="shared across tenants" />
      </div>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">Tenants</h2>
      <table className="mt-2 w-full border-collapse overflow-hidden rounded border border-neutral-200 text-sm">
        <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr><th className="px-4 py-2">Org</th><th className="px-4 py-2">Slug</th><th className="px-4 py-2">Sites</th></tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {(orgs ?? []).map((o) => (
            <tr key={o.id}>
              <td className="px-4 py-2">{o.name}</td>
              <td className="px-4 py-2 text-neutral-500">{o.slug}</td>
              <td className="px-4 py-2 tabular-nums">{sitesByOrg.get(o.id) ?? 0}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
