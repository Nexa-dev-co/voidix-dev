import { useEffect, type RefObject } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { useModalLayer } from '@/lib/hooks/useModalLayer';

/**
 * How the fan swings out and back.
 *
 * Escape, the focus trap and the gesture arbitration that stops the pinned page moving underneath it
 * are `useModalLayer`'s — shared with the drawer, because "a full-screen layer over one pinned page"
 * is one problem with one answer.
 *
 * ── ⚠ THE FACETS' `transform` IS NOT AVAILABLE ───────────────────────────────────────────────────
 * A facet is PLACED by its transform — `translate(pivot) rotate(angle) translateX(radius)` — so GSAP
 * may only ever tween its `autoAlpha`. Hand that property to GSAP and it rebuilds it from a decomposed
 * matrix: the position would survive by luck and stop surviving the moment the radius changed on a
 * resize. The swing-out is therefore done on the CONTAINER, which owns no layout of its own, while the
 * facets themselves only fade. That is also why the entrance reads as the whole fan sweeping open
 * rather than four things appearing.
 */

const OPEN_DURATION = 0.42;
const CLOSE_DURATION = 0.24;
/** How far back the fan is wound before it swings out. Negative = counter-clockwise, i.e. folded up. */
const ENTRY_ROTATION = -18;
/** Seconds between one facet lighting and the next — four of them, so the sweep is ~0.18s. */
const FACET_STAGGER = 0.06;

interface OrbitFanRefs {
  rootRef: RefObject<HTMLDivElement | null>;
  fanRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  onClose: () => void;
}

export function useOrbitFan({ rootRef, fanRef, open, onClose }: OrbitFanRefs): void {
  useModalLayer({ rootRef, surfaceRef: fanRef, open, onClose });

  useEffect(() => {
    const root = rootRef.current;
    const fan = fanRef.current;
    if (!root || !fan) return;

    const reduceMotion = prefersReducedMotion();
    const facets = Array.from(fan.querySelectorAll<HTMLElement>('.orbit-station'));
    const scrim = root.querySelector<HTMLElement>('.orbit-scrim');

    if (open) {
      // ⚠ `data-active` is the HOOK's and is what the CSS makes the root visible by. React's
      // `data-open` cannot do that job: it flips the instant the state does, so a root hidden by it
      // would take the fan off screen a frame before the fold-away had moved it — the fan would blink
      // out rather than close. This goes true here and false only when the close has finished.
      root.dataset.active = 'true';

      if (reduceMotion) {
        gsap.set(scrim, { autoAlpha: 1 });
        gsap.set(fan, { autoAlpha: 1, rotate: 0 });
        gsap.set(facets, { autoAlpha: 1 });
        return;
      }

      const timeline = gsap.timeline();
      timeline.fromTo(scrim, { autoAlpha: 0 }, { autoAlpha: 1, duration: 0.3, ease: 'power2.out' }, 0);
      // The swing. The container rotates about the pivot, so the whole fan unfolds from the mark that
      // was pressed rather than fading in where it will end up.
      timeline.fromTo(
        fan,
        { autoAlpha: 0, rotate: ENTRY_ROTATION },
        { autoAlpha: 1, rotate: 0, duration: OPEN_DURATION, ease: 'expo.out' },
        0,
      );
      // Facets light in order, outward along the sweep — the direction the arc is drawn in.
      timeline.fromTo(
        facets,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: 0.3, ease: 'power2.out', stagger: FACET_STAGGER },
        0.08,
      );
      return () => {
        timeline.kill();
      };
    }

    const closeTimeline = gsap.timeline({
      onComplete: () => {
        // Only now is it safe to take the root out of the compositor — see the open branch.
        root.dataset.active = 'false';
      },
    });
    closeTimeline.to(scrim, { autoAlpha: 0, duration: reduceMotion ? 0 : CLOSE_DURATION, ease: 'power2.in' }, 0);
    // Folds back the way it came, so the fan reads as returning into the mark.
    closeTimeline.to(
      fan,
      {
        autoAlpha: 0,
        rotate: ENTRY_ROTATION,
        duration: reduceMotion ? 0 : CLOSE_DURATION,
        ease: 'power2.in',
      },
      0,
    );

    return () => {
      closeTimeline.kill();
    };
  }, [open, rootRef, fanRef]);
}
