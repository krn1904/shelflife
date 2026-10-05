import { activeSite, requireRole } from '@/lib/auth/session';
import { firstParam } from '@/lib/search-params';
import { loadSentMessages } from '@/lib/messages/data';
import { deleteMessage } from '@/lib/messages/actions';
import { formatSentAt, readCountLabel } from '@/lib/messages/messages';
import { PageHeader, SectionTitle } from '@/components/ui';
import { SubmitButton } from '@/components/submit-button';
import { MessageForm } from './message-form';

/** Send a note to a site's staff, and see who has read the ones already sent. */
export default async function ManagerMessagesPage(props: PageProps<'/manage/messages'>) {
  const session = await requireRole('manager');
  const params = await props.searchParams;
  const site = activeSite(session, firstParam(params.site));

  if (!site) return <PageHeader title="Messages" subtitle="No site assigned" />;

  const sent = await loadSentMessages(site);
  // Owners pick which of their sites to write to; a manager has just the one.
  const siteSites = session.sites.filter((s) => s.orgId === site.orgId);

  return (
    <div className="space-y-6">
      <PageHeader title="Messages" subtitle={`Notes to staff at ${site.name}. Each person taps Got it once they've read it.`} />

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
