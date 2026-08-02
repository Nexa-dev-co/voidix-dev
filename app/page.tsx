import Hero from '@/components/sections/Hero/Hero';
import HeroSun from '@/components/sections/Hero/HeroSun';
import IntroSequence from '@/components/effects/IntroSequence/IntroSequence';
import LoopVeil from '@/components/effects/LoopVeil/LoopVeil';
import SectionJumpVeil from '@/components/effects/SectionJumpVeil/SectionJumpVeil';
import FaqHologram from '@/components/sections/Chamber/FaqHologram/FaqHologram';

export default function HomePage() {
  return (
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
      {/* The loop's cover. Out here for the same reason the hologram is: it must be `position: fixed`
          against the VIEWPORT, and the pin's spacer is transformed — a transformed ancestor stops fixed
          being fixed, which for a full-screen cover would mean it scrolls off exactly when needed. */}
      <LoopVeil />
      {/* The cover a long navbar jump travels behind. Out here for the same reason as the two above:
          it must be `position: fixed` against the VIEWPORT, and the pin's spacer is transformed. */}
      <SectionJumpVeil />
    </main>
  );
}
