import type { Metadata } from 'next';
import Hero from '@/components/sections/Hero/Hero';
import HeroSun from '@/components/sections/Hero/HeroSun';
import IntroSequence from '@/components/effects/IntroSequence/IntroSequence';
import LoopVeil from '@/components/effects/LoopVeil/LoopVeil';
import SectionJumpVeil from '@/components/effects/SectionJumpVeil/SectionJumpVeil';
import FaqHologram from '@/components/sections/Chamber/FaqHologram/FaqHologram';
import { fetchPublishedContent } from '@/lib/cms/fetchPublishedContent';
import { reportContent } from '@/lib/cms/contentReport';
import { resolveFullContent } from '@/lib/cms/siteContent';
import SiteContentProvider from '@/lib/cms/SiteContentProvider';
import {
  buildFaqSchema,
  buildOrganizationSchema,
  serialiseSchema,
} from '@/lib/structuredData';

/**
 * ⚠ THIS LITERAL MUST STAY EQUAL TO `CONTENT_REVALIDATE_SECONDS`, and it cannot import it — the
 * segment export is read by static analysis at build time, so an imported constant resolves to
 * `undefined` and the page silently becomes "never revalidate". `app/about/page.tsx`'s header has the
 * second reason it cannot simply be omitted, which matters just as much here: a build that cannot
 * reach the panel would otherwise bake this page fully static, leaving nothing for `revalidateTag` to
 * invalidate and no timer to recover on. That build SUCCEEDS — it prints four `[cms]` warnings and
 * exits 0 — so the failure is invisible without this line.
 */
export const revalidate = 600;

/**
 * Title and description are inherited from the root layout — this page IS the site, so restating them
 * here would be two places to change one sentence. Only the canonical is this page's own.
 *
 * ⚠ It lives here rather than in the layout because a layout's canonical is inherited by every route
 * that does not set one, and `/lite` inherited it into a direct contradiction with its own `noindex`.
 */
export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

export default async function HomePage() {
  const release = await fetchPublishedContent();
  // Awaited: the projects' marks are dereferenced server-side here so the loader never has to fetch
  // them and the storage host never reaches the page. See `lib/cms/markSource.ts`.
  const content = await resolveFullContent(release.payload);

  const report = reportContent({ route: '/', release, scope: 'full' });

  return (
    <main>
      {/* ⚠ Built from `content`, not from the fallback constants — the schema must describe what this
          page actually renders. See lib/structuredData.ts. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serialiseSchema(buildOrganizationSchema()) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: serialiseSchema(buildFaqSchema(content.sections.faq)) }}
      />
      {/* ⚠ Resolved HERE, on the server, and passed down as a value — see siteContent.ts. The
          provider renders no DOM node of its own, so nothing in the pin's geometry changes.
          It wraps everything because `FaqHologram` is NOT a descendant of Hero — it sits out here
          for the transformed-pin reason below, and it is one of the seven consumers. */}
      <SiteContentProvider content={content} report={report}>
        {/* Hero owns the services fleet AND the works field as overlays — one pin fills the square,
            reveals the fleet, cycles the craft, then hands over to the works field and cycles the
            projects. One continuous scroll, no second pinned section. */}
        <Hero />
        {/* The single shared sun — flown by the intro, expanded by hero scroll */}
        <HeroSun />
        <IntroSequence />
        {/* The FAQ hologram, floating above the podium in the chamber. It sits OUT here rather than inside
            the hero on purpose: the hero is pinned, and ScrollTrigger's pin-spacer is transformed — a
            transformed ancestor stops `position: fixed` being fixed, and the panel would drift with the
            page. It anchors itself to the room by projection instead (see lib/hologramPose.ts). */}
        <FaqHologram />
        {/* The loop's cover. Out here for the same reason the hologram is: it must be `position: fixed`
            against the VIEWPORT, and the pin's spacer is transformed — a transformed ancestor stops fixed
            being fixed, which for a full-screen cover would mean it scrolls off exactly when needed. */}
        <LoopVeil />
        {/* The cover a long navbar jump travels behind. Out here for the same reason as the two above:
            it must be `position: fixed` against the VIEWPORT, and the pin's spacer is transformed. */}
        <SectionJumpVeil />
      </SiteContentProvider>
    </main>
  );
}
