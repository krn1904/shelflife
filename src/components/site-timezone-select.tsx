import { SITE_TIMEZONES } from '@/lib/sites/timezones';

/**
 * Required pick of where a site is. No default: a wrong zone shifts every date the site
 * sees by a day, so the admin has to choose it.
 */
export function SiteTimezoneSelect({ id, className = '' }: { id?: string; className?: string }) {
  return (
    <select id={id} name="timezone" required defaultValue="" className={`field ${className}`}>
      <option value="" disabled>Choose the site&apos;s state or territory…</option>
      {SITE_TIMEZONES.map((t) => (
        <option key={t.value} value={t.value}>{t.label}</option>
      ))}
    </select>
  );
}
