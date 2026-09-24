/**
 * Supabase credentials, under either of the two names Supabase has used.
 *
 * Projects created before the 2025 key rotation issue an "anon" key and a "service role"
 * key; newer ones issue a "publishable" key and a "secret" key. They are the same two
 * credentials, and a project set up from either era should just work rather than fail
 * with a null key on every request.
 *
 * Both names are written out literally on purpose: Next inlines `process.env.NEXT_PUBLIC_*`
 * into the client bundle by matching the source text, so a computed lookup would compile
 * to undefined in the browser however correct it looks here.
 */

// `||` rather than `??`: a variable that exists but is blank (easy to do when copying
// .env.example) must fall through to the other name instead of shadowing it.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';

export const SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  '';

/** Server-only. Bypasses RLS, so it must never reach a client bundle. */
export const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || '';

/**
 * Fails with the names to set rather than letting the Supabase client construct itself
 * around an empty string and throw something unrecognisable on the first request.
 */
export function requirePublicEnv(): { url: string; key: string } {
  if (!SUPABASE_URL) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL is not set.');
  }
  if (!SUPABASE_ANON_KEY) {
    throw new Error(
      'Set NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY on a newer project).',
    );
  }
  return { url: SUPABASE_URL, key: SUPABASE_ANON_KEY };
}

export function requireServiceKey(): string {
  if (!SUPABASE_SERVICE_KEY) {
    throw new Error(
      'Set SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY on a newer project).',
    );
  }
  return SUPABASE_SERVICE_KEY;
}
