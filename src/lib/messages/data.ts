import 'server-only';
import { cache } from 'react';
import { activeSite, type Session, type SessionSite } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { messagesShownTo, readSummary, unreadMessages, type ReadSummary, type Recipient } from './messages';

/** How many recent messages the lists show. Older ones are still in the table, just not listed. */
const LIST_LIMIT = 50;

export type SiteMessage = { id: string; body: string; sentAt: string; sentBy: string | null };

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Display names for a set of users; anyone without a name falls back to "Someone". */
async function namesFor(supabase: Supabase, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from('profiles').select('id, full_name').in('id', unique);
  return new Map((data ?? []).map((p) => [p.id, p.full_name ?? 'Someone']));
}

/** Newest first; with `since`, only what was sent from then on. */
async function recentMessages(supabase: Supabase, siteId: string, since?: string): Promise<SiteMessage[]> {
  let query = supabase
    .from('site_messages')
    .select('id, body, created_at, sent_by')
    .eq('site_id', siteId);
  if (since) query = query.gte('created_at', since);
  const { data: rows } = await query.order('created_at', { ascending: false }).limit(LIST_LIMIT);
  const names = await namesFor(supabase, (rows ?? []).flatMap((r) => (r.sent_by ? [r.sent_by] : [])));
  return (rows ?? []).map((r) => ({
    id: r.id,
    body: r.body,
    sentAt: r.created_at,
    sentBy: r.sent_by ? names.get(r.sent_by) ?? 'Someone' : null,
  }));
}

export type StaffMessages = { site: SessionSite; messages: (SiteMessage & { read: boolean })[]; unread: SiteMessage[] };

/**
 * A staff member's messages at their site, newest first, each marked read or not: only those
 * sent since they joined the site, so a new starter doesn't inherit a year of old notes. Null
 * for anyone who doesn't receive messages, before querying anything.
 */
export async function loadStaffMessages(session: Session): Promise<StaffMessages | null> {
  if (!messagesShownTo(session.primaryRole)) return null;
  const site = activeSite(session);
  if (!site) return null;
  const { messages, readIds } = await staffMessagesAt(session.userId, site.id, site.orgId);
  const read = new Set(readIds);
  return {
    site,
    messages: messages.map((m) => ({ ...m, read: read.has(m.id) })),
    unread: unreadMessages(messages, readIds),
  };
}

// Keyed on plain values so the shell and the page share one read per request.
const staffMessagesAt = cache(async (userId: string, siteId: string, orgId: string) => {
  const supabase = await createClient();
  // When they joined this site: their membership pinned to it, or (rarely) to every site.
  const { data: membership } = await supabase
    .from('memberships')
    .select('created_at')
    .eq('user_id', userId)
    .eq('org_id', orgId)
    .or(`site_id.eq.${siteId},site_id.is.null`)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!membership) return { messages: [] as SiteMessage[], readIds: [] as string[] };
  const messages = await recentMessages(supabase, siteId, membership.created_at);
  if (messages.length === 0) return { messages, readIds: [] as string[] };
  const { data: reads } = await supabase
    .from('site_message_reads')
    .select('message_id')
    .eq('user_id', userId)
    .in('message_id', messages.map((m) => m.id));
  return { messages, readIds: (reads ?? []).map((r) => r.message_id) };
});

export type SentMessage = SiteMessage & { reads: ReadSummary };

/** What a manager sent to a site, newest first, each with who on staff has read it. */
export async function loadSentMessages(site: SessionSite): Promise<SentMessage[]> {
  const supabase = await createClient();
  const [messages, { data: staffRows }] = await Promise.all([
    recentMessages(supabase, site.id),
    // The site's staff: pinned to it, or (rarely) to every site in the organisation.
    supabase
      .from('memberships')
      .select('user_id, created_at')
      .eq('org_id', site.orgId)
      .eq('role', 'staff')
      .or(`site_id.eq.${site.id},site_id.is.null`),
  ]);
  if (messages.length === 0) return [];

  // Earliest membership per person, in case they hold both a site and an organisation-wide one.
  const joined = new Map<string, string>();
  for (const m of staffRows ?? []) {
    const seen = joined.get(m.user_id);
    if (!seen || m.created_at < seen) joined.set(m.user_id, m.created_at);
  }
  const [names, { data: reads }] = await Promise.all([
    namesFor(supabase, [...joined.keys()]),
    supabase
      .from('site_message_reads')
      .select('message_id, user_id')
      .in('message_id', messages.map((m) => m.id)),
  ]);
  const staff: Recipient[] = [...joined].map(([id, joinedAt]) => ({ userId: id, name: names.get(id) ?? 'Someone', joinedAt }));

  return messages.map((m) => ({
    ...m,
    reads: readSummary(
      staff,
      (reads ?? []).filter((r) => r.message_id === m.id).map((r) => r.user_id),
      m.sentAt,
    ),
  }));
}
