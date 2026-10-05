import 'server-only';
import { cookies } from 'next/headers';
import { THEME_COOKIE, themeAttribute, type ThemeChoice } from './theme';

/** The stored choice for this request; no cookie means the device decides. */
export async function currentTheme(): Promise<ThemeChoice> {
  const store = await cookies();
  return themeAttribute(store.get(THEME_COOKIE)?.value) ?? 'system';
}
