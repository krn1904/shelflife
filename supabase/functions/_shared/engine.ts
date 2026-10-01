import { differenceInCalendarDays, parseISO } from 'date-fns';

/**
 * The expiry engine's decision logic, kept as plain functions with no database and no
 * Deno in sight. The scheduled Edge Function is a thin wrapper: it reads rows, calls
 * these, and writes the result. That is what makes the rules testable — the function
 * itself cannot be run here, but everything it decides can.
 */

export type ExpiryActionKind = 'check' | 'markdown' | 'pull';

export const ACTION_LABEL: Record<ExpiryActionKind, string> = {
  check: 'Check',
  markdown: 'Half price',
  pull: 'Last day',
};

/** Groups by shelf life on arrival: how long the batch had left the day it came in. */
export type ShelfLifeGroup = 'short' | 'medium' | 'long';

/** One site's reminder plan. Mirrors public.reminder_settings. */
export type ReminderSettings = {
  shortMaxDays: number;       // arrives with up to this many days → short-life
  mediumMaxDays: number;      // up to this many → medium-life; longer → long-life
  shortMarkdownDays: number;  // short-life: half price this many days before expiry
  mediumMarkdownDays: number; // medium-life: half price this many days before expiry
  longCheckDays: number;      // long-life: early check this many days before expiry
  longMarkdownDays: number;   // long-life: half price this many days before expiry
};

// A site with no saved settings uses these. Same defaults as the table's columns.
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  shortMaxDays: 21,
  mediumMaxDays: 90,
  shortMarkdownDays: 2,
  mediumMarkdownDays: 7,
  longCheckDays: 30,
  longMarkdownDays: 7,
};

/** Furthest ahead the default plan looks (the long-life early check). */
export const HORIZON_DAYS = DEFAULT_REMINDER_SETTINGS.longCheckDays;

export type ReminderSettingsRow = {
  short_max_days: number;
  medium_max_days: number;
  short_markdown_days: number;
  medium_markdown_days: number;
  long_check_days: number;
  long_markdown_days: number;
};

/** Database row → settings. No row means the site never changed them: defaults. */
export function settingsFromRow(row: ReminderSettingsRow | null | undefined): ReminderSettings {
  if (!row) return DEFAULT_REMINDER_SETTINGS;
  return {
    shortMaxDays: row.short_max_days,
    mediumMaxDays: row.medium_max_days,
    shortMarkdownDays: row.short_markdown_days,
    mediumMarkdownDays: row.medium_markdown_days,
    longCheckDays: row.long_check_days,
    longMarkdownDays: row.long_markdown_days,
  };
}

export type SettingsProblem = { field: keyof ReminderSettings; message: string };

/**
 * Settings that make sense, or what is wrong with them. Same rules as the table's
 * checks: no reminder may fire the day the shortest item in its group arrives.
 */
export function validateReminderSettings(s: ReminderSettings): SettingsProblem[] {
  const problems: SettingsProblem[] = [];
  const whole = (n: number) => Number.isInteger(n) && n >= 1;

  for (const [field, value] of Object.entries(s) as [keyof ReminderSettings, number][]) {
    if (!whole(value)) problems.push({ field, message: 'Must be a whole number of days, 1 or more.' });
  }
  if (problems.length > 0) return problems;

  if (s.shortMaxDays < 2) {
    problems.push({ field: 'shortMaxDays', message: 'Short-life needs to cover at least 2 days.' });
  }
  if (s.mediumMaxDays <= s.shortMaxDays) {
    problems.push({ field: 'mediumMaxDays', message: `Must be more than short-life (${s.shortMaxDays} days).` });
  }
  if (s.mediumMaxDays > 3650) {
    problems.push({ field: 'mediumMaxDays', message: 'Must be 3650 days (10 years) or less.' });
  }
  if (s.shortMarkdownDays >= s.shortMaxDays) {
    problems.push({
      field: 'shortMarkdownDays',
      message: `Must be less than ${s.shortMaxDays}, or a ${s.shortMaxDays}-day item goes half price the day it arrives.`,
    });
  }
  if (s.mediumMarkdownDays > s.shortMaxDays) {
    problems.push({
      field: 'mediumMarkdownDays',
      message: `Must be ${s.shortMaxDays} or less, or the shortest medium-life item goes half price the day it arrives.`,
    });
  }
  if (s.longCheckDays > s.mediumMaxDays) {
    problems.push({
      field: 'longCheckDays',
      message: `Must be ${s.mediumMaxDays} or less, or the shortest long-life item is checked the day it arrives.`,
    });
  }
  if (s.longMarkdownDays >= s.longCheckDays) {
    problems.push({ field: 'longMarkdownDays', message: `Must be less than the early check (${s.longCheckDays} days).` });
  }
  return problems;
}

/** The group a batch belongs to, fixed by its shelf life on the day it arrived. */
export function shelfLifeGroup(arrivedOn: string, expiryDate: string, settings: ReminderSettings): ShelfLifeGroup {
  const shelfLife = differenceInCalendarDays(parseISO(expiryDate), parseISO(arrivedOn));
  if (shelfLife <= settings.shortMaxDays) return 'short';
  if (shelfLife <= settings.mediumMaxDays) return 'medium';
  return 'long';
}

/** A group's reminders, earliest first, as days before expiry (0 = the expiry day). */
export function remindersFor(
  group: ShelfLifeGroup,
  settings: ReminderSettings,
): { action: ExpiryActionKind; daysBefore: number }[] {
  if (group === 'short') return [{ action: 'markdown', daysBefore: settings.shortMarkdownDays }, { action: 'pull', daysBefore: 0 }];
  if (group === 'medium') return [{ action: 'markdown', daysBefore: settings.mediumMarkdownDays }, { action: 'pull', daysBefore: 0 }];
  return [
    { action: 'check', daysBefore: settings.longCheckDays },
    { action: 'markdown', daysBefore: settings.longMarkdownDays },
    { action: 'pull', daysBefore: 0 },
  ];
}

/** A timestamp's calendar date in a time zone, e.g. a batch's arrival day in Melbourne. */
export function localDate(timestamp: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(timestamp));
}

export type BatchRow = {
  id: string;
  orgId: string;
  siteId: string;
  expiryDate: string | null;
  arrivedOn: string;     // the day it arrived (store's date)
  checked: boolean;      // long-life early check already answered
  markedDown: boolean;   // already on half price
};

export type PlannedAction = {
  batchId: string;
  orgId: string;
  siteId: string;
  action: ExpiryActionKind;
  dueDate: string;
  daysLeft: number;
};

/**
 * Today's reminder for each batch, at most one.
 *
 *   expiry day or past  → last day (pull or sold)
 *   within half price   → half price, unless already marked down
 *   long-life, within the early check → check, unless already checked
 *
 * A batch already marked down waits quietly for its last day. Settings come per site;
 * a site missing from the map uses the defaults. The unique index on open actions per
 * batch backs up the "at most one".
 */
export function planExpiryActions(
  batches: BatchRow[],
  today: string,
  settingsBySite: Map<string, ReminderSettings> = new Map(),
): PlannedAction[] {
  const asOf = parseISO(today);

  return batches.flatMap((batch) => {
    // No date was given at intake. Inventing one would put a made-up deadline in front of staff.
    if (!batch.expiryDate) return [];

    const settings = settingsBySite.get(batch.siteId) ?? DEFAULT_REMINDER_SETTINGS;
    const daysLeft = differenceInCalendarDays(parseISO(batch.expiryDate), asOf);
    const group = shelfLifeGroup(batch.arrivedOn, batch.expiryDate, settings);
    const markdownDays = {
      short: settings.shortMarkdownDays,
      medium: settings.mediumMarkdownDays,
      long: settings.longMarkdownDays,
    }[group];

    let action: ExpiryActionKind | null = null;
    if (daysLeft <= 0) action = 'pull';
    else if (batch.markedDown) action = null;
    else if (daysLeft <= markdownDays) action = 'markdown';
    else if (group === 'long' && !batch.checked && daysLeft <= settings.longCheckDays) action = 'check';

    if (!action) return [];
    return [{
      batchId: batch.id,
      orgId: batch.orgId,
      siteId: batch.siteId,
      action,
      dueDate: batch.expiryDate,
      daysLeft,
    }];
  });
}

export type FixtureRow = { orgId: string; siteId: string; fixture: string };

export type PlannedRotationCheck = {
  orgId: string;
  siteId: string;
  fixture: string;
  checkDate: string;
};

/**
 * One check per fixture per site per day. Rotation stock carries no dates, so the daily
 * tick-list is the whole mechanism for it — the point of the rotation mode is that staff
 * look at the fridge rather than scan every bottle in it.
 */
export function planRotationChecks(
  fixtures: FixtureRow[],
  today: string,
): PlannedRotationCheck[] {
  const seen = new Set<string>();
  const planned: PlannedRotationCheck[] = [];

  for (const row of fixtures) {
    const fixture = row.fixture.trim();
    if (fixture === '') continue; // unfixtured stock has no shelf to go and look at

    const key = `${row.siteId}::${fixture}`;
    if (seen.has(key)) continue;
    seen.add(key);

    planned.push({ orgId: row.orgId, siteId: row.siteId, fixture, checkDate: today });
  }

  return planned;
}

/** How the whole run reports itself into job_runs. */
export type JobResult = {
  ok: boolean;
  processed: number;
  skipped: number;
  reason: string | null;
};
