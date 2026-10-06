/**
 * Times on the platform admin pages. The platform has no site of its own and its jobs run on
 * Melbourne's clock (the expiry engine at 03:00), so its times are shown on that clock too.
 * Formatting with the server's default would show UTC on Vercel: last night's 03:00 run read
 * as 4:00 pm the day before.
 */

import { atSite } from '@/lib/deliveries/review';

export const PLATFORM_TIME_ZONE = 'Australia/Melbourne';

/** "06/10/2026, 3:00 am" on the platform's clock; the date alone when `withTime` is false. */
export function platformTime(iso: string, withTime = true): string {
  return atSite(iso, PLATFORM_TIME_ZONE, withTime);
}
