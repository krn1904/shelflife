import 'server-only';
import type { SessionSite } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { AppRole } from '@/lib/supabase/types';

export type SitePerson = { membershipId: string; userId: string; name: string; email: string; role: AppRole };

const ROLE_ORDER: Record<AppRole, number> = { manager: 0, staff: 1, owner: 2, platform_admin: 3 };

/**
 * The managers and staff pinned to one site, managers first, then by name.
 *
 * Memberships are read as the signed-in user, so RLS decides who can be listed; only those
 * ids are then looked up with the service key, for the email to show beside each name.
 */
export async function loadSitePeople(site: SessionSite): Promise<SitePerson[]> {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from('memberships')
    .select('id, user_id, role')
    .eq('org_id', site.orgId)
    .eq('site_id', site.id)
    .in('role', ['staff', 'manager']);
  if (!rows || rows.length === 0) return [];

  const ids = rows.map((r) => r.user_id);
  const admin = createAdminClient();
  const [{ data: profiles }, users] = await Promise.all([
    supabase.from('profiles').select('id, full_name').in('id', ids),
    Promise.all(ids.map((id) => admin.auth.admin.getUserById(id))),
  ]);
  const names = new Map((profiles ?? []).map((p) => [p.id, p.full_name]));
  const emails = new Map(users.flatMap(({ data }) => (data.user ? [[data.user.id, data.user.email ?? '']] : [])));

  return rows
    .map((r) => ({
      membershipId: r.id,
      userId: r.user_id,
      name: names.get(r.user_id) || emails.get(r.user_id) || 'Unnamed',
      email: emails.get(r.user_id) ?? '',
      role: r.role,
    }))
    .sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || a.name.localeCompare(b.name));
}
