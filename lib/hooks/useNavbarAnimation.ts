import { useEffect, type RefObject } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { REVEAL_EVENT } from '@/components/effects/IntroSequence/introEvents';

const ENTRANCE_DURATION = 0.85;
const ENTER_DISTANCE    = 36; // px each item travels in from its direction
// If the intro never fires its reveal (e.g. it was bypassed), enter anyway.
const ENTRANCE_FALLBACK_MS = 7200;

const HOME_METER_KEY = 'home';

interface NavbarAnimationRefs {
  navRef:    RefObject<HTMLElement | null>;
  accentRef: RefObject<HTMLDivElement | null>;
  metersRef: RefObject<HTMLDivElement | null>;
}

// Where each item starts before it converges to its resting spot (data-enter on the <li>).
function enterOffset(direction: string | null) {
  switch (direction) {
    case 'top':    return { x: 0,              y: -ENTER_DISTANCE };
    case 'bottom': return { x: 0,              y:  ENTER_DISTANCE };
    case 'left':   return { x: -ENTER_DISTANCE, y: 0 };
    case 'right':  return { x:  ENTER_DISTANCE, y: 0 };
    default:       return { x: 0,              y: 0 };
  }
}

export function useNavbarAnimation(navbarAnimationRefs: NavbarAnimationRefs) {
  const { navRef, accentRef, metersRef } = navbarAnimationRefs;

  useEffect(() => {
    const navElement    = navRef.current;
    const accentElement = accentRef.current;
    const metersElement = metersRef.current;
    if (!navElement) return;

    const logoElement = navElement.querySelector<HTMLElement>('.nav-logo');
    const ctaElement  = navElement.querySelector<HTMLElement>('.nav-cta');
    const itemElements = Array.from(navElement.querySelectorAll<HTMLElement>('.nav-item'));

    // Slot each cyan meter under its item by measuring the live layout. The accent layer
    // is fixed and full-width (left: 0), so a viewport-x rect maps straight to the meter's
    // `left`. Re-run on resize and once fonts settle (label widths depend on the font).
    const positionMeters = () => {
      if (!metersElement) return;
      metersElement.querySelectorAll<HTMLElement>('.nav-meter').forEach((meterElement) => {
        const meterKey = meterElement.getAttribute('data-meter');
        const targetElement =
          meterKey === HOME_METER_KEY
            ? navElement.querySelector<HTMLElement>('.nav-logo .nav-wordmark')
            : navElement.querySelector<HTMLElement>(`.nav-link[data-key="${meterKey}"] .nav-link-label`);

        if (!targetElement) {
          meterElement.style.display = 'none';
          return;
        }
        const targetRect = targetElement.getBoundingClientRect();
        meterElement.style.display = 'block';
        meterElement.style.left  = `${targetRect.left}px`;
        meterElement.style.width = `${targetRect.width}px`;
      });
    };

    let hasEntered = false;
    const playEntrance = () => {
      if (hasEntered) return;
      hasEntered = true;

      // Reduced motion: no travel — just present the finished bar.
      if (prefersReducedMotion()) {
        gsap.set([navElement, accentElement, logoElement, ctaElement, ...itemElements], { clearProps: 'transform', opacity: 1 });
        positionMeters();
        if (metersElement) gsap.set(metersElement, { opacity: 1 });
        return;
      }

      // Hide every animated part up front so nothing flashes before its tween starts.
      gsap.set(navElement, { opacity: 1 });
      gsap.set([logoElement, ctaElement, ...itemElements], { opacity: 0 });

      const entranceTimeline = gsap.timeline();

      if (accentElement) {
        entranceTimeline.fromTo(accentElement, { opacity: 0 }, { opacity: 1, duration: 0.6, ease: 'power2.out' }, 0);
      }
      entranceTimeline.fromTo(
        logoElement,
        { opacity: 0, scale: 0.92 },
        { opacity: 1, scale: 1, duration: 0.7, ease: 'power3.out' },
        0,
      );

      // 1. The items converge from their four directions at once (the "mixed" entrance).
      itemElements.forEach((itemElement) => {
        const { x, y } = enterOffset(itemElement.getAttribute('data-enter'));
        entranceTimeline.fromTo(
          itemElement,
          { opacity: 0, x, y },
          { opacity: 1, x: 0, y: 0, duration: ENTRANCE_DURATION, ease: 'expo.out' },
          0.05,
        );
      });

      entranceTimeline.fromTo(
        ctaElement,
        { opacity: 0, x: 12 },
        { opacity: 1, x: 0, duration: 0.6, ease: 'power3.out' },
        0.12,
      );

      // 2. Once everything has landed, place the meters under their items and reveal them.
      entranceTimeline.add(positionMeters, '>-0.15');
      if (metersElement) {
        entranceTimeline.to(metersElement, { opacity: 1, duration: 0.5, ease: 'power2.out' }, '<');
      }
    };

    // Enter in lockstep with the hero reveal (or on the fallback if the intro is bypassed).
    window.addEventListener(REVEAL_EVENT, playEntrance);
    const fallbackTimeout = window.setTimeout(playEntrance, ENTRANCE_FALLBACK_MS);

    window.addEventListener('resize', positionMeters);
    if (document.fonts?.ready) document.fonts.ready.then(positionMeters);

    return () => {
      window.removeEventListener(REVEAL_EVENT, playEntrance);
      window.removeEventListener('resize', positionMeters);
      window.clearTimeout(fallbackTimeout);
    };
  }, []);
}
