/**
 * The words on the 404.
 *
 * ⚠ REPO-OWNED, NOT CMS-EDITABLE, and not an oversight. The panel's payload is fetched per route on
 * ISR, and a not-found render is exactly the moment the site should depend on nothing: a URL that did
 * not resolve is sometimes a URL that did not resolve because something upstream is wrong. This page
 * has to say something sensible with the panel down.
 *
 * The voice is the site's — a claim, then the thing that backs it up. The claim is that the address is
 * empty; the backing is that the rest of the system is exactly where it was.
 */

export const NOT_FOUND_EYEBROW = 'Error 404 — Off the chart';

/** One sentence and no break in it — `text-wrap: balance` decides the lines at each width. */
export const NOT_FOUND_TITLE = 'Nothing orbits this address.';

export const NOT_FOUND_LEAD =
  'Either it was never charted, or whatever held it here has drifted out of range. The rest of the system is exactly where you left it.';

export const NOT_FOUND_COORDINATES_LABEL = 'Coordinates';
export const NOT_FOUND_COORDINATES_VERDICT = 'no body found';

export const NOT_FOUND_RETURN = { label: 'Return to the system', href: '/' } as const;

/** Where a lost visitor most plausibly meant to be — the document routes, which are real places. */
export const NOT_FOUND_DESTINATIONS = [
  { label: 'About', href: '/about' },
  { label: 'Careers', href: '/careers' },
  { label: 'Journal', href: '/blog' },
] as const;
