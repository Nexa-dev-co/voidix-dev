import Hero from '@/components/sections/Hero/Hero';
import HeroSun from '@/components/sections/Hero/HeroSun';
import IntroSequence from '@/components/effects/IntroSequence/IntroSequence';
import ChamberTuner from '@/components/sections/Chamber/ChamberTuner';
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
      {/* On-screen controls for the chamber reveal — every number in it was authored without being
          able to see the scene. Renders nothing outside localhost / ?tune. */}
      <ChamberTuner />
    </main>
  );
}
