'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { requireRole } from '@/lib/auth/session';
import {
  validateReminderSettings,
  type ReminderSettings,
  type SettingsProblem,
} from '@/lib/expiry/engine';

export type ReminderSettingsFormState =
  | { status: 'idle' }
  | { status: 'saved' }
  | { status: 'error'; message: string; problems: SettingsProblem[] };

// Form field name → settings key. The form posts the database's column names.
const FIELDS: Record<string, keyof ReminderSettings> = {
  short_max_days: 'shortMaxDays',
  medium_max_days: 'mediumMaxDays',
  short_markdown_days: 'shortMarkdownDays',
  medium_markdown_days: 'mediumMarkdownDays',
  long_check_days: 'longCheckDays',
  long_markdown_days: 'longMarkdownDays',
};

/**
 * Saves one site's reminder settings. The app checks the numbers first so the manager
 * gets a plain message per field; the table's checks and RLS back that up.
 */
export async function saveReminderSettings(
  _prev: ReminderSettingsFormState,
  formData: FormData,
): Promise<ReminderSettingsFormState> {
  const session = await requireRole('manager');
  const site = session.sites.find((s) => s.id === formData.get('site_id'));
  if (!site) {
    return { status: 'error', message: 'That site is not one of yours.', problems: [] };
  }

  // Blank or non-numbers become NaN, which validation reports against the field.
  const settings = Object.fromEntries(
    Object.entries(FIELDS).map(([name, key]) => {
      const raw = String(formData.get(name) ?? '').trim();
      return [key, raw === '' ? Number.NaN : Number(raw)];
    }),
  ) as ReminderSettings;

  const problems = validateReminderSettings(settings);
  if (problems.length > 0) {
    return { status: 'error', message: 'Some numbers need another look.', problems };
  }

  const supabase = await createClient();
  const { error } = await supabase.from('reminder_settings').upsert({
    site_id: site.id,
    org_id: site.orgId,
    short_max_days: settings.shortMaxDays,
    medium_max_days: settings.mediumMaxDays,
    short_markdown_days: settings.shortMarkdownDays,
    medium_markdown_days: settings.mediumMarkdownDays,
    long_check_days: settings.longCheckDays,
    long_markdown_days: settings.longMarkdownDays,
    updated_by: session.userId,
  });

  if (error) {
    return { status: 'error', message: `Could not save the settings (${error.code ?? 'unknown'}).`, problems: [] };
  }

  revalidatePath('/manage/reminders');
  return { status: 'saved' };
}
