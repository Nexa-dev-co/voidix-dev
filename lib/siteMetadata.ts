/**
 * The site's own identity, for everything a search engine reads.
 *
 * One file because these three facts are read by five places that must not disagree: the root
 * layout's `metadataBase`, every route's canonical, `app/sitemap.ts`, `app/robots.ts`, and the
 * JSON-LD. A sitemap listing one host while the canonicals name another is the kind of mismatch that
 * costs a site its indexing and reports nothing.
 */

/**
 * ⚠ THE PRODUCTION ORIGIN. No trailing slash — `new URL()` and the sitemap both append their own.
 *
 * Confirmed 2026-08-13 (it was a guess at `voidix.studio` before, carrying a TODO). Overridable by
 * environment so a preview deployment can declare its own origin rather than claiming to be
 * production — a Vercel preview that canonicalises to the live domain is asking the crawler to index
 * the live page's URL with the preview's content.
 *
 * ⚠ `NEXT_PUBLIC_` because `metadataBase` is evaluated where the metadata is built and the value has
 * to survive into the client bundle for any client-side consumer. It is a hostname, not a secret.
 */
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://voidix.tech';

/** How the studio is named in structured data. Lowercase in the wordmark, capitalised in prose. */
export const SITE_NAME = 'Voidix';

/**
 * Every route that should be in the sitemap, with how often each genuinely changes.
 *
 * ⚠ `/lite` is DELIBERATELY ABSENT and must stay absent. Every word on it also exists on `/`, which
 * is the textbook duplicate-content case — it carries `robots: { index: false }` in its own metadata
 * and listing it here would be the sitemap arguing with the page. It is a courtesy to a visitor
 * already here, not a second front door.
 *
 * ⚠ `changeFrequency` is a hint search engines are free to ignore, and `priority` is only ever
 * relative WITHIN one site — neither is a ranking lever. They are here because they cost nothing and
 * describe something true: the homepage is the site, and careers changes when hiring does.
 */
export const SITEMAP_ROUTES = [
  { path: '/', changeFrequency: 'monthly', priority: 1 },
  { path: '/about', changeFrequency: 'monthly', priority: 0.8 },
  { path: '/careers', changeFrequency: 'weekly', priority: 0.8 },
] as const;
