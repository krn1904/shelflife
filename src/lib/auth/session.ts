import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { AppRole } from '@/lib/supabase/types';

// Most-privileged first. Used to pick a landing portal when someone holds
// several memberships, and to answer "does this role clear that bar?".
const ROLE_RANK: Record<AppRole, number> = {
  platform_admin: 3,
  owner: 2,
  manager: 1,
  staff: 0,
};

export type SessionMembership = {
  orgId: string;
  orgName: string;
  orgSlug: string;
  siteId: string | null;
  role: AppRole;
};

export type SessionSite = { id: string; name: string; orgId: string };

export type Session = {
  userId: string;
  email: string;
  fullName: string | null;
  memberships: SessionMembership[];
  sites: SessionSite[];
  primaryRole: AppRole;
};

export function roleAtLeast(role: AppRole, bar: AppRole) {
  return ROLE_RANK[role] >= ROLE_RANK[bar];
}

export function homePathFor(role: AppRole) {
  switch (role) {
    case 'platform_admin': return '/admin';
    case 'owner': return '/owner';
    case 'manager': return '/manage';
    case 'staff': return '/app';
  }
}

/**
 * Resolves the signed-in user and everything the UI needs to scope itself.
 *
 * Uses getUser(), not getSession(): getSession() trusts whatever is in the
 * cookie, while getUser() revalidates against the auth server. Returns null
 * rather than throwing so callers can decide between redirect and render.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // RLS scopes memberships to the user's ORG, not to the user — a staff member can
  // legitimately see their colleagues' rows. So this must filter by user_id explicitly:
  // without it, primaryRole becomes the highest role held by ANYONE in the org, which
  // silently hands staff the owner and platform-admin portals.
  const [{ data: memberships }, { data: sites }, { data: profile }] = await Promise.all([
    supabase.from('memberships')
      .select('org_id, site_id, role, orgs(name, slug)')
      .eq('user_id', user.id),
    supabase.from('sites').select('id, name, org_id'),
    supabase.from('profiles').select('full_name').eq('id', user.id).maybeSingle(),
  ]);

  const rows: SessionMembership[] = (memberships ?? []).map((m) => ({
    orgId: m.org_id,
    orgName: m.orgs?.name ?? 'Unknown org',
    orgSlug: m.orgs?.slug ?? '',
    siteId: m.site_id,
    role: m.role,
  }));

  if (rows.length === 0) return null;

  const primaryRole = rows.reduce<AppRole>(
    (best, m) => (ROLE_RANK[m.role] > ROLE_RANK[best] ? m.role : best),
    rows[0].role,
  );

  return {
    userId: user.id,
    email: user.email ?? '',
    fullName: profile?.full_name ?? null,
    memberships: rows,
    sites: (sites ?? []).map((s) => ({ id: s.id, name: s.name, orgId: s.org_id })),
    primaryRole,
  };
}

/** Session or bounce to login. Use at the top of every authenticated route. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}

/**
 * Session gated on a minimum role. Someone with too low a role is sent to their
 * own portal rather than shown an error — they are not lost, just in the wrong place.
 */
export async function requireRole(bar: AppRole): Promise<Session> {
  const session = await requireSession();
  if (!roleAtLeast(session.primaryRole, bar)) redirect(homePathFor(session.primaryRole));
  return session;
}
