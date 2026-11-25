import { requireSession } from '@/lib/auth/session';
import { loadStaffMessages, type StaffMessage } from '@/lib/messages/data';
import { newRepliesLabel } from '@/lib/messages/messages';
import { PageHeader, SectionTitle } from '@/components/ui';
import { MessageCard } from '@/components/message-notices';
import { MarkThreadsSeen, ReplyList, type SeenThread } from '@/components/message-thread';
import { ReplyForm } from '@/components/reply-form';

/** Every recent message from the site's manager, with this person's private thread under each. */
export default async function StaffMessagesPage() {
  const session = await requireSession();
  const data = await loadStaffMessages(session);

  if (!data) return <PageHeader title="Messages" subtitle="You are not assigned to a site yet." />;

  const unread = data.messages.filter((message) => !message.read);
  const read = data.messages.filter((message) => message.read);
  const seen = threadsOnScreen(data.messages);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Messages"
        subtitle={`From your manager at ${data.site.name}. A reply stays between you and them.`}
      />
      <MarkThreadsSeen threads={seen} />

      {data.messages.length === 0 && (
        <p className="card px-4 py-6 text-center text-sm text-muted">No messages yet.</p>
      )}

      {unread.length > 0 && (
        <MessageGroup title="New" messages={unread} timeZone={data.site.timeZone} />
      )}

      {read.length > 0 && (
        <MessageGroup title="Earlier" messages={read} timeZone={data.site.timeZone} />
      )}
    </div>
  );
}

function threadsOnScreen(messages: StaffMessage[]): SeenThread[] {
  return messages.flatMap((message) => {
    const latest = message.thread[message.thread.length - 1];
    if (!latest) return [];
    return [{ messageId: message.id, staffId: latest.staffId, seenUpTo: latest.sentAt }];
  });
}

function MessageGroup({
  title,
  messages,
  timeZone,
}: {
  title: string;
  messages: StaffMessage[];
  timeZone: string;
}) {
  return (
    <div className="space-y-3">
      <SectionTitle>{title}</SectionTitle>
      {messages.map((message) => {
        const newIds = new Set(message.newReplies.map((reply) => reply.id));
        const label = newRepliesLabel(message.newReplies.length);
        return (
          <MessageCard key={message.id} message={message} timeZone={timeZone} read={message.read}>
            {label && <p className="mt-3 text-xs font-medium text-brand-text">{label}</p>}
            <ReplyList replies={message.thread} newIds={newIds} timeZone={timeZone} />
            <ReplyForm messageId={message.id} label="Reply to your manager" />
          </MessageCard>
        );
      })}
    </div>
  );
}
