import { revalidateTag } from 'next/cache';

import { CONTENT_TAG } from '@/lib/publishedContent';

/**
 * Drops the cached content so the next request re-reads what's published.
 *
 * The admin panel calls this after a publish. Without it the site would keep serving its statically
 * generated page until the next deploy — the whole point of the database is that a copy change
 * doesn't need one.
 *
 * Authenticated with a shared secret rather than a Supabase session: the caller is another server,
 * not a logged-in person, and this endpoint does nothing but invalidate a cache. If the secret isn't
 * configured the route refuses everything, so a misconfigured deploy fails closed.
 */

const SECRET_HEADER = 'x-revalidate-secret';

export async function POST(request: Request): Promise<Response> {
  const expectedSecret = process.env.REVALIDATE_SECRET;

  if (!expectedSecret) {
    return Response.json({ revalidated: false, reason: 'not configured' }, { status: 503 });
  }
  if (request.headers.get(SECRET_HEADER) !== expectedSecret) {
    return Response.json({ revalidated: false, reason: 'bad secret' }, { status: 401 });
  }

  revalidateTag(CONTENT_TAG);

  return Response.json({ revalidated: true, tag: CONTENT_TAG, at: Date.now() });
}
