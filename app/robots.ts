import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/siteMetadata';

/**
 * `/robots.txt`.
 *
 * ── ⚠ `/lite` IS NOT DISALLOWED HERE, AND THAT IS THE POINT ─────────────────────────────────────
 * It carries `robots: { index: false, follow: true }` in its own metadata, and a `Disallow` would
 * BREAK that rather than reinforce it: a crawler that is not allowed to fetch the page never reads
 * the tag telling it not to index the page. Disallowed-but-linked URLs get indexed on the strength of
 * their inbound links, with no description, which is the exact outcome the `noindex` exists to
 * prevent. Allow the fetch; let the tag do its job.
 *
 * The API routes are disallowed because there is nothing there to read — two of them answer 405 to a
 * GET and the third wants a secret header. Not a security measure; `robots.txt` is a request, not a
 * control, and every one of those routes checks its own authorisation regardless.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: '/api/',
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
