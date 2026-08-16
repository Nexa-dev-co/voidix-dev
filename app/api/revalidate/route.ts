import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { CONTENT_CACHE_TAG } from '@/lib/cms/fetchPublishedContent';

/**
 * The admin panel's "I have published" ping.
 *
 * ⚠ THE FIRST AND ONLY SERVER ROUTE ON THIS SITE. Everything else here is a static document or a
 * client scene, so the conventions this file sets are the ones the contact and application
 * endpoints will follow when they land.
 *
 * ── What it does, and what it deliberately does not ─────────────────────────────────────────────
 * It drops the cached content release and stops. It does NOT accept content in the request body:
 * the panel's payload arrives from `GET /api/content` on the next render, which means this route
 * needs no validation, no trust in the body it was sent, and no way for a caller who guesses the
 * URL to put words on the site. The only power this endpoint grants is "make the site re-read the
 * panel", which is exactly the power the panel needs and nothing more.
 *
 * That is why the tag is invalidated rather than the paths: `revalidateTag` follows the data, so a
 * page wired to the panel later is covered by this route the day it is written, with nothing to
 * remember to add here. `revalidatePath('/about')` would have to grow a line per page and would
 * silently miss the one somebody forgot.
 *
 * ⚠ It FAILS CLOSED, matching the panel's own intake routes: with no `SITE_REVALIDATE_SECRET` set
 * it rejects everything. A half-configured endpoint should be shut, not open — and an open one
 * here is a free cache-buster for anyone who finds it.
 */
export const dynamic = 'force-dynamic';

const BEARER_PREFIX = 'Bearer ';

export async function POST(request: Request) {
  const configuredSecret = process.env.SITE_REVALIDATE_SECRET;

  if (!configuredSecret) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  const authorization = request.headers.get('authorization') ?? '';
  const providedSecret = authorization.startsWith(BEARER_PREFIX)
    ? authorization.slice(BEARER_PREFIX.length)
    : '';

  if (!isEqualInConstantTime(providedSecret, configuredSecret)) {
    return NextResponse.json({ error: 'Not authorised.' }, { status: 401 });
  }

  revalidateTag(CONTENT_CACHE_TAG);

  // The panel records this response against the release, so it is worth saying which tag went —
  // a publish that reports success while clearing nothing is the failure this line makes visible.
  return NextResponse.json({ ok: true, revalidated: CONTENT_CACHE_TAG });
}

/**
 * Constant-time comparison, so response timing cannot be used to guess the secret one character at
 * a time. Both sides are hashed to a fixed width first: `timingSafeEqual` throws on a length
 * mismatch, and catching that would leak the secret's length just as loudly.
 */
function isEqualInConstantTime(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();

  return timingSafeEqual(leftHash, rightHash);
}
