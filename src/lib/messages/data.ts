import 'server-only';
import { cache } from 'react';
import { activeSite, type Session, type SessionSite } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import {
  groupThreads,
  messagesShownTo,
  readSummary,
  unreadMessages,
  unreadReplies,
  type ReadSummary,
  type Recipient,
  type Reply,
} from './messages';

/** How many recent messages the lists show. Older ones are still in the table, just not listed. */
const LIST_LIMIT = 50;

export type SiteMessage = { id: string; body: string; sentAt: string; sentBy: string | null };

/** A reply with its author's name, ready to show. */
export type ThreadReply = Reply & { author: string };

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Display names for a set of users; anyone without a name falls back to "Someone". */
async function namesFor(supabase: Supabase, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const { data } = await supabase.from('profiles').select('id, full_name').in('id', unique);
  return new Map((data ?? []).map((p) => [p.id, p.full_name ?? 'Someone']));
}

/**
 * Newest first; with `since`, only what was sent from then on. Cached per request, so the
 * manager's list and the Site home's reply count read the same messages once.
 */
const recentMessages = cache(async (siteId: string, since?: string): Promise<SiteMessage[]> => {
  const supabase = await createClient();
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
});

type RepliesQuery = { messageIds: string[]; staffId?: string };

/**
 * The replies on these messages that the signed-in person may see, oldest first. RLS already
 * limits staff to their own thread; `staffId` says so explicitly as well.
 */
async function repliesOn(supabase: Supabase, { messageIds, staffId }: RepliesQuery): Promise<(Reply & { messageId: string })[]> {
  if (messageIds.length === 0) return [];
  let query = supabase
    .from('site_message_replies')
    .select('id, message_id, staff_id, author_id, body, created_at')
    .in('message_id', messageIds);
  if (staffId) query = query.eq('staff_id', staffId);
  const { data: rows } = await query.order('created_at', { ascending: true });
  return (rows ?? []).map((r) => ({
    id: r.id,
    messageId: r.message_id,
    staffId: r.staff_id,
    authorId: r.author_id,
    body: r.body,
    sentAt: r.created_at,
  }));
}

function threadKey(messageId: string, staffId: string): string {
  return `${messageId}:${staffId}`;
}

/** When this reader last opened each thread on these messages, keyed by threadKey(). */
async function lastOpened(supabase: Supabase, readerId: string, messageIds: string[]): Promise<Map<string, string>> {
  if (messageIds.length === 0) return new Map();
  const { data: rows } = await supabase
    .from('site_message_thread_reads')
    .select('message_id, staff_id, last_read_at')
    .eq('reader_id', readerId)
    .in('message_id', messageIds);
  return new Map((rows ?? []).map((r) => [threadKey(r.message_id, r.staff_id), r.last_read_at]));
}

function withAuthor(reply: Reply, names: Map<string, string>): ThreadReply {
  const author = reply.authorId ? names.get(reply.authorId) ?? 'Someone' : 'Someone';
  return { ...reply, author };
}

// Staff ---------------------------------------------------------------------------------

export type StaffMessage = SiteMessage & {
  read: boolean;
  /** Their own thread under this message, oldest first: their replies and the manager's answers. */
  thread: ThreadReply[];
  /** Answers in that thread they haven't opened yet. */
  newReplies: ThreadReply[];
};

export type StaffMessages = {
  site: SessionSite;
  messages: StaffMessage[];
  unread: SiteMessage[];
  /** Messages whose thread has an answer they haven't seen, newest first. */
  answered: StaffMessage[];
};

/**
 * A staff member's messages at their site, newest first, each marked read or not, with their
 * own thread: only those sent since they joined the site, so a new starter doesn't inherit a
 * year of old notes. Null for anyone who doesn't receive messages, before querying anything.
 */
export async function loadStaffMessages(session: Session): Promise<StaffMessages | null> {
  if (!messagesShownTo(session.primaryRole)) return null;
  const site = activeSite(session);
  if (!site) return null;

  const { messages, readIds, replies, opened, names } = await staffMessagesAt(session.userId, site.id, site.orgId);
  const read = new Set(readIds);

  const withThreads: StaffMessage[] = messages.map((message) => {
    const thread = replies
      .filter((reply) => reply.messageId === message.id)
      .map((reply) => withAuthor(reply, names));
    const lastReadAt = opened.get(threadKey(message.id, session.userId)) ?? null;
    return {
      ...message,
      read: read.has(message.id),
      thread,
      newReplies: unreadReplies(thread, session.userId, lastReadAt),
    };
  });

  return {
    site,
    messages: withThreads,
    unread: unreadMessages(messages, readIds),
    answered: withThreads.filter((message) => message.newReplies.length > 0),
  };
}

// Keyed on plain values so the shell and the page share one read per request.
const staffMessagesAt = cache(async (userId: string, siteId: string, orgId: string) => {
  const supabase = await createClient();
  const nothing = {
    messages: [] as SiteMessage[],
    readIds: [] as string[],
    replies: [] as (Reply & { messageId: string })[],
    opened: new Map<string, string>(),
    names: new Map<string, string>(),
  };

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
  if (!membership) return nothing;

  const messages = await recentMessages(siteId, membership.created_at);
  if (messages.length === 0) return nothing;

  const messageIds = messages.map((m) => m.id);
  const [{ data: reads }, replies, opened] = await Promise.all([
    supabase.from('site_message_reads').select('message_id').eq('user_id', userId).in('message_id', messageIds),
    repliesOn(supabase, { messageIds, staffId: userId }),
    lastOpened(supabase, userId, messageIds),
  ]);
  const names = await namesFor(supabase, replies.flatMap((r) => (r.authorId ? [r.authorId] : [])));

  return { messages, readIds: (reads ?? []).map((r) => r.message_id), replies, opened, names };
});

// Managers and owners ------------------------------------------------------------------

export type SentThread = {
  staffId: string;
  staffName: string;
  /** Oldest first: the staff member's replies and the answers to them. */
  replies: ThreadReply[];
  /** How many of those this manager hasn't seen. */
  newReplies: number;
};

export type SentMessage = SiteMessage & {
  reads: ReadSummary;
  /** One per staff member who replied, the latest conversation first. */
  threads: SentThread[];
  /** New replies across all of this message's threads. */
  newReplies: number;
};

/** Every thread under the site's recent messages, as this manager sees them. */
const managerThreadsAt = cache(async (siteId: string, readerId: string) => {
  const supabase = await createClient();
  const messageIds = (await recentMessages(siteId)).map((m) => m.id);
  const [replies, opened] = await Promise.all([
    repliesOn(supabase, { messageIds }),
    lastOpened(supabase, readerId, messageIds),
  ]);
  const people = replies.flatMap((r) => (r.authorId ? [r.authorId, r.staffId] : [r.staffId]));
  const names = await namesFor(supabase, people);

  const threadsByMessage = new Map<string, SentThread[]>();
  for (const messageId of messageIds) {
    const messageReplies = replies
      .filter((reply) => reply.messageId === messageId)
      .map((reply) => withAuthor(reply, names));
    const threads = groupThreads(messageReplies).map((thread) => {
      const lastReadAt = opened.get(threadKey(messageId, thread.staffId)) ?? null;
      return {
        staffId: thread.staffId,
        staffName: names.get(thread.staffId) ?? 'Someone',
        replies: thread.replies,
        newReplies: unreadReplies(thread.replies, readerId, lastReadAt).length,
      };
    });
    threadsByMessage.set(messageId, threads);
  }
  return threadsByMessage;
});

function totalNew(threads: SentThread[]): number {
  return threads.reduce((sum, thread) => sum + thread.newReplies, 0);
}

/**
 * What a manager sent to a site, newest first, each with who on staff has read it and the
 * private threads under it. `readerId` is the manager or owner looking, for what's new to them.
 */
export async function loadSentMessages(site: SessionSite, readerId: string): Promise<SentMessage[]> {
  const supabase = await createClient();
  const [messages, { data: staffRows }, threadsByMessage] = await Promise.all([
    recentMessages(site.id),
    // The site's staff: pinned to it, or (rarely) to every site in the organisation.
    supabase
      .from('memberships')
      .select('user_id, created_at')
      .eq('org_id', site.orgId)
      .eq('role', 'staff')
      .or(`site_id.eq.${site.id},site_id.is.null`),
    managerThreadsAt(site.id, readerId),
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

  return messages.map((m) => {
    const threads = threadsByMessage.get(m.id) ?? [];
    return {
      ...m,
      reads: readSummary(
        staff,
        (reads ?? []).filter((r) => r.message_id === m.id).map((r) => r.user_id),
        m.sentAt,
      ),
      threads,
      newReplies: totalNew(threads),
    };
  });
}

/**
 * New replies for this manager across the site's recent messages, for the Site home. The
 * same threads as the Messages page, so the two always agree.
 */
export async function loadUnreadReplyCount(site: SessionSite, readerId: string): Promise<number> {
  const threadsByMessage = await managerThreadsAt(site.id, readerId);
  let count = 0;
  for (const threads of threadsByMessage.values()) count += totalNew(threads);
  return count;
}
