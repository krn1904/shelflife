import { requireSession } from '@/lib/auth/session';
import { loadStaffMessages } from '@/lib/messages/data';
import { PageHeader, SectionTitle } from '@/components/ui';
import { MessageCard } from '@/components/message-notices';

/** Every recent message from the site's manager: unread ones to acknowledge, then the rest. */
export default async function StaffMessagesPage() {
  const session = await requireSession();
  const data = await loadStaffMessages(session);

  if (!data) return <PageHeader title="Messages" subtitle="You are not assigned to a site yet." />;

  const unread = data.messages.filter((m) => !m.read);
  const read = data.messages.filter((m) => m.read);

  return (
    <div className="space-y-6">
      <PageHeader title="Messages" subtitle={`From your manager at ${data.site.name}`} />

      {data.messages.length === 0 && (
        <p className="card px-4 py-6 text-center text-sm text-muted">No messages yet.</p>
      )}

      {unread.length > 0 && (
        <div className="space-y-3">
          <SectionTitle>New</SectionTitle>
          {unread.map((m) => <MessageCard key={m.id} message={m} timeZone={data.site.timeZone} />)}
        </div>
      )}

      {read.length > 0 && (
        <div className="space-y-3">
          <SectionTitle>Earlier</SectionTitle>
          {read.map((m) => <MessageCard key={m.id} message={m} timeZone={data.site.timeZone} read />)}
        </div>
      )}
    </div>
  );
}
