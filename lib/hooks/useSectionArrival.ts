import { useEffect, type RefObject } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { SECTION_ARRIVE_EVENT, readSectionArriveKey } from '@/lib/sectionJumpEvents';

/**
 * Play a section's contents in when a covered nav jump lands on it.
 *
 * ── Why a section needs this at all ──────────────────────────────────────────────────────────────
 * Everything past the hero is faded in by its crossing, and a covered jump scrubs those crossings to
 * their final values while the cover is down. So by the time the hole opens the section is simply
 * THERE, fully formed, having assembled where nobody could see it. Scrolling to it never had that
 * problem — the crossing is the entrance, and you watch it.
 *
 * ── Why it is a rise and not the section's own gesture ──
 * The works overlay already has a shear (`useWorksTextTransition`) and it is the wrong one to reuse:
 * that gesture means "the PROJECT changed" and reads as advancing sideways through a list. Arriving
 * is a different beat — the section assembling around you — so it rises, staggered, in document
 * order. One gesture per meaning.
 *
 * Deliberately generic: it takes a container and a selector rather than a list of refs, so a section
 * declares what its own arrival is made of in one line and nothing here has to know its structure.
 *
 * ⚠ In works this animates the same elements as `useWorksTextTransition`, and `overwrite: true` below
 * is what keeps them from fighting. Committing the target stop up front means the project change fires
 * at the START of the glide, so its shear is typically still running when the cover opens — the
 * arrival kills it, and a killed tween never applies its `clearProps`, which is what would otherwise
 * snap the transform out from under this one mid-flight. The margin is real (the shear leads by ~0.8s,
 * a covered glide runs 1.5s+) but it is a margin, so do not remove the overwrite.
 */

/** How far each element rises into place. Small — this is a settle, not an entrance from off-screen. */
const ARRIVAL_LIFT_PX = 22;
const ARRIVAL_DURATION = 0.75;
const ARRIVAL_STAGGER = 0.07;

interface SectionArrivalOptions {
  /** The carousel section key this entrance belongs to — 'work', 'contact', … */
  sectionKey: string;
  /** The section's root. Nothing outside it is ever touched. */
  containerRef: RefObject<HTMLElement | null>;
  /**
   * What actually staggers, as a CSS selector resolved inside the container. Matched in DOCUMENT
   * order, which is what makes the stagger read top-to-bottom without anything having to say so.
   */
  selector: string;
}

export function useSectionArrival({
  sectionKey,
  containerRef,
  selector,
}: SectionArrivalOptions) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onSectionArrive = (event: Event) => {
      if (readSectionArriveKey(event) !== sectionKey) return;
      const elements = Array.from(
        container.querySelectorAll<HTMLElement>(selector),
      );
      if (elements.length === 0) return;

      // Reduced motion still gets the section — it just gets it already assembled. Clearing rather
      // than setting to rest leaves the stylesheet in charge, so nothing carries an inline value it
      // never needed.
      if (prefersReducedMotion()) {
        gsap.set(elements, { clearProps: 'transform,opacity,visibility' });
        return;
      }

      gsap.fromTo(
        elements,
        { autoAlpha: 0, y: ARRIVAL_LIFT_PX },
        {
          autoAlpha: 1,
          y: 0,
          duration: ARRIVAL_DURATION,
          stagger: ARRIVAL_STAGGER,
          ease: 'power3.out',
          overwrite: true,
          // ⚠ Cleared, not left at rest. The container's own opacity is owned by the pin's crossing,
          // and these are its children — a left-behind inline `opacity: 1` is harmless, but a
          // left-behind `translate(0)` keeps a composited layer alive on every line of the footer for
          // the rest of the session.
          clearProps: 'transform,opacity,visibility',
        },
      );
    };

    window.addEventListener(SECTION_ARRIVE_EVENT, onSectionArrive);
    return () => {
      window.removeEventListener(SECTION_ARRIVE_EVENT, onSectionArrive);
    };
  }, [sectionKey, containerRef, selector]);
}
