import type { Metadata } from 'next';
import NotFoundPage from '@/components/pages/NotFound/NotFoundPage';

/**
 * Every unmatched URL, and every `notFound()` a route calls (the journal's unknown slugs among them).
 *
 * ⚠ No canonical and no `robots` here: Next already answers 404 with a `noindex` of its own, and a
 * canonical on a page that does not exist would be the page claiming an address.
 */
export const metadata: Metadata = {
  title: 'Off the chart — Voidix',
  description: 'Nothing orbits this address. The rest of the system is exactly where you left it.',
};

export default function NotFound() {
  return <NotFoundPage />;
}
