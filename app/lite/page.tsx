import type { Metadata } from 'next';
import LitePage from '@/components/pages/Lite/LitePage';
import { fetchPublishedContent } from '@/lib/cms/fetchPublishedContent';
import { resolveFullContent } from '@/lib/cms/siteContent';
import SiteContentProvider from '@/lib/cms/SiteContentProvider';

/**
 * ⚠ Same literal, same two reasons as `app/about/page.tsx` — see its header.
 *
 * This page had no revalidation at all before it read the panel, because it had nothing to read. It
 * needs one now for a reason the other routes share but this one feels hardest: `/lite` exists for a
 * visitor who cannot load the homepage, so it is the last page that should be serving copy the rest
 * of the site has moved on from.
 */
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Voidix — the text version',
  description:
    'The same services, work and answers as the homepage, without the ten megabytes of WebGL. For a connection that will not carry the full site.',
  /**
   * ⚠ Deliberately out of the index. Every word on this page also exists on `/`, and two URLs serving
   * the same copy is the textbook duplicate-content case — a search engine would have to pick one, and
   * it might well pick the one without the site on it. This page is a courtesy to a visitor already
   * here, not a second front door.
   */
  robots: { index: false, follow: true },
  openGraph: {
    title: 'Voidix — the text version',
    description: 'The whole studio, in text. No download, no wait.',
    type: 'website',
  },
};

export default async function Lite() {
  const published = await fetchPublishedContent();

  // ⚠ This page has no content of its own beyond its masthead — it re-presents the site's services,
  // work and answers as a document. So it reads exactly what the homepage reads, and `liteContent.ts`
  // stays the only file here with words in it.
  return (
    <SiteContentProvider content={resolveFullContent(published)}>
      <LitePage />
    </SiteContentProvider>
  );
}
