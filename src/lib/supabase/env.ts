/**
 * Supabase renamed its client-side key from "anon" to "publishable" (and
 * service_role to "secret"). Both namings are accepted so a project created under
 * either dashboard generation works without editing code.
 *
 * The references below are written out in full rather than looked up dynamically:
 * Next only inlines NEXT_PUBLIC_* values it can see statically.
 */

export function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set');
  return url;
}

export function supabasePublishableKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) {
    throw new Error(
      'Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or the older NEXT_PUBLIC_SUPABASE_ANON_KEY)',
    );
  }
  return key;
}

/** Server-only. Bypasses RLS, so it must never reach the browser. */
export function supabaseSecretKey(): string {
  const key =
    process.env.SUPABASE_SECRET_KEY ??
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error('Set SUPABASE_SECRET_KEY (or the older SUPABASE_SERVICE_ROLE_KEY)');
  }
  return key;
}
