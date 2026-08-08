import type { Metadata } from 'next';
import AboutPage from '@/components/pages/About/AboutPage';

export const metadata: Metadata = {
  title: 'About — Voidix',
  description:
    'A small engineering studio that builds the surface which has to be fast, legible and alive at the same time. How we work, what we hold ourselves to, and what we build it in.',
  openGraph: {
    title: 'About — Voidix',
    description:
      'Most software is weightless. We build the other kind — how a Voidix build actually runs.',
    type: 'website',
  },
};

export default function About() {
  return <AboutPage />;
}
