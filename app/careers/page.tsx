import type { Metadata } from 'next';
import CareersPage from '@/components/pages/Careers/CareersPage';
import { resolveCareersContent } from '@/components/pages/Careers/careersContent';
import { fetchPublishedContent } from '@/lib/cms/fetchPublishedContent';
import { reportContent } from '@/lib/cms/contentReport';
import { resolveSharedContent } from '@/lib/cms/siteContent';
import SiteContentProvider from '@/lib/cms/SiteContentProvider';

/**
 * ⚠ Must stay equal to `CONTENT_REVALIDATE_SECONDS`, and must not be removed or turned into an
 * import — `app/about/page.tsx` carries the two reasons why, both of which fail silently.
 */
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Careers — Voidix',
  alternates: { canonical: '/careers' },
  description:
    'Careers at Voidix. We design and build websites, apps, business systems, and AI products with real ownership from concept to launch.',
  openGraph: {
    title: 'Careers — Voidix',
    description:
      'Build custom software. Own the result. Open roles, culture, and how hiring runs at Voidix.',
    type: 'website',
  },
};

export default async function Careers() {
  const release = await fetchPublishedContent();

  const report = reportContent({
    route: '/careers',
    release,
    scope: 'shared',
    pageKey: 'careers',
  });

  // ⚠ Two resolves off ONE fetch — see `app/about/page.tsx` for the reasoning; identical here.
  return (
    <SiteContentProvider content={resolveSharedContent(release.payload)} report={report}>
      <CareersPage content={resolveCareersContent(release.payload?.careers ?? null)} />
    </SiteContentProvider>
  );
}
