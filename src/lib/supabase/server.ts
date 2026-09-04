import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from './database.types';

/**
 * Request-scoped client that carries the signed-in user, so every query runs
 * under that user's RLS policies. Cookie writes throw in Server Components
 * (only Server Actions and Route Handlers may set them); the proxy refreshes
 * sessions instead, so swallowing that specific failure is safe.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — the proxy handles refresh.
          }
        },
      },
    },
  );
}
