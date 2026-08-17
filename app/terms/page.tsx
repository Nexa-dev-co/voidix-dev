import type { Metadata } from 'next';
import LegalPage from '@/components/pages/Legal/LegalPage';
import { TERMS_DOCUMENT } from '@/components/pages/Legal/termsContent';
import { fetchPublishedContent } from '@/lib/cms/fetchPublishedContent';
import { reportContent } from '@/lib/cms/contentReport';
import { resolveSharedContent } from '@/lib/cms/siteContent';
import SiteContentProvider from '@/lib/cms/SiteContentProvider';

/**
 * ⚠ Same literal and the same two reasons as `app/about/page.tsx`, and the same footer-only fetch as
 * `app/privacy/page.tsx` — see that file's header for both.
 */
export const revalidate = 600;

/** ⚠ Repo-owned, not CMS-editable. `app/privacy/page.tsx` carries the reasoning; it applies here too. */
export const metadata: Metadata = {
  title: 'Terms — Voidix',
  alternates: { canonical: '/terms' },
  description:
    'The terms of using this site. A portfolio rather than a product — what belongs to the studio, what stays yours when you send it, and the third-party work this site is built out of.',
  openGraph: {
    title: 'Terms — Voidix',
    description: 'Short, because this is a portfolio. Mostly about who owns what.',
    type: 'website',
  },
};

export default async function Terms() {
  const release = await fetchPublishedContent();

  const report = reportContent({ route: '/terms', release, scope: 'shared' });

  return (
    <SiteContentProvider content={resolveSharedContent(release.payload)} report={report}>
      <LegalPage document={TERMS_DOCUMENT} />
    </SiteContentProvider>
  );
}
