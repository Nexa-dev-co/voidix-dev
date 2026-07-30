import type { Metadata } from 'next';
import { Syne, DM_Sans } from 'next/font/google';
import NavbarGate from '@/components/layout/Navbar/NavbarGate';
import './globals.css';

const syne = Syne({
  subsets: ['latin'],
  weight: ['700', '800'],
  variable: '--font-syne',
  display: 'swap',
});

const dmSans = DM_Sans({
  subsets: ['latin'],
  weight: ['300', '400', '500'],
  variable: '--font-dm-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'voidix — software with gravity',
  description:
    'A software studio building products with their own gravity. Custom web applications, SaaS platforms, enterprise CRM, mobile apps, and AI systems.',
  // TODO: confirm the real domain — this was left on the pre-rebrand `orbix.studio` and is a guess at
  // the voidix equivalent. It's the base every relative OG/canonical URL resolves against, so a wrong
  // host here silently breaks link previews.
  metadataBase: new URL('https://voidix.studio'),
  openGraph: {
    title: 'voidix — software with gravity',
    description:
      'Custom web applications, SaaS, CRM, mobile, and AI — engineered to hold users in orbit.',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable}`}>
      <body>
        {/* Gated, not rendered directly: the bar is a fixed full-width click target at z-9999, and on
            the authoring routes it is invisible and catches everything. See NavbarGate. */}
        <NavbarGate />
        {children}
      </body>
    </html>
  );
}
