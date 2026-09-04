import { requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { Stat } from '@/components/stat';

export default async function OwnerPage() {
  const session = await requireRole('owner');
  const supabase = await createClient();

  const [{ data: sites }, { data: suppliers }, { data: people }] = await Promise.all([
    supabase.from('sites').select('id, name, timezone').order('name'),
    supabase.from('suppliers').select('id'),
    supabase.from('memberships').select('role, profiles:user_id(full_name)'),
  ]);

  return (
    <div>
      <h1 className="text-xl font-semibold">{session.memberships[0]?.orgName}</h1>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Sites" value={sites?.length ?? 0} />
        <Stat label="Suppliers" value={suppliers?.length ?? 0} />
        <Stat label="People" value={people?.length ?? 0} />
      </div>

      <h2 className="mt-8 text-sm font-medium uppercase tracking-wide text-neutral-500">Sites</h2>
      <table className="mt-2 w-full border-collapse overflow-hidden rounded border border-neutral-200 text-sm">
        <thead className="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500">
          <tr><th className="px-4 py-2">Site</th><th className="px-4 py-2">Timezone</th></tr>
        </thead>
        <tbody className="divide-y divide-neutral-200">
          {(sites ?? []).map((s) => (
            <tr key={s.id}><td className="px-4 py-2">{s.name}</td><td className="px-4 py-2 text-neutral-500">{s.timezone}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
