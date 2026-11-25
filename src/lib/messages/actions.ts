'use server';

import { refresh } from 'next/cache';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { requireRole, requireSession, type Session } from '@/lib/auth/session';
import { validateMessageBody, validateReplyBody } from './messages';

export type SendMessageState =
  | { status: 'idle' }
  | { status: 'sent'; at: number }
  | { status: 'error'; message: string };

/**
 * Sends a message to everyone on staff at one site. The app checks the text first for a
 * plain message; RLS decides who may send where, and the table's check backs up the length.
 */
export async function sendMessage(_prev: SendMessageState, formData: FormData): Promise<SendMessageState> {
  const session = await requireRole('manager');
  const site = session.sites.find((s) => s.id === formData.get('site_id'));
  if (!site) return { status: 'error', message: 'That site is not one of yours.' };

  const check = validateMessageBody(formData.get('body'));
  if (!check.ok) return { status: 'error', message: check.message };

  const supabase = await createClient();
  const { error } = await supabase.from('site_messages').insert({
    org_id: site.orgId,
    site_id: site.id,
    body: check.body,
    sent_by: session.userId,
  });
  if (error) return { status: 'error', message: `Could not send the message (${error.code ?? 'unknown'}).` };

  refresh();
  // `at` makes each send a new state, so the form clears after every one, not just the first.
  return { status: 'sent', at: Date.now() };
}

/** Takes a message down; it disappears for staff who haven't read it yet. */
export async function deleteMessage(formData: FormData): Promise<void> {
  await requireRole('manager');
  const id = formData.get('message_id');
  if (typeof id !== 'string') return;
  const supabase = await createClient();
  await supabase.from('site_messages').delete().eq('id', id);
  refresh();
}

/**
 * Got it. Safe to send twice (a double tap, two tabs): the second insert hits the primary
 * key and is ignored, so no update permission is needed.
 */
export async function acknowledgeMessage(formData: FormData): Promise<void> {
  const session = await requireSession();
  const id = formData.get('message_id');
  if (typeof id !== 'string') return;
  const supabase = await createClient();
  await supabase
    .from('site_message_reads')
    .upsert({ message_id: id, user_id: session.userId }, { onConflict: 'message_id,user_id', ignoreDuplicates: true });
  refresh();
}

// Replies -------------------------------------------------------------------------------

export type SendReplyState =
  | { status: 'idle' }
  | { status: 'sent'; at: number }
  | { status: 'error'; message: string };

const uuid = z.string().uuid();
const timestamp = z.iso.datetime({ offset: true });

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Whose thread a reply or read is for. Staff only ever have their own, so a staff_id in the
 * form is ignored for them; a manager or owner names the staff member they're answering.
 */
function threadOwner(session: Session, formData: FormData): string | null {
  if (session.primaryRole === 'staff') return session.userId;
  const staffId = uuid.safeParse(String(formData.get('staff_id') ?? ''));
  return staffId.success ? staffId.data : null;
}

/**
 * Moves this reader's "last opened" for a thread on to `seenUpTo`, the newest reply they were
 * shown. Never moves it back, so an older tab can't make replies new again. RLS decides
 * whether they may read the thread at all.
 */
async function markReadUpTo(
  supabase: Supabase,
  thread: { messageId: string; staffId: string },
  readerId: string,
  seenUpTo: string,
): Promise<boolean> {
  const { data: existing } = await supabase
    .from('site_message_thread_reads')
    .select('last_read_at')
    .eq('message_id', thread.messageId)
    .eq('staff_id', thread.staffId)
    .eq('reader_id', readerId)
    .maybeSingle();

  const alreadyFurther = existing && new Date(existing.last_read_at).getTime() >= new Date(seenUpTo).getTime();
  if (alreadyFurther) return false;

  const { error } = await supabase.from('site_message_thread_reads').upsert(
    { message_id: thread.messageId, staff_id: thread.staffId, reader_id: readerId, last_read_at: seenUpTo },
    { onConflict: 'message_id,staff_id,reader_id' },
  );
  return !error;
}

/**
 * Replies in a thread under a site message: staff in their own, a manager or owner in any
 * thread at their site. The app checks the text and the ids; RLS decides who may write where.
 * Sending also marks the thread read for the sender, up to their own reply.
 */
export async function sendReply(_prev: SendReplyState, formData: FormData): Promise<SendReplyState> {
  const session = await requireSession();

  const messageId = uuid.safeParse(String(formData.get('message_id') ?? ''));
  if (!messageId.success) return { status: 'error', message: 'That message was not found.' };

  const staffId = threadOwner(session, formData);
  if (!staffId) return { status: 'error', message: 'Choose who you are answering.' };

  const check = validateReplyBody(formData.get('body'));
  if (!check.ok) return { status: 'error', message: check.message };

  const supabase = await createClient();
  const { data: message } = await supabase
    .from('site_messages')
    .select('id, org_id, site_id')
    .eq('id', messageId.data)
    .maybeSingle();
  if (!message) return { status: 'error', message: 'That message is no longer there.' };

  const { data: reply, error } = await supabase
    .from('site_message_replies')
    .insert({
      message_id: message.id,
      org_id: message.org_id,
      site_id: message.site_id,
      staff_id: staffId,
      author_id: session.userId,
      body: check.body,
    })
    .select('created_at')
    .single();
  if (error || !reply) return { status: 'error', message: `Could not send the reply (${error?.code ?? 'unknown'}).` };

  await markReadUpTo(supabase, { messageId: message.id, staffId }, session.userId, reply.created_at);

  refresh();
  // `at` makes each send a new state, so the form clears after every one, not just the first.
  return { status: 'sent', at: Date.now() };
}

/**
 * Opened a thread: what it showed is no longer new. `seen_up_to` is the newest reply on screen,
 * not the clock, so a reply that arrives while the page is open still shows as new.
 */
export async function markThreadRead(formData: FormData): Promise<void> {
  const session = await requireSession();
  const messageId = uuid.safeParse(String(formData.get('message_id') ?? ''));
  const seenUpTo = timestamp.safeParse(String(formData.get('seen_up_to') ?? ''));
  const staffId = threadOwner(session, formData);
  if (!messageId.success || !seenUpTo.success || !staffId) return;

  const supabase = await createClient();
  const moved = await markReadUpTo(supabase, { messageId: messageId.data, staffId }, session.userId, seenUpTo.data);
  // Opening the same thread again must not refresh, or the page that marks it seen would reload forever.
  if (moved) refresh();
}

const seenThread = z.object({
  messageId: uuid,
  staffId: uuid.nullable(),
  seenUpTo: timestamp,
});

/**
 * The threads on screen, marked seen in one go. Staff are always recorded against their own
 * thread. This does not refresh the page, so the replies stay marked new until the next visit.
 */
export async function markThreadsSeen(raw: unknown): Promise<void> {
  const session = await requireSession();
  const parsed = z.array(seenThread).max(500).safeParse(raw);
  if (!parsed.success || parsed.data.length === 0) return;

  const supabase = await createClient();
  for (const thread of parsed.data) {
    const staffId = session.primaryRole === 'staff' ? session.userId : thread.staffId;
    if (!staffId) continue;
    // No refresh: this page should keep showing what was new until the reader leaves it.
    // The next navigation reads the updated cursor.
    await markReadUpTo(
      supabase,
      { messageId: thread.messageId, staffId },
      session.userId,
      thread.seenUpTo,
    );
  }
}
