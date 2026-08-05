import { useEffect, type RefObject } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { useModalLayer } from '@/lib/hooks/useModalLayer';

/**
 * The bottom sheet's behaviour: how it arrives, and how a finger throws it away.
 *
 * Escape, the focus trap and the gesture arbitration that stops the pinned page moving underneath it
 * all live in `useModalLayer`, shared with the navbar's orbit dial.
 *
 * ── The swipe ────────────────────────────────────────────────────────────────────────────────────
 * A downward drag moves the sheet with the finger and lets go past a threshold, which is what makes a
 * sheet feel like an object rather than a panel with a close button. It is armed only when the
 * scroller is already at its top — otherwise the first pull of a scroll-up would throw the sheet away
 * instead of reading the content, which is the single most common way a hand-rolled sheet gets this
 * wrong.
 */

/** How far down the sheet must be thrown before letting go dismisses it, as a fraction of its height. */
const DISMISS_FRACTION = 0.3;
/** …or this fast, in px/ms, so a short flick still closes it. */
const DISMISS_VELOCITY = 0.45;
/** Resistance on an upward drag, so the sheet resists being pulled off the top of the screen. */
const UPWARD_DRAG_RESISTANCE = 0.25;

const OPEN_DURATION = 0.42;
const CLOSE_DURATION = 0.28;

interface DrawerSheetRefs {
  rootRef: RefObject<HTMLDivElement | null>;
  sheetRef: RefObject<HTMLDivElement | null>;
  scrimRef: RefObject<HTMLDivElement | null>;
  scrollRef: RefObject<HTMLDivElement | null>;
  open: boolean;
  onClose: () => void;
}

export function useDrawerSheet({
  rootRef,
  sheetRef,
  scrimRef,
  scrollRef,
  open,
  onClose,
}: DrawerSheetRefs): void {
  // ── 1. Open / close ──
  // Kept apart from the gesture effect below so a re-render caused by anything else can't re-run the
  // entrance. `open` is the only thing this watches.
  useEffect(() => {
    const root = rootRef.current;
    const sheet = sheetRef.current;
    const scrim = scrimRef.current;
    if (!root || !sheet || !scrim) return;

    const reduceMotion = prefersReducedMotion();

    if (open) {
      // ⚠ `data-active` is the HOOK's, and it is what the CSS hides the root by. `data-open` — React's —
      // cannot do that job: it flips to false the instant the close starts, so a root hidden by it takes
      // the sheet off screen a frame before the slide-out has moved it, and the drawer appears to
      // vanish rather than leave. This goes true here and false only when the close has finished.
      root.dataset.active = 'true';
      // `autoAlpha` rather than opacity: a transparent full-screen scrim still owns a compositor layer
      // and still hit-tests, and this one is up over a live WebGL scene.
      gsap.set(sheet, { autoAlpha: 1 });
      gsap.fromTo(
        scrim,
        { autoAlpha: 0 },
        { autoAlpha: 1, duration: reduceMotion ? 0 : OPEN_DURATION, ease: 'power2.out' },
      );
      gsap.fromTo(
        sheet,
        { yPercent: 100 },
        {
          yPercent: 0,
          duration: reduceMotion ? 0 : OPEN_DURATION,
          // Overshoot-free but late-decelerating, so the sheet arrives with weight rather than
          // gliding to a stop. A back.out here reads as bounce, which this site's motion never does.
          ease: 'expo.out',
        },
      );
      return;
    }

    gsap.to(scrim, { autoAlpha: 0, duration: reduceMotion ? 0 : CLOSE_DURATION, ease: 'power2.in' });
    gsap.to(sheet, {
      yPercent: 100,
      duration: reduceMotion ? 0 : CLOSE_DURATION,
      ease: 'power2.in',
      onComplete: () => {
        gsap.set(sheet, { autoAlpha: 0 });
        // Only now is it safe to take the root out of the compositor — see the note on the open branch.
        root.dataset.active = 'false';
      },
    });
  }, [open, rootRef, sheetRef, scrimRef]);

  // ── 2. Escape, focus, and the pin ──
  // Shared with the orbit dial: both are full-screen layers over one pinned page, and the reasoning
  // about swallowing gestures before `window` sees them is identical. See lib/hooks/useModalLayer.
  useModalLayer({ rootRef, surfaceRef: sheetRef, open, onClose });

  // ── 3. Swipe down to dismiss ──
  useEffect(() => {
    const sheet = sheetRef.current;
    const scroller = scrollRef.current;
    if (!sheet || !open || prefersReducedMotion()) return;

    let startY = 0;
    let startTime = 0;
    let dragging = false;
    let travel = 0;

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      // Armed only from the top of the content. Mid-scroll, a downward drag means "read upward" and
      // must not throw the sheet away.
      if (scroller && scroller.scrollTop > 0) return;
      startY = event.touches[0].clientY;
      startTime = event.timeStamp;
      travel = 0;
      dragging = true;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (!dragging) return;
      const delta = event.touches[0].clientY - startY;
      // Pulling UP is resisted rather than blocked — a hard stop feels like a bug, a spring feels like
      // an edge.
      travel = delta >= 0 ? delta : delta * UPWARD_DRAG_RESISTANCE;
      gsap.set(sheet, { y: travel });
    };

    const handleTouchEnd = (event: TouchEvent) => {
      if (!dragging) return;
      dragging = false;
      const elapsed = Math.max(event.timeStamp - startTime, 1);
      const velocity = travel / elapsed;
      const shouldDismiss =
        travel > sheet.offsetHeight * DISMISS_FRACTION || velocity > DISMISS_VELOCITY;

      if (shouldDismiss) {
        // Hand back to the close animation, which drives `yPercent`. Clearing `y` first stops the two
        // transforms compounding into a sheet that leaves twice as far as the screen is tall.
        gsap.set(sheet, { y: 0 });
        onClose();
        return;
      }
      gsap.to(sheet, { y: 0, duration: 0.3, ease: 'power3.out' });
    };

    sheet.addEventListener('touchstart', handleTouchStart, { passive: true });
    sheet.addEventListener('touchmove', handleTouchMove, { passive: true });
    sheet.addEventListener('touchend', handleTouchEnd, { passive: true });
    sheet.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      sheet.removeEventListener('touchstart', handleTouchStart);
      sheet.removeEventListener('touchmove', handleTouchMove);
      sheet.removeEventListener('touchend', handleTouchEnd);
      sheet.removeEventListener('touchcancel', handleTouchEnd);
      gsap.set(sheet, { y: 0 });
    };
  }, [open, sheetRef, scrollRef, onClose]);
}
