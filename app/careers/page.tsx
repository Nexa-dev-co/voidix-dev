import type { Metadata } from 'next';
import CareersPage from '@/components/pages/Careers/CareersPage';
import { resolveCareersContent } from '@/components/pages/Careers/careersContent';
import { fetchPublishedContent } from '@/lib/cms/fetchPublishedContent';

/**
 * ⚠ Must stay equal to `CONTENT_REVALIDATE_SECONDS`, and must not be removed or turned into an
 * import — `app/about/page.tsx` carries the two reasons why, both of which fail silently.
 */
export const revalidate = 600;

export const metadata: Metadata = {
  title: 'Careers — Voidix',
  description:
    'Open roles at a small engineering studio: WebGL, interaction design, platform. Short chain of command, work that ships with your name on the commit.',
  openGraph: {
    title: 'Careers — Voidix',
    description:
      'We hire the person who reads the shader. Open roles, and how hiring actually runs.',
    type: 'website',
  },
};

export default async function Careers() {
  const published = await fetchPublishedContent();

  return <CareersPage content={resolveCareersContent(published?.careers ?? null)} />;
}
