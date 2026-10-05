'use server';

import { refresh } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireRole, requireSession } from '@/lib/auth/session';
import { validateMessageBody } from './messages';

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
