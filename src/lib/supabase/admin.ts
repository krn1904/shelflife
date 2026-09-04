import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { supabaseSecretKey, supabaseUrl } from './env';

/**
 * Service-role client. Bypasses RLS entirely, so it must never be reachable
 * from the browser — only seeds, scheduled jobs and admin-audited server code.
 */
export function createAdminClient() {
  return createClient<Database>(supabaseUrl(), supabaseSecretKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
