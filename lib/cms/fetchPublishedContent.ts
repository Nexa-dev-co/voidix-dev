import type { PublishedContent, PublishedRelease } from './publishedContent';

/**
 * Reads the newest published release from the admin panel.
 *
 * ⚠ SERVER ONLY, AND THE SECRET IS THE REASON. `VOIDIX_CMS_CONTENT_SECRET` has no `NEXT_PUBLIC_`
 * prefix, so it is `undefined` in a browser bundle — a client component that imported this would
 * not leak the key, it would simply stop fetching and fall back forever, which is the quieter and
 * more confusing failure. Call it from a Server Component or a route handler and pass the result
 * down as props, which is what `app/about/page.tsx` and `app/careers/page.tsx` do.
 *
 * ── ⚠ IT NEVER THROWS, AND THAT IS THE WHOLE DESIGN ─────────────────────────────────────────────
 * The panel being unreachable — unconfigured, down, mid-deploy, or simply not running on a
 * developer's laptop — must not take the site's own pages down with it. Every failure returns
 * `null` and every caller resolves that against the copy in this repo, so the worst outcome is a
 * page serving what it served before the panel existed. That also means `npm run build` works with
 * no environment at all, which is what keeps this repo cloneable.
 *
 * ── How it stays fresh ──────────────────────────────────────────────────────────────────────────
 * ISR, invalidated two ways. `CONTENT_CACHE_TAG` is the fast one: publishing pings
 * `/api/revalidate` on this site, which calls `revalidateTag` and the next visitor gets the new
 * copy within a request. `CONTENT_REVALIDATE_SECONDS` is the net under it, for the publish whose
 * ping was lost to a deploy or a network blip — without it a missed webhook would strand the site
 * on old copy until the next build, with nothing on either side reporting a problem.
 */

/** What `revalidateTag` in `app/api/revalidate/route.ts` invalidates. One tag, one release. */
export const CONTENT_CACHE_TAG = 'voidix-cms-content';

/**
 * The backstop revalidation, in seconds. Ten minutes: long enough that a busy site is not
 * re-fetching the panel on a timer, short enough that a lost publish ping is a coffee break rather
 * than something anyone has to notice and diagnose.
 *
 * ⚠ COPIED AS A LITERAL into every page that reads content — `app/about/page.tsx` and
 * `app/careers/page.tsx` both declare `export const revalidate = 600`. That duplication is
 * deliberate and the about page's header has the two reasons; change this number and change
 * theirs in the same edit.
 */
export const CONTENT_REVALIDATE_SECONDS = 600;

/**
 * How long to wait for the panel before giving up and serving this repo's copy.
 *
 * Deliberately short. This runs during a page render, so the visitor is waiting on it; a panel
 * that is slow enough to be worth this long is a panel that is effectively down, and the fallback
 * is a complete page rather than a degraded one.
 */
const REQUEST_TIMEOUT_MS = 8_000;

/**
 * Why a render has the payload it has.
 *
 * ⚠ `'nothing-published'` and `'rejected'` look identical from the page — both serve this repo's
 * copy — and they need completely different fixes. The first is somebody not having pressed
 * Publish; the second is usually the two secrets having drifted apart. Keeping them separate is the
 * whole reason this is an enum rather than a boolean.
 */
export type ReleaseOutcome =
  /** The panel answered with a release. */
  | 'panel'
  /** No `VOIDIX_CMS_URL` / `VOIDIX_CMS_CONTENT_SECRET` — a fresh clone, or a laptop with no panel. */
  | 'unconfigured'
  /** The panel is there and has never published. 404. */
  | 'nothing-published'
  /** Down, deploying, or too slow. */
  | 'unreachable'
  /** The panel refused us — almost always a 401 from mismatched secrets. */
  | 'rejected';

/**
 * One attempt at reading the panel, and what came of it.
 *
 * ⚠ The version and date are carried rather than discarded because they are the only way to tell
 * "the panel answered" from "the panel answered with what I published". A page rendering correct-
 * looking copy from release v3 when you just published v7 is invisible without this.
 */
export interface FetchedRelease {
  payload: PublishedContent | null;
  outcome: ReleaseOutcome;
  /** Both null unless `outcome` is `'panel'`. */
  version: number | null;
  publishedAt: string | null;
}

/** The shape every failure returns — one payload-less result, differing only in why. */
function noRelease(outcome: ReleaseOutcome): FetchedRelease {
  return { payload: null, outcome, version: null, publishedAt: null };
}

export async function fetchPublishedContent(): Promise<FetchedRelease> {
  const baseUrl = process.env.VOIDIX_CMS_URL;
  const secret = process.env.VOIDIX_CMS_CONTENT_SECRET;

  if (!baseUrl || !secret) {
    // Not an error — it is the state of every fresh clone and of any environment that has not
    // been pointed at a panel yet. Silent, because logging it once per render would drown the
    // console of anyone working on the 3D scenes.
    return noRelease('unconfigured');
  }

  try {
    const response = await fetch(`${trimTrailingSlash(baseUrl)}/api/content`, {
      headers: { 'x-voidix-secret': secret },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      next: { revalidate: CONTENT_REVALIDATE_SECONDS, tags: [CONTENT_CACHE_TAG] },
    });

    if (!response.ok) {
      // 404 is the ordinary "nothing published yet" answer and is not worth a warning; anything
      // else is a misconfiguration somebody needs to see. 401 in particular means the two secrets
      // have drifted apart, which is invisible from the page — it just serves old copy forever.
      if (response.status === 404) {
        return noRelease('nothing-published');
      }

      console.warn(`[cms] content request failed: ${response.status} ${response.statusText}`);
      return noRelease('rejected');
    }

    const release = (await response.json()) as Partial<PublishedRelease>;

    // Shape check rather than validation. The payload is written by one known producer, so the
    // question worth asking is "did I get a release at all" — a 200 carrying a login page or a
    // proxy's error document is the realistic failure here, not a malformed field.
    if (!release.payload || typeof release.payload !== 'object') {
      console.warn('[cms] content response carried no payload');
      return noRelease('rejected');
    }

    return {
      payload: release.payload as PublishedContent,
      outcome: 'panel',
      version: typeof release.version === 'number' ? release.version : null,
      publishedAt: typeof release.publishedAt === 'string' ? release.publishedAt : null,
    };
  } catch (error) {
    console.warn(
      `[cms] could not reach the content panel: ${
        error instanceof Error ? error.message : 'unknown error'
      }`,
    );
    return noRelease('unreachable');
  }
}

function trimTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}
