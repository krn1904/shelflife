'use client';

import { useActionState, useState } from 'react';
import {
  DEFAULT_REMINDER_SETTINGS,
  remindersFor,
  validateReminderSettings,
  type ReminderSettings,
  type ShelfLifeGroup,
} from '@/lib/expiry/engine';
import { CARD_TITLE } from '@/lib/expiry/today';
import { saveReminderSettings, type ReminderSettingsFormState } from '@/lib/expiry/reminder-settings';

type Field = { key: keyof ReminderSettings; name: string; label: string };

// Grouped as the manager thinks about it: first the groups, then each group's reminders.
const GROUP_FIELDS: Field[] = [
  { key: 'shortMaxDays', name: 'short_max_days', label: 'Short-life: arrives with up to … days' },
  { key: 'mediumMaxDays', name: 'medium_max_days', label: 'Medium-life: arrives with up to … days (longer is long-life)' },
];
const REMINDER_FIELDS: Field[] = [
  { key: 'shortMarkdownDays', name: 'short_markdown_days', label: 'Short-life: half price … days before expiry' },
  { key: 'mediumMarkdownDays', name: 'medium_markdown_days', label: 'Medium-life: half price … days before expiry' },
  { key: 'longCheckDays', name: 'long_check_days', label: 'Long-life: early check … days before expiry' },
  { key: 'longMarkdownDays', name: 'long_markdown_days', label: 'Long-life: half price … days before expiry' },
];

const GROUP_LABEL: Record<ShelfLifeGroup, string> = { short: 'Short-life', medium: 'Medium-life', long: 'Long-life' };

type Draft = Record<keyof ReminderSettings, string>;

const toDraft = (s: ReminderSettings): Draft =>
  Object.fromEntries(Object.entries(s).map(([k, v]) => [k, String(v)])) as Draft;
const fromDraft = (d: Draft): ReminderSettings =>
  Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v.trim() === '' ? Number.NaN : Number(v)])) as ReminderSettings;

/** "Half price 2 days before → Last day on the expiry day". */
function planText(group: ShelfLifeGroup, settings: ReminderSettings): string {
  return remindersFor(group, settings)
    .map((r) => (r.daysBefore === 0 ? `${CARD_TITLE[r.action]} on the expiry day` : `${CARD_TITLE[r.action]} ${r.daysBefore} days before`))
    .join(' → ');
}

/**
 * The settings form. Checks the numbers as they are typed and previews what each group
 * gets, so a manager sees the effect before saving. The server checks again on save.
 */
export function ReminderForm({ siteId, initial, isDefault }: { siteId: string; initial: ReminderSettings; isDefault: boolean }) {
  const [draft, setDraft] = useState<Draft>(toDraft(initial));
  const [state, formAction, pending] = useActionState<ReminderSettingsFormState, FormData>(
    saveReminderSettings,
    { status: 'idle' },
  );

  const settings = fromDraft(draft);
  const problems = validateReminderSettings(settings);
  const problemFor = (key: keyof ReminderSettings) => problems.find((p) => p.field === key)?.message;

  function field(f: Field) {
    const problem = problemFor(f.key);
    return (
      <label key={f.key} className="block space-y-1">
        <span className="block text-sm font-medium">{f.label}</span>
        <input
          name={f.name}
          type="number"
          inputMode="numeric"
          min={1}
          value={draft[f.key]}
          onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
          aria-invalid={problem ? true : undefined}
          className={`field w-28 ${problem ? 'border-critical' : ''}`}
        />
        {problem && <span className="block text-xs text-critical-ink">{problem}</span>}
      </label>
    );
  }

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="site_id" value={siteId} />

      <section className="card space-y-4 p-4">
        <div>
          <h2 className="font-semibold">Groups</h2>
          <p className="text-sm text-muted">
            Set once per batch from how long it had left the day it arrived, and never changed.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">{GROUP_FIELDS.map(field)}</div>
      </section>

      <section className="card space-y-4 p-4">
        <div>
          <h2 className="font-semibold">Reminders</h2>
          <p className="text-sm text-muted">Every group also gets a last-day reminder on the expiry day itself.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">{REMINDER_FIELDS.map(field)}</div>
      </section>

      {problems.length === 0 && (
        <section className="card p-4">
          <h2 className="font-semibold">What staff will see</h2>
          <ul className="mt-2 space-y-1.5 text-sm">
            {(['short', 'medium', 'long'] as const).map((g) => (
              <li key={g}>
                <span className="font-medium">{GROUP_LABEL[g]}</span>{' '}
                <span className="text-muted">
                  ({g === 'short' ? `up to ${settings.shortMaxDays}` : g === 'medium' ? `${settings.shortMaxDays + 1}–${settings.mediumMaxDays}` : `over ${settings.mediumMaxDays}`} days):
                </span>{' '}
                {planText(g, settings)}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={pending || problems.length > 0}>
          {pending ? 'Saving…' : 'Save settings'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setDraft(toDraft(DEFAULT_REMINDER_SETTINGS))}>
          Back to defaults
        </button>
        {state.status === 'saved' && <span role="status" className="text-sm text-good">Saved. Applies from tomorrow morning&apos;s list.</span>}
        {state.status === 'error' && <span role="alert" className="text-sm text-critical-ink">{state.message}</span>}
        {state.status === 'idle' && isDefault && <span className="text-sm text-muted">This site is using the defaults.</span>}
      </div>
    </form>
  );
}
