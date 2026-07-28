import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/** What `setAll` receives — @supabase/ssr doesn't export this shape, so it's spelled out here. */
type CookiesToSet = { name: string; value: string; options: CookieOptions }[];

/**
 * Refreshes the Supabase session on every request, and turns away anyone who isn't signed in.
 *
 * The redirect here is convenience, not security — it stops a signed-out person seeing an empty
 * shell. The actual protection is RLS: without a valid session Supabase returns nothing, so even a
 * page rendered past this middleware would have no data to show.
 *
 * `getUser()` rather than `getSession()`: getSession trusts whatever is in the cookie, while getUser
 * verifies it against the auth server. In middleware, which is the thing deciding who gets in, that
 * distinction matters.
 */

const PUBLIC_PATHS = ['/login'];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;

  // Misconfigured deploy: fail closed rather than letting everyone through.
  if (!url || !anonKey) {
    return NextResponse.json({ error: 'Supabase is not configured' }, { status: 503 });
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet: CookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublicPath = PUBLIC_PATHS.some((path) => pathname.startsWith(path));

  if (!user && !isPublicPath) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    // Remember where they were headed, so signing in doesn't dump them on the overview.
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (user && pathname === '/login') {
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = '/';
    homeUrl.search = '';
    return NextResponse.redirect(homeUrl);
  }

  return response;
}

export const config = {
  matcher: [
    // Everything except Next's own assets and static files — the session needs refreshing on any
    // request that renders, not just on protected pages.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
