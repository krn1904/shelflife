/**
 * Where a site is, as the admin picks it. Each choice is an IANA timezone, which sets the
 * site's calendar: "today", "expires in N days" and the nightly reminders all use it.
 *
 * By state or territory, because that is how a store owner knows it. Canberra shares
 * Sydney's time; Broken Hill (NSW, but on Adelaide time) is the one place this list
 * would get wrong, so it is listed on its own.
 */
export const SITE_TIMEZONES = [
  { value: 'Australia/Melbourne', label: 'Victoria (Melbourne)' },
  { value: 'Australia/Sydney', label: 'New South Wales / ACT (Sydney, Canberra)' },
  { value: 'Australia/Brisbane', label: 'Queensland (Brisbane)' },
  { value: 'Australia/Adelaide', label: 'South Australia (Adelaide)' },
  { value: 'Australia/Broken_Hill', label: 'Broken Hill (NSW, on Adelaide time)' },
  { value: 'Australia/Hobart', label: 'Tasmania (Hobart)' },
  { value: 'Australia/Darwin', label: 'Northern Territory (Darwin)' },
  { value: 'Australia/Perth', label: 'Western Australia (Perth)' },
] as const;

export type SiteTimezone = (typeof SITE_TIMEZONES)[number]['value'];

export const SITE_TIMEZONE_VALUES = SITE_TIMEZONES.map((t) => t.value) as [SiteTimezone, ...SiteTimezone[]];
