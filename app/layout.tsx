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
      <head>
        {/* ── Rung 1 of the download ladder: the star, and the decoder it cannot be read without ──
            See docs/loader-adaptive-plan.md §2.

            The hero opens ON the sun and the loader's finale is its ten shards, but nothing could
            even START fetching it until `SunModelCanvas`'s dynamic chunk had downloaded and mounted
            — by which time the deck's hook was already on the wire with 5.15 MB of vessels. These
            two lines move the star's first byte to the same moment as the HTML's.

            ⚠ `crossOrigin` is REQUIRED and is not about cross-origin. three's FileLoader fetches
            through `new Request(url, { credentials: 'same-origin' })` at the default `cors` mode; a
            preload matches only when its credentials mode agrees, and bare `crossorigin`
            (= anonymous) is the one that means `same-origin`. Drop it and the preload does not
            match — the browser downloads the model TWICE, which on the weak connection this exists
            to fix is worse than not preloading at all. */}
        <link
          rel="preload"
          href="/models/fractured_sun.glb"
          as="fetch"
          crossOrigin="anonymous"
        />
        {/* Draco is a SERIAL dependency, not a parallel cost: DRACOLoader does not fetch its decoder
            until the first decode is asked for, i.e. after the .glb has fully landed. Preloading it
            overlaps the two, so the star decodes the moment it arrives instead of waiting out
            another 245 KB. Total bytes are unchanged; only the order is.

            The WASM pair only. `draco_decoder.js` is the 500 KB pure-JS fallback for browsers with
            no WASM, and preloading it would spend half a megabyte on nearly every visitor to serve
            almost none of them. */}
        <link
          rel="preload"
          href="/draco/draco_wasm_wrapper.js"
          as="fetch"
          crossOrigin="anonymous"
        />
        <link
          rel="preload"
          href="/draco/draco_decoder.wasm"
          as="fetch"
          crossOrigin="anonymous"
        />
      </head>
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
