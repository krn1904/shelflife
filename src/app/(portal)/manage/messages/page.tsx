import { activeSite, requireRole } from '@/lib/auth/session';
import { firstParam } from '@/lib/search-params';
import { loadSentMessages } from '@/lib/messages/data';
import { deleteMessage } from '@/lib/messages/actions';
import { formatSentAt, newRepliesLabel, readCountLabel } from '@/lib/messages/messages';
import { PageHeader, SectionTitle } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { MarkThreadsSeen, ReplyList, type SeenThread } from '@/components/message-thread';
import { ReplyForm } from '@/components/reply-form';
import { MessageForm } from './message-form';

/** Send a note to a site's staff, and see who has read the ones already sent. */
export default async function ManagerMessagesPage(props: PageProps<'/manage/messages'>) {
  const session = await requireRole('manager');
  const params = await props.searchParams;
  const site = activeSite(session, firstParam(params.site));

  if (!site) return <PageHeader title="Messages" subtitle="No site assigned" />;

  const sent = await loadSentMessages(site, session.userId);
  // Owners pick which of their sites to write to; a manager has just the one.
  const siteSites = session.sites.filter((s) => s.orgId === site.orgId);
  const seen: SeenThread[] = sent.flatMap((message) => message.threads.flatMap((thread) => {
    const latest = thread.replies[thread.replies.length - 1];
    if (!latest) return [];
    return [{ messageId: message.id, staffId: thread.staffId, seenUpTo: latest.sentAt }];
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messages"
        subtitle={`Notes to staff at ${site.name}. Each person taps Got it, and replies stay in their own thread.`}
      />
      <MarkThreadsSeen threads={seen} />

      {siteSites.length > 1 && (
        <form className="card flex flex-wrap items-end gap-3 p-4 text-sm" action="/manage/messages">
          <label className="space-y-1">
            <span className="block text-xs text-muted">Site</span>
            <select name="site" defaultValue={site.id} className="field w-auto">
              {siteSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn-outline">Show</button>
        </form>
      )}

      {/* Keyed by site so switching sites starts a fresh message. */}
      <MessageForm key={site.id} siteId={site.id} siteName={site.name} />

      <div>
        <SectionTitle>Sent</SectionTitle>
        <ul className="space-y-3">
          {sent.map((m) => (
            <li key={m.id} className="card p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-muted">
                <span>{m.sentBy ?? 'Someone'} · {formatSentAt(m.sentAt, site.timeZone)}</span>
                <span className={m.reads.waiting.length === 0 && m.reads.total > 0 ? 'text-good' : ''}>
                  {readCountLabel(m.reads)}
                </span>
              </div>
              <p className="mt-1 whitespace-pre-line text-sm">{m.body}</p>
              {m.reads.total > 0 && (
                <dl className="mt-3 grid gap-1 text-xs sm:grid-cols-[auto_1fr] sm:gap-x-3">
                  {m.reads.read.length > 0 && (
                    <>
                      <dt className="text-muted">Read</dt>
                      <dd>{m.reads.read.map((r) => r.name).join(', ')}</dd>
                    </>
                  )}
                  {m.reads.waiting.length > 0 && (
                    <>
                      <dt className="text-muted">Not yet</dt>
                      <dd>{m.reads.waiting.map((r) => r.name).join(', ')}</dd>
                    </>
                  )}
                </dl>
              )}
              {m.threads.length > 0 ? (
                <div className="mt-3 space-y-3">
                  {m.threads.map((thread) => {
                    const label = newRepliesLabel(thread.newReplies);
                    const newIds = new Set(thread.unseen.map((reply) => reply.id));
                    return (
                      <div key={thread.staffId}>
                        <div className="text-xs text-muted">
                          Replies with {thread.staffName}
                          {label && <span className="ml-2 font-medium text-brand-text">{label}</span>}
                        </div>
                        <ReplyList replies={thread.replies} newIds={newIds} timeZone={site.timeZone} />
                        <ReplyForm messageId={m.id} staffId={thread.staffId} label={`Reply to ${thread.staffName}`} />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 text-xs text-muted">No replies yet.</p>
              )}
              <form action={deleteMessage} className="mt-3">
                <input type="hidden" name="message_id" value={m.id} />
                <SubmitButton className="btn btn-ghost btn-sm" pendingLabel="Deleting…">
                  Delete
                </SubmitButton>
              </form>
            </li>
          ))}
          {sent.length === 0 && (
            <li className="card px-4 py-6 text-center text-sm text-muted">Nothing sent yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}
