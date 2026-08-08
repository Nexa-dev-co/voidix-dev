import type { Metadata } from 'next';
import CareersPage from '@/components/pages/Careers/CareersPage';

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

export default function Careers() {
  return <CareersPage />;
}
