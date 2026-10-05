import Link from 'next/link';
import type { SiteReminders } from '@/lib/expiry/reminders-data';
import { ReminderToast } from '@/components/reminder-toast';

/**
 * The "what's due" strip at the top of the staff and manager home screens, plus the
 * once-a-day pop-up. Renders nothing when nothing is due, or for anyone who doesn't get
 * reminders (`reminders` is null).
 */
export function ReminderBanner({ reminders, href }: { reminders: SiteReminders | null; href: string }) {
  if (!reminders || reminders.summary.tone === null) return null;
  const { userId, site, today, summary } = reminders;

  return (
    <>
      <div
        role="status"
        className={`alert alert-${summary.tone} flex flex-wrap items-center justify-between gap-3`}
      >
        <div>
          <div className="font-semibold">{summary.title}</div>
          <div className="text-xs opacity-90">{summary.body}</div>
        </div>
        <Link href={href} className="btn btn-sm btn-outline">
          Open
        </Link>
      </div>
      <ReminderToast
        userId={userId}
        siteId={site.id}
        siteToday={today}
        total={summary.total}
        title={summary.title}
        href={href}
      />
    </>
  );
}
