import type { Metadata } from 'next';
import LegalPage from '@/components/pages/Legal/LegalPage';
import { PRIVACY_DOCUMENT } from '@/components/pages/Legal/privacyContent';
import { fetchPublishedContent } from '@/lib/cms/fetchPublishedContent';
import { reportContent } from '@/lib/cms/contentReport';
import { resolveSharedContent } from '@/lib/cms/siteContent';
import SiteContentProvider from '@/lib/cms/SiteContentProvider';

/**
 * ⚠ Must stay equal to `CONTENT_REVALIDATE_SECONDS`, and must not be removed or turned into an
 * import — `app/about/page.tsx` carries the two reasons why, both of which fail silently.
 *
 * ⚠ AND THIS PAGE FETCHES AT ALL ONLY FOR ITS FOOTER. The notice itself is repo-owned and the panel
 * cannot reach a word of it — see the note below. But `PageShell` renders `PageFooter`, which reads
 * `SiteContent.footer` so that there is ONE list of links on this site rather than two that drift.
 * Resolving `null` here instead would have been one fetch cheaper and would have left the legal
 * pages' footers stuck on this repo's fallback the first time a real social handle was published.
 */
export const revalidate = 600;

/**
 * ⚠ THE NOTICE IS NOT CMS-EDITABLE, AND THAT IS DELIBERATE RATHER THAN UNFINISHED.
 *
 * Every other page's words come from the admin panel. These do not, for two reasons that both point
 * the same way. A privacy notice is a statement about what the CODE does — section 03 asserts there
 * is no analytics on this site — so it must change in the same commit and the same review as the
 * behaviour it describes, not from a text box in a marketing panel. And an editor who rewrote a
 * retention period or a rights clause would be altering a legal undertaking with no diff, no review
 * and nothing to catch it.
 *
 * If these ever do need to be editable, they need their own approval path, not `content_releases`.
 */
export const metadata: Metadata = {
  title: 'Privacy — Voidix',
  alternates: { canonical: '/privacy' },
  description:
    'What this site collects, which is almost nothing: no analytics, no cookies, no tracking. Only what you type into a form, who else handles it, and how to have it deleted.',
  openGraph: {
    title: 'Privacy — Voidix',
    description: 'No analytics, no cookies, no tracking. The specific version of that sentence.',
    type: 'website',
  },
};

export default async function Privacy() {
  const release = await fetchPublishedContent();

  const report = reportContent({ route: '/privacy', release, scope: 'shared' });

  return (
    <SiteContentProvider content={resolveSharedContent(release.payload)} report={report}>
      <LegalPage document={PRIVACY_DOCUMENT} />
    </SiteContentProvider>
  );
}
