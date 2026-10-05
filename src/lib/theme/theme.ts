/**
 * The person's colour theme. Only an explicit choice is stored: with no cookie the app
 * follows the device's light/dark setting through CSS alone, so "System" needs no script.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_COOKIE = 'theme';

/** A year — the choice is a preference, not a session. */
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * What to write on <html data-theme>, or null to follow the device. Anything other than an
 * exact "light" or "dark" is ignored, so a hand-edited cookie cannot inject an attribute.
 */
export function themeAttribute(cookieValue: string | undefined | null): 'light' | 'dark' | null {
  return cookieValue === 'light' || cookieValue === 'dark' ? cookieValue : null;
}

/** The Set-Cookie string for a choice; "system" expires the cookie. */
export function themeCookie(choice: ThemeChoice): string {
  const maxAge = choice === 'system' ? 0 : THEME_COOKIE_MAX_AGE;
  const value = choice === 'system' ? '' : choice;
  return `${THEME_COOKIE}=${value}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}
