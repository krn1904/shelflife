import type { Session, SessionSite } from './session';

/**
 * Picks the site a page should act on. A staff member has exactly one; an owner
 * has several and chooses via ?site=. An unrecognised id falls back to the first
 * accessible site rather than erroring — the id may simply be stale.
 */
export function resolveSite(session: Session, requested?: string): SessionSite | null {
  if (session.sites.length === 0) return null;
  return session.sites.find((s) => s.id === requested) ?? session.sites[0];
}
