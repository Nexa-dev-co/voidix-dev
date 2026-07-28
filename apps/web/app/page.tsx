import Hero from '@/components/sections/Hero/Hero';
import HeroSun from '@/components/sections/Hero/HeroSun';
import IntroSequence from '@/components/effects/IntroSequence/IntroSequence';
import FaqHologram from '@/components/sections/Chamber/FaqHologram/FaqHologram';
import ContentBoot from '@/components/providers/ContentBoot/ContentBoot';
import { fetchPublishedContent } from '@/lib/publishedContent';
import { hydrateContent } from '@voidix/content';

export default async function HomePage() {
  const publishedContent = await fetchPublishedContent();

  // Fill the SERVER's copy of the content arrays before rendering, so the HTML that ships is already
  // right. ContentBoot does the same for the browser's separate copy — both are needed, and neither
  // alone is enough (see ContentBoot for why).
  //
  // Mutating module state per request is only safe because published content is global: every visitor
  // gets the same payload, so concurrent requests can't disagree. Preview mode (step 6) serves a
  // per-request draft and must NOT reuse this path.
  if (publishedContent) hydrateContent(publishedContent);

  return (
    <ContentBoot payload={publishedContent}>
      <main>
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
      </main>
    </ContentBoot>
  );
}
