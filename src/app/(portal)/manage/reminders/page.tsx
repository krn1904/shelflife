import { activeSite, requireRole } from '@/lib/auth/session';
import { createClient } from '@/lib/supabase/server';
import { firstParam } from '@/lib/search-params';
import { settingsFromRow } from '@/lib/expiry/engine';
import { PageHeader } from '@/components/ui';
import { ReminderForm } from './reminder-form';

/** One site's reminder plan: which items count as short, medium or long-life, and when each is reminded. */
export default async function ReminderSettingsPage(props: PageProps<'/manage/reminders'>) {
  const session = await requireRole('manager');
  const params = await props.searchParams;
  const site = activeSite(session, firstParam(params.site));

  if (!site) {
    return <PageHeader title="Reminder settings" subtitle="No site assigned" />;
  }

  const supabase = await createClient();
  const { data: row } = await supabase
    .from('reminder_settings')
    .select('short_max_days, medium_max_days, short_markdown_days, medium_markdown_days, long_check_days, long_markdown_days')
    .eq('site_id', site.id)
    .maybeSingle();

  // Owners pick which of their sites to edit; a manager has just the one.
  const siteSites = session.sites.filter((s) => s.orgId === site.orgId);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reminder settings"
        subtitle={`When the Today list reminds staff about dated stock at ${site.name}`}
      />

      {siteSites.length > 1 && (
        <form className="card flex flex-wrap items-end gap-3 p-4 text-sm" action="/manage/reminders">
          <label className="space-y-1">
            <span className="block text-xs text-muted">Site</span>
            <select name="site" defaultValue={site.id} className="field w-auto">
              {siteSites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <button type="submit" className="btn btn-outline">Show</button>
        </form>
      )}

      {/* Keyed by site so switching sites resets the form to that site's numbers. */}
      <ReminderForm key={site.id} siteId={site.id} initial={settingsFromRow(row)} isDefault={!row} />
    </div>
  );
}
