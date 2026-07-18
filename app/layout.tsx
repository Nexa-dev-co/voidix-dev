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
  metadataBase: new URL('https://orbix.studio'),
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
        <Navbar />
        {children}
      </body>
    </html>
  );
}
