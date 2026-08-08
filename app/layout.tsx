import type { Metadata, Viewport } from 'next';
import { Syne, DM_Sans } from 'next/font/google';
import Navbar from '@/components/layout/Navbar/Navbar';
import TelemetryConsole from '@/components/effects/TelemetryConsole/TelemetryConsole';
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

/**
 * ⚠ THIS IS THE FIX FOR THE CREAM BANDS ON iOS SAFARI, and the cause is not what it looks like.
 *
 * `body` is already `--bg` (#060606) and always has been, and with `html` carrying no background of
 * its own that black propagates to the canvas — so the overscroll gutter was never the problem. What
 * is beige is the BROWSER's own chrome: since iOS 15, Safari tints the address bar and the bottom
 * toolbar to match the page, and with no `theme-color` to go on it SAMPLES what is actually rendered
 * at the top and bottom of the viewport. The hero is `#e2dfd2` and, being pinned, fills the frame —
 * so Safari faithfully paints its chrome the hero's cream.
 *
 * Declaring the colour takes the decision away from the sampler: the chrome is the page black at every
 * scroll position, on every section, and the hero stays exactly the cream it is. Nothing on the page
 * changes — this only ever painted browser furniture.
 *
 * `colorScheme` matches the `color-scheme: dark` already on `html` in globals.css, so form controls and
 * the chrome's own icons agree with a dark bar.
 */
export const viewport: Viewport = {
  themeColor: '#060606',
  colorScheme: 'dark',
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
        {/* The Basis transcoder, for exactly Draco's reason. Every model's textures are KTX2 now, and
            `KTX2Loader` does not fetch this until the first transcode is asked for — i.e. after the
            .glb has fully landed — so without the preload the star's textures wait out another
            527 KB after the model itself is already in.

            ⚠ It did NOT ship with the loader wiring, deliberately: while every model still carried
            WebP this was 527 KB spent on every visitor to serve none of them. It earns its place in
            the same change that made the models KTX2, and it would have to come back out if they
            ever stopped being.

            The .wasm only. `basis_transcoder.js` is the small loader shim that three fetches
            alongside it; it is 58 KB and arrives in the same round trip. */}
        <link
          rel="preload"
          href="/basis/basis_transcoder.wasm"
          as="fetch"
          crossOrigin="anonymous"
        />
      </head>
      <body>
        {/* ⚠ This bar is on EVERY route, and two of them are ordinary scrolling documents now
            (`/about`, `/careers`). Three things follow, all handled rather than outstanding:
            · `.nav-root` is `pointer-events: none` with its controls taking their own clicks back —
              a fixed full-width transparent strip at z-9999 otherwise eats every click along the top
              of any page whose content scrolls under it (this file used to carry that as a warning).
            · Its entrance no longer waits on `REVEAL_EVENT` off the homepage; nothing there fires it.
            · The progress meters are homepage-only — the hero pin is their only writer.
            See `Navbar.tsx` and `useNavbarAnimation.ts`.

            ⚠ The preload tags above fire on every route, including the two that never load a model —
            about 2.1 MB of star, Draco and Basis spent for nothing on a document page. Known and
            accepted for now; `docs/about-careers-plan.md` §1e has the fix and why it was deferred. */}
        {/* Renders nothing. First in the body so the console capture installs before any scene can
            log — see TelemetryConsole. Inert in production. */}
        <TelemetryConsole />
        <Navbar />
        {children}
      </body>
    </html>
  );
}
