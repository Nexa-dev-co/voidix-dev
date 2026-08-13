import type { MetadataRoute } from 'next';
import { SITE_URL, SITEMAP_ROUTES } from '@/lib/siteMetadata';

/**
 * `/sitemap.xml`.
 *
 * ⚠ `lastModified` is the BUILD's date, not the content's, and it is honest about being that. The
 * copy comes from the panel on ISR, so the site can be serving words published an hour ago from a
 * build that is a fortnight old — the two have no relationship any more. Reporting the release's
 * `publishedAt` would be more accurate but would mean fetching the panel to build the sitemap, and a
 * sitemap that 404s when the panel is down is worse than one carrying an approximate date. If this
 * ever needs to be exact, the fix is to read `publishedAt` and fall back to now.
 *
 * ⚠ Three routes, not four — `/lite` is deliberately absent. See `SITEMAP_ROUTES`.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const lastModified = new Date();

  return SITEMAP_ROUTES.map((route) => ({
    url: `${SITE_URL}${route.path}`,
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority,
  }));
}
