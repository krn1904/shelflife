import Link from 'next/link';
import { acknowledgeMessage } from '@/lib/messages/actions';
import { formatSentAt } from '@/lib/messages/messages';
import type { SiteMessage } from '@/lib/messages/data';
import { SubmitButton } from '@/components/submit-button';

/** More than this and the rest wait on the Messages page, so the notes don't push the page off screen. */
const SHOWN = 2;

/** One message with its Got it button. Used at the top of every staff page and on the Messages page. */
export function MessageCard({ message, timeZone, read = false }: { message: SiteMessage; timeZone: string; read?: boolean }) {
  return (
    <div className={`card p-4 ${read ? '' : 'border-brand'}`}>
      <div className="text-xs text-muted">
        {message.sentBy ?? 'Your manager'} · {formatSentAt(message.sentAt, timeZone)}
      </div>
      <p className="mt-1 whitespace-pre-line text-sm">{message.body}</p>
      {!read && (
        <form action={acknowledgeMessage} className="mt-3">
          <input type="hidden" name="message_id" value={message.id} />
          <SubmitButton className="btn btn-primary btn-sm" pendingLabel="Saving…">
            Got it
          </SubmitButton>
        </form>
      )}
    </div>
  );
}

/**
 * Unread messages from the site's manager, at the top of every staff page until each one
 * is acknowledged. Inline rather than floating, so it never covers the reminder pop-up or
 * the bottom tabs. Server-rendered: no timers, no polling; a new message shows on the next
 * page load or when the app comes back to the foreground.
 */
export function MessageNotices({ unread, timeZone }: { unread: SiteMessage[]; timeZone: string }) {
  if (unread.length === 0) return null;
  // Oldest first, so a series of notes reads in the order they were written.
  const oldestFirst = [...unread].reverse();
  const more = unread.length - SHOWN;

  return (
    <section aria-label="Messages from your manager" className="mb-6 space-y-3">
      {oldestFirst.slice(0, SHOWN).map((m) => (
        <MessageCard key={m.id} message={m} timeZone={timeZone} />
      ))}
      {more > 0 && (
        <Link href="/app/messages" className="block text-sm text-brand-text">
          {more} more {more === 1 ? 'message' : 'messages'} →
        </Link>
      )}
    </section>
  );
}
