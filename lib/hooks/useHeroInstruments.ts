import { useEffect, type RefObject } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { REVEAL_EVENT } from '@/components/effects/IntroSequence/introEvents';
import {
  ENERGY_MIN,
  ENERGY_MAX,
  FIELD_BASE,
  FIELD_JITTER,
  LIVE_TICK_MS,
} from '@/components/sections/Hero/HeroInstruments/heroReadouts';

// Drives the hero instrument HUD + the square's ring: entrance on REVEAL_EVENT (in lockstep with
// the headline, never on mount — Contract 2), plus the subtle live ticking that makes the readouts
// feel like a running system. The ring's *fade on scroll* is pure CSS off --nav-progress-home, so
// nothing here touches the pin. All decorative motion is gated behind reduced motion.

const ENTRANCE_DURATION = 0.8;
const ENTRANCE_STAGGER = 0.06;
const ENTER_OFFSET = 10; // px each column slides in from its own edge
const RING_DURATION = 0.9;
const REVEAL_FALLBACK_MS = 7000;

interface HeroInstrumentsRefs {
  sectionRef: RefObject<HTMLElement | null>;
}

export function useHeroInstruments({ sectionRef }: HeroInstrumentsRefs) {
  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    const leftItems = section.querySelectorAll('.hero-hud--left [data-hud-item]');
    const rightItems = section.querySelectorAll('.hero-hud--right [data-hud-item]');
    const ringInner = section.querySelector('.hero-sun-frame-inner');
    const reduceMotion = prefersReducedMotion();

    // 1. Hide everything the reveal brings in. The intro veil covers the hero while this sits
    //    hidden, so there's no flash. Each column slides in from its own outer edge.
    gsap.set(leftItems, { autoAlpha: 0, x: -ENTER_OFFSET });
    gsap.set(rightItems, { autoAlpha: 0, x: ENTER_OFFSET });
    if (ringInner) gsap.set(ringInner, { autoAlpha: 0, scale: 0.8 });

    // 2. Entrance — fired when the intro lands the sun (or the fallback), matching the headline.
    let hasRevealed = false;
    const runReveal = () => {
      if (hasRevealed) return;
      hasRevealed = true;

      if (reduceMotion) {
        gsap.set([leftItems, rightItems], { autoAlpha: 1, x: 0 });
        if (ringInner) gsap.set(ringInner, { autoAlpha: 1, scale: 1 });
        return;
      }

      gsap.to(leftItems, {
        autoAlpha: 1, x: 0, duration: ENTRANCE_DURATION, stagger: ENTRANCE_STAGGER, ease: 'expo.out',
      });
      gsap.to(rightItems, {
        autoAlpha: 1, x: 0, duration: ENTRANCE_DURATION, stagger: ENTRANCE_STAGGER, ease: 'expo.out',
      });
      if (ringInner) {
        gsap.to(ringInner, { autoAlpha: 1, scale: 1, duration: RING_DURATION, ease: 'power2.out' });
      }
    };

    window.addEventListener(REVEAL_EVENT, runReveal);
    const fallbackTimeout = window.setTimeout(runReveal, REVEAL_FALLBACK_MS);

    // 3. Subtle live ticking — the values wander a hair so the panel reads as a live instrument.
    //    Skipped entirely under reduced motion (the resting values stay put).
    let liveTimer = 0;
    if (!reduceMotion) {
      const energyValues = section.querySelectorAll<HTMLElement>('[data-live="energy"]');
      const fieldValues = section.querySelectorAll<HTMLElement>('[data-live="field"]');
      const tick = () => {
        const energy = Math.round(ENERGY_MIN + Math.random() * (ENERGY_MAX - ENERGY_MIN));
        energyValues.forEach((element) => { element.textContent = `${energy}%`; });
        const field = (FIELD_BASE + (Math.random() * 2 - 1) * FIELD_JITTER).toFixed(3);
        fieldValues.forEach((element) => { element.textContent = field; });
      };
      liveTimer = window.setInterval(tick, LIVE_TICK_MS);
    }

    return () => {
      window.removeEventListener(REVEAL_EVENT, runReveal);
      window.clearTimeout(fallbackTimeout);
      window.clearInterval(liveTimer);
      gsap.killTweensOf([leftItems, rightItems]);
      if (ringInner) gsap.killTweensOf(ringInner);
    };
  }, [sectionRef]);
}
