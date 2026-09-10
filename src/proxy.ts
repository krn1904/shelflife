import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { requirePublicEnv } from '@/lib/supabase/env';

/**
 * Refreshes the Supabase session on every request so Server Components always
 * see a valid token. Next 16 renamed Middleware to Proxy; behaviour is the same.
 *
 * Deliberately no authorization here — the docs are explicit that proxy is for
 * optimistic checks only. Real access control lives in RLS and in each route.
 */
export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });

  const { url, key } = requirePublicEnv();

  const supabase = createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
