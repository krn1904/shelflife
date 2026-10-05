import type { AppRole } from '@/lib/supabase/types';

/**
 * Site messages: a manager writes a short note to everyone on staff at their site ("Fridge 3
 * is being serviced at 2, move the milk"), and each staff member taps Got it. One-way: the
 * manager sees who has read it, staff don't reply.
 *
 * Kept in the account, like the reminders, so a message follows the person to whichever
 * device they sign in on and a shared tablet shows each person their own unread ones.
 */

/** Same limit as the check on site_messages.body. Long enough for a shift note, short enough to read on a phone. */
export const MESSAGE_MAX_LENGTH = 500;

/** Who gets messages: staff work the floor. Managers send them; owners and admins neither. */
export function messagesShownTo(role: AppRole): boolean {
  return role === 'staff';
}

export type BodyCheck = { ok: true; body: string } | { ok: false; message: string };

export function validateMessageBody(raw: unknown): BodyCheck {
  const body = typeof raw === 'string' ? raw.trim() : '';
  if (body.length === 0) return { ok: false, message: 'Write a message first.' };
  if (body.length > MESSAGE_MAX_LENGTH) {
    return { ok: false, message: `Keep it to ${MESSAGE_MAX_LENGTH} characters (this is ${body.length}).` };
  }
  return { ok: true, body };
}

/** The messages this person hasn't tapped Got it on, in the order given. */
export function unreadMessages<M extends { id: string }>(messages: M[], readIds: Iterable<string>): M[] {
  const read = new Set(readIds);
  return messages.filter((m) => !read.has(m.id));
}

/**
 * A staff member sees only what was sent since they joined the site: someone starting a year
 * in shouldn't wade through a year of old notes. `joinedAt` is when their membership was created.
 */
export function sentSince(sentAt: string, joinedAt: string): boolean {
  return new Date(sentAt).getTime() >= new Date(joinedAt).getTime();
}

export type Recipient = { userId: string; name: string; joinedAt: string };

/** `total` counts those who were there when it was sent; `joinedLater` those who weren't. */
export type ReadSummary = { read: Recipient[]; waiting: Recipient[]; total: number; joinedLater: number };

/**
 * Who on staff has read a message and who hasn't, for the manager's list. Counts the site's
 * current staff who were there when it was sent: someone who joined later never sees it, so
 * they aren't "not yet", and a read by someone since removed from the site isn't counted.
 */
export function readSummary(staff: Recipient[], readerIds: Iterable<string>, sentAt: string): ReadSummary {
  const readers = new Set(readerIds);
  const audience = staff.filter((s) => sentSince(sentAt, s.joinedAt));
  const byName = (a: Recipient, b: Recipient) => a.name.localeCompare(b.name);
  return {
    read: audience.filter((s) => readers.has(s.userId)).sort(byName),
    waiting: audience.filter((s) => !readers.has(s.userId)).sort(byName),
    total: audience.length,
    joinedLater: staff.length - audience.length,
  };
}

/** "Read by 2 of 5"; when nobody was there to read it, says whether anyone has joined since. */
export function readCountLabel(summary: ReadSummary): string {
  if (summary.total === 0) {
    return summary.joinedLater > 0 ? 'Sent before current staff joined' : 'No staff at this site yet';
  }
  if (summary.read.length === summary.total) return summary.total === 1 ? 'Read' : `Read by all ${summary.total}`;
  return `Read by ${summary.read.length} of ${summary.total}`;
}

/**
 * When a message was sent, on the site's clock (a Perth store sees Perth time): "Today 9:05 am"
 * for today, otherwise "Mon 5 Oct, 9:05 am".
 */
export function formatSentAt(sentAt: string, timeZone: string, now: Date = new Date()): string {
  const at = new Date(sentAt);
  const day = new Intl.DateTimeFormat('en-AU', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
  const time = new Intl.DateTimeFormat('en-AU', { timeZone, hour: 'numeric', minute: '2-digit' }).format(at);
  if (day.format(at) === day.format(now)) return `Today ${time}`;
  const date = new Intl.DateTimeFormat('en-AU', { timeZone, weekday: 'short', day: 'numeric', month: 'short' })
    .format(at)
    .replace(',', ''); // en-AU writes "Mon, 5 Oct"
  return `${date}, ${time}`;
}
