import { useEffect, useRef, type RefObject } from 'react';
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
  /**
   * Which bar is rendered — the four-item one, or the phone's logo-plus-menu-button.
   *
   * ⚠ It is a DEPENDENCY, not decoration. This effect queries `.nav-item` / `.nav-cta` once and holds
   * the results for the life of the bar, and the narrow check resolves in an effect right after mount —
   * so on a phone the first pass captures the desktop items and then React unmounts them, leaving the
   * entrance tweening detached nodes and the real bar never fading in at all. Re-running on the swap is
   * what makes the hook see the bar that actually exists.
   */
  isNarrow: boolean;
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
  const { navRef, accentRef, metersRef, isNarrow } = navbarAnimationRefs;
  // Survives the effect re-running when the bar swaps layout — see `isNarrow` on the props.
  const hasEnteredRef = useRef(false);

  useEffect(() => {
    const navElement    = navRef.current;
    const accentElement = accentRef.current;
    const metersElement = metersRef.current;
    if (!navElement) return;

    const logoElement = navElement.querySelector<HTMLElement>('.nav-logo');
    // On a phone this is the menu button rather than the CTA — same slot on the right of the bar, same
    // entrance. Either can be absent, hence the guards below.
    const ctaElement  = navElement.querySelector<HTMLElement>('.nav-cta, .nav-menu-toggle');
    const itemElements = Array.from(navElement.querySelectorAll<HTMLElement>('.nav-item'));
    // GSAP warns on a null target, and on a phone there are no items to converge.
    const animatedParts = [logoElement, ctaElement, ...itemElements].filter(
      (element): element is HTMLElement => element !== null,
    );

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

    // ⚠ Already entered, and this is a RE-RUN (the layout swapped past the narrow breakpoint). The
    // reveal is a one-shot event that fired long ago and will not fire again, so there is nothing left
    // to wait for — present the new bar and leave. Without this the effect would arm a fresh fallback
    // timeout and replay the whole entrance seven seconds after an idle resize.
    if (hasEnteredRef.current) {
      gsap.set([navElement, accentElement, ...animatedParts].filter(Boolean), { clearProps: 'transform', opacity: 1 });
      positionMeters();
      if (metersElement) gsap.set(metersElement, { opacity: 1 });
      window.addEventListener('resize', positionMeters);
      return () => window.removeEventListener('resize', positionMeters);
    }

    const playEntrance = () => {
      if (hasEnteredRef.current) return;
      hasEnteredRef.current = true;

      // Reduced motion: no travel — just present the finished bar.
      if (prefersReducedMotion()) {
        gsap.set([navElement, accentElement, ...animatedParts].filter(Boolean), { clearProps: 'transform', opacity: 1 });
        positionMeters();
        if (metersElement) gsap.set(metersElement, { opacity: 1 });
        return;
      }

      // Hide every animated part up front so nothing flashes before its tween starts.
      gsap.set(navElement, { opacity: 1 });
      gsap.set(animatedParts, { opacity: 0 });

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

      if (ctaElement) {
        entranceTimeline.fromTo(
          ctaElement,
          { opacity: 0, x: 12 },
          { opacity: 1, x: 0, duration: 0.6, ease: 'power3.out' },
          0.12,
        );
      }

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
  }, [isNarrow]);
}
