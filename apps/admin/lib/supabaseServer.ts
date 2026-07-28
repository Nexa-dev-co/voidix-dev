import 'server-only';

import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { SupabaseClient } from '@supabase/supabase-js';

/** What `setAll` receives — @supabase/ssr doesn't export this shape, so it's spelled out here. */
type CookiesToSet = { name: string; value: string; options: CookieOptions }[];

/**
 * The panel's Supabase client, carrying the signed-in staff member's session.
 *
 * ── Why there is no service-role key in this app ─────────────────────────────────────────────────
 * Staff sign in as real Supabase users, so their requests arrive as the `authenticated` role — which
 * the policies in supabase/migrations already grant full access to. The service-role key would add
 * nothing except the ability to bypass those policies, and a key that can read every lead is worth
 * not having in a web app at all. It lives only in the root .env.local, where the seed and verify
 * scripts use it.
 *
 * ── Why there is no browser client ───────────────────────────────────────────────────────────────
 * Every read is a Server Component and every write is a Server Action, so nothing here needs Supabase
 * in the browser. That's also why neither variable carries a NEXT_PUBLIC_ prefix.
 */
export function createSupabaseServerClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set for the admin panel.');
  }

  const cookieStore = cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet: CookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components can't set cookies. The middleware refreshes the session on every
          // request, so a read-only render losing a token rotation is harmless.
        }
      },
    },
  });
}
