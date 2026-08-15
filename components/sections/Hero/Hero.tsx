'use client';

import { useRef, useState } from 'react';
import { useHeroAnimation } from '@/lib/hooks/useHeroAnimation';
import { useHeroInstruments } from '@/lib/hooks/useHeroInstruments';
import { useIsLowPowerViewport } from '@/lib/hooks/useIsLowPowerViewport';
import FluidCursor from '@/components/effects/FluidCursor/FluidCursor';
import ConstellationFrame from '@/components/effects/ConstellationFrame/ConstellationFrame';
import HeroInstruments from '@/components/sections/Hero/HeroInstruments/HeroInstruments';
import HeroScrollCue from '@/components/sections/Hero/HeroScrollCue';
import HeroReturnCue from '@/components/sections/Hero/HeroReturnCue';
import HeroMobileReadout from '@/components/sections/Hero/HeroMobileReadout';
import ServicesDeck from '@/components/sections/ServicesDeck/ServicesDeck';
import WorksField from '@/components/sections/WorksField/WorksField';
import ContactSection from '@/components/sections/Contact/ContactSection';
import { DECK_SERVICES } from '@/components/sections/ServicesDeck/deckServices';
import { WORKS_PROJECTS } from '@/components/sections/WorksField/worksProjects';

export default function Hero() {
  const heroSectionRef = useRef<HTMLElement>(null);
  const heroCardRef    = useRef<HTMLDivElement>(null);

  // The one hero pin runs the whole journey: it fills the square, reveals the fleet, cycles the
  // craft, then hands straight over to the works field and cycles the projects — no second pin. So
  // both active indices and both jump controls live here.
  const [activeCraft, setActiveCraft]     = useState(0);
  const [activeProject, setActiveProject] = useState(0);

  const { goToCraft, goToProject } = useHeroAnimation({
    sectionRef: heroSectionRef,
    heroCardRef,
    setActiveCraft,
    craftCount: DECK_SERVICES.length,
    setActiveProject,
    projectCount: WORKS_PROJECTS.length,
  });

  // Instrument HUD + the square's ring: entrance in lockstep with the headline, plus the live
  // ticking. Kept separate from the pin — it only reads --nav-progress-home for the ring fade.
  useHeroInstruments({ sectionRef: heroSectionRef });

  // Phones get neither the ink trail nor the telemetry HUD, and it's the MOUNT that's gated, not the
  // visibility. CSS already hid the HUD at this width — but hiding it left four rAF loops running
  // against a subtree nobody could see, which is the opposite of the point. Unmounting is the only
  // thing that actually stops the work. See useIsLowPowerViewport.
  const isLowPowerViewport = useIsLowPowerViewport();

  return (
    <section ref={heroSectionRef} className="hero-section">

      {/* Fluid ink trail — scoped to the hero. Its absolute canvases sit between the
          tagline (below, so the ink inverts it) and the headline/sun (above). Desktop only. */}
      {!isLowPowerViewport && <FluidCursor />}

      {/* Ambient constellation frame — graphite stars + faint links in a border band, blooming from
          the centre on reveal then drifting. Sits above the trail, below the headline (z 4). */}
      <ConstellationFrame />

      {/* Telemetry HUD flanking the headline (labels invert like the headline; values stay cyan).
          Desktop only — its live readouts are four rAF loops, and it's hidden at this width anyway. */}
      {!isLowPowerViewport && <HeroInstruments />}

      {/* The phone's slice of that panel, on exactly the frames the HUD above is missing from — ONE
          boolean, read both ways, so the two renderings of one instrument cannot both be on screen and
          cannot both be absent. (A CSS width gate would have managed the first and not the second: a
          landscape phone is 932px wide and coarse, so it loses the HUD to the line above while clearing
          any width query comfortably.) Static markup, so none of the rAF reasoning applies to it.
          Before `.hero-main` (which is `flex: 1`) so it sits at the top of the frame, under the navbar,
          exactly where the desktop's columns begin. */}
      {isLowPowerViewport && <HeroMobileReadout />}

      <div className="hero-main">
        <div
          className="hero-title-group"
          role="heading"
          aria-level={1}
          aria-label="we build worlds"
        >
          <p className="hero-line-top">
            <span className="hero-mask"><span className="hero-mask-inner">we build</span></span>
          </p>

          <div className="hero-line-bottom">
            <span className="hero-mask">
              <span className="hero-mask-inner hero-letter">W</span>
            </span>

            {/* Sun square + its neon frame. The slot wrapper only reserves the square's footprint in
                the flex row (shrink-to-fit, no transform) so the card stays the untransformed anchor
                HeroSun / useHeroAnimation measure. The frame is a sibling OUTSIDE the card (the card
                has overflow:hidden), hugging it just outside its edge. Outer frame opacity fades with
                the fill (--nav-progress-home); the inner frame animates in with the headline. */}
            <div className="hero-sun-slot">
              <div className="hero-sun-frame" aria-hidden="true">
                <div className="hero-sun-frame-inner" />
              </div>

              <div ref={heroCardRef} className="hero-sun-card" data-hero-card>
                <div className="hero-sun-fill" />
              </div>
            </div>

            <span className="hero-mask">
              <span className="hero-mask-inner hero-letter">rlds</span>
            </span>
          </div>
        </div>
      </div>

      {/* The way back into the site, for a visitor who has already fallen out of the bottom of it.
          Renders nothing until a loop has completed — see HeroReturnCue for why the hero's first
          impression stays free of it.
          ⚠ Directly after `.hero-main`, which is what puts it UNDER THE SUN: the main block is
          `flex: 1` and centres the headline, so the next flow child lands immediately beneath the
          square. It was absolutely positioned at the bottom of the frame and printed straight over
          the tagline. */}
      <HeroReturnCue />

      {/* Dark on the cream hero, and sits below the trail (z-index 1) so the ink
          inverts it to light — the tagline glows through the ink as the trail crosses it. */}
      <p className="hero-sub">software with its own gravity</p>

      {/* The scroll cue, below the tagline and only under 51.25em — above that the HUD's left column
          carries its own and this is display:none. Not gated in JS: it is static markup with one
          keyframe, so unlike the HUD there are no loops to stop. See HeroScrollCue. */}
      <HeroScrollCue />

      {/* Services fleet — an overlay inside the hero, revealed once the square fills the screen.
          It shares the hero's single pin (the fleet carousel is the pin's first set of stops). */}
      <ServicesDeck activeIndex={activeCraft} goTo={goToCraft} />

      {/* Works field — the next overlay in the SAME pin: after the last craft, the fleet fades out
          and the project-meteor field fades in on the same black, cycling as scroll continues. */}
      <WorksField activeIndex={activeProject} goTo={goToProject} />

      {/* Contact — the last stop in the same pin. The camera dives back into the chamber's display and
          lands in the space again, so this overlays the SAME works canvas; there is no new scene. */}
      <ContactSection />

    </section>
  );
}
