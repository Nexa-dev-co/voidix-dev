import type { Metadata } from 'next';
import LitePage from '@/components/pages/Lite/LitePage';

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

export default function Lite() {
  return <LitePage />;
}
