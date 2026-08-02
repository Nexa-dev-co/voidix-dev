import type { Metadata } from 'next';
import { Syne, DM_Sans } from 'next/font/google';
import Navbar from '@/components/layout/Navbar/Navbar';
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
        {/* ⚠ `.nav-root` is fixed, full width, 4.5rem tall, at z-9999, and carries no
            `pointer-events: none` — a transparent box still hit-tests. That is harmless while the
            homepage is the only route, because the bar is really there and its own links want the
            clicks. Add a second route and it becomes an invisible strip eating every click across the
            top of it, which is exactly what used to happen on the lab pages. */}
        <Navbar />
        {children}
      </body>
    </html>
  );
}
