import { CONTENT_CACHE_TAG, CONTENT_REVALIDATE_SECONDS } from '@/lib/cms/fetchPublishedContent';
import type { PublishedProject } from '@/lib/cms/publishedContent';

/**
 * Turns each project's mark URL into the SVG source the works field will cut.
 *
 * ── ⚠ SERVER ONLY, AND THAT IS THE ENTIRE DESIGN ────────────────────────────────────────────────
 * The panel stores marks in a public Supabase bucket, so the obvious build has the loader fetch them
 * from `<project-ref>.supabase.co`. That would put the address of the studio's leads database into
 * the page of every visitor — the exact exposure `panelIntake.ts` proxies form submissions to avoid,
 * in its own words: *"the panel's URL never appears in the page, so the address of the studio's
 * leads database is not public knowledge."*
 *
 * So the dereference happens here, during ISR, and the page receives source text. Four things fall
 * out of that and every one of them is an improvement:
 *
 *   · the storage host appears nowhere in the HTML
 *   · CORS stops being a question, because no cross-origin request is made from a browser
 *   · the loader LOSES network round trips instead of gaining them — the marks are in hand at mount
 *   · the size cap is enforced before the bytes are ever part of a page
 *
 * ── ⚠ THE PREFIX LOCK IS NOT OPTIONAL ───────────────────────────────────────────────────────────
 * Fetching a URL that arrived over a network, from a server, is SSRF if that URL can be chosen by
 * someone else. The panel already closes this at the source — it never accepts a mark URL, it
 * *generates* one from the storage path it just wrote — but the payload still crosses a network to
 * get here, and "the other end validates it" is not a property this side can check. So this side
 * checks too, and refuses anything that is not under the one configured prefix.
 *
 * ⚠ It FAILS CLOSED. With `VOIDIX_MARK_URL_PREFIX` unset, nothing is fetched and every project
 * falls back to its initial. That is a visible, uniform, explainable state — unlike failing open,
 * which is an SSRF hole that looks like everything working.
 */

/**
 * Where a mark is allowed to come from — the panel's `markUrlPrefix()`, verbatim.
 *
 * Typically `https://<project-ref>.supabase.co/storage/v1/object/public/marks/`. It is a separate
 * value rather than something derived because this repo deliberately knows nothing else about the
 * panel's database: no Supabase client, no project ref, no connection string.
 */
const MARK_URL_PREFIX_VARIABLE = 'VOIDIX_MARK_URL_PREFIX';

/**
 * Mirrors the panel's `MARK_MAX_BYTES`.
 *
 * Repeated rather than shared, like every other value that crosses these two repos, and the reason
 * to keep it in step is not disk: every byte here is parsed and triangulated on the visitor's main
 * thread during the loading screen. This is a budget on their time.
 */
const MARK_MAX_BYTES = 256 * 1024;

/**
 * Deliberately shorter than the content fetch's 8 s. A release with no marks still renders the whole
 * site; a slow mark should cost that project its logo, not hold the page.
 */
const REQUEST_TIMEOUT_MS = 5_000;

/**
 * One source per project, in order, `null` where there is no usable mark.
 *
 * ⚠ Positional by contract — the caller zips this back onto the same array it passed in, so a
 * failure must produce a `null` slot and never a shorter list.
 */
export async function resolveMarkSources(
  projects: PublishedProject[],
): Promise<(string | null)[]> {
  const prefix = process.env[MARK_URL_PREFIX_VARIABLE];

  // Only worth saying when there is actually something to fetch: an unconfigured site with no panel
  // has no marks either, and warning on every render of a fresh clone is noise.
  const wantedMarks = projects.some((project) => project.markSvgUrl);

  if (!prefix) {
    if (wantedMarks) {
      console.warn(
        `[cms] ${MARK_URL_PREFIX_VARIABLE} is not set, so no project marks can be fetched — ` +
          'every project will grow its initial instead',
      );
    }
    return projects.map(() => null);
  }

  // Parallel: this runs once per revalidation window, but it runs while a visitor waits on the
  // render that triggered it, so four marks should cost one round trip and not four.
  return Promise.all(projects.map((project) => fetchMarkSource(project.markSvgUrl, prefix)));
}

async function fetchMarkSource(url: string | null, prefix: string): Promise<string | null> {
  if (!url) return null;

  if (!url.startsWith(prefix)) {
    console.warn(`[cms] refusing a mark URL outside ${MARK_URL_PREFIX_VARIABLE}: ${url}`);
    return null;
  }

  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      // Same tag as the release, so the panel's publish ping drops a replaced mark at the same
      // moment it drops the copy that describes it. Without the tag a new logo would sit behind the
      // backstop timer while the words beside it had already changed.
      next: { revalidate: CONTENT_REVALIDATE_SECONDS, tags: [CONTENT_CACHE_TAG] },
    });

    if (!response.ok) {
      console.warn(`[cms] mark fetch failed: ${response.status} ${response.statusText} — ${url}`);
      return null;
    }

    const source = await response.text();

    // Checked after reading rather than from `content-length`, which a proxy is free to omit and a
    // hostile origin is free to lie about.
    if (source.length > MARK_MAX_BYTES) {
      console.warn(`[cms] mark is over the ${MARK_MAX_BYTES} byte cap — ${url}`);
      return null;
    }

    // The cheapest possible sanity check, and it is here for the realistic failure: a 200 carrying
    // a storage provider's error document or an HTML login page rather than the file.
    if (!source.includes('<svg')) {
      console.warn(`[cms] mark response was not an SVG — ${url}`);
      return null;
    }

    return source;
  } catch (error) {
    console.warn(
      `[cms] could not fetch a mark: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
    return null;
  }
}
