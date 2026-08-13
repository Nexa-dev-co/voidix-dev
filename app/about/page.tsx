import type { Metadata } from 'next';
import AboutPage from '@/components/pages/About/AboutPage';
import { resolveAboutContent } from '@/components/pages/About/aboutContent';
import { fetchPublishedContent } from '@/lib/cms/fetchPublishedContent';
import { reportContent } from '@/lib/cms/contentReport';
import { resolveSharedContent } from '@/lib/cms/siteContent';
import SiteContentProvider from '@/lib/cms/SiteContentProvider';

/**
 * ⚠ THIS LITERAL MUST STAY EQUAL TO `CONTENT_REVALIDATE_SECONDS`, and it cannot import it: the
 * segment export is read by static analysis at build time, so an imported constant resolves to
 * `undefined` and the page silently becomes "never revalidate".
 *
 * ⚠ AND IT CANNOT BE OMITTED, which was the first attempt. Next does derive a route's revalidation
 * from the lowest across its fetches — but only from fetches that SUCCEEDED. Build the site while
 * the panel is unreachable (it is down, or it is a CI runner that cannot see it) and the fetch
 * throws, leaves no cache entry, and the route is baked fully static: no timer, and nothing for
 * `revalidateTag` to invalidate either. The page would then serve this repo's fallback copy until
 * somebody deployed again, with every publish reporting success. Declaring it here makes the page
 * ISR whether or not the panel answered during the build, so the first revalidation picks up the
 * connection the build never had.
 *
 * The timer is the backstop in any case, not the mechanism: publishing pings `/api/revalidate`,
 * which drops this page's cached copy within the request.
 */
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'About — Voidix',
  alternates: { canonical: '/about' },
  description:
    'A small engineering studio that builds the surface which has to be fast, legible and alive at the same time. How we work, what we hold ourselves to, and what we build it in.',
  openGraph: {
    title: 'About — Voidix',
    description:
      'Most software is weightless. We build the other kind — how a Voidix build actually runs.',
    type: 'website',
  },
};

export default async function About() {
  const release = await fetchPublishedContent();

  const report = reportContent({ route: '/about', release, scope: 'shared', pageKey: 'about' });

  // ⚠ Two resolves off ONE fetch. `about` is this page's own and arrives as a prop; the rest is the
  // shared vocabulary — the enquiry form's strings, the disciplines it seeds from, the footer — which
  // this page renders exactly as the homepage does. See `lib/cms/siteContent.ts`.
  return (
    <SiteContentProvider content={resolveSharedContent(release.payload)} report={report}>
      <AboutPage content={resolveAboutContent(release.payload?.about ?? null)} />
    </SiteContentProvider>
  );
}
