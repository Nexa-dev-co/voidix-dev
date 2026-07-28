import { useEffect, type RefObject } from 'react';

/**
 * Let a long answer scroll inside the panel without the page stealing the gesture.
 *
 * The hologram is the LAST stop of the hero pin, and the pin deliberately hands the wheel back to native
 * scroll at its ends so you can leave the page. A scroll area sitting inside that is a collision:
 *
 *   - scroll down through a long answer  → must move the answer, not scroll out of the section
 *   - scroll up  through a long answer   → must move the answer, not step back and re-seal the panel
 *   - scroll at either END of the answer → must behave normally again, so you are never trapped in it
 *
 * `overscroll-behavior: contain` (in the CSS) stops the BROWSER chaining the scroll out to the page. This
 * stops the PIN seeing it: the hero's stepper listens on `window`, so swallowing the event before it
 * bubbles that far is enough — and we only swallow it while the scroller can actually still move in the
 * direction asked for. At the end of the content the event goes through untouched and the page behaves
 * exactly as it would without a hologram in it.
 *
 * `preventDefault` is deliberately NOT called: the browser still has to do the actual scrolling.
 */

/** Sub-pixel slack, so a scroller resting a hair off its end doesn't read as "still has room". */
const END_EPSILON = 1;

export function useHologramScrollGuard(
  scrollRef: RefObject<HTMLDivElement | null>,
): void {
  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;

    /** Can this scroller still move that way? (`delta > 0` = the user is scrolling down.) */
    const canScroll = (delta: number) => {
      const room = scroller.scrollHeight - scroller.clientHeight;
      if (room <= END_EPSILON) return false;
      return delta > 0
        ? scroller.scrollTop < room - END_EPSILON
        : scroller.scrollTop > END_EPSILON;
    };

    const handleWheel = (event: WheelEvent) => {
      if (canScroll(event.deltaY)) event.stopPropagation();
    };

    // Touch has no delta on the event — the direction has to be measured against where the finger
    // landed. Swiping UP the screen scrolls the content DOWN, hence the inversion.
    let touchStartY = 0;
    const handleTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY ?? 0;
      if (canScroll(touchStartY - currentY)) event.stopPropagation();
    };

    scroller.addEventListener('wheel', handleWheel, { passive: true });
    scroller.addEventListener('touchstart', handleTouchStart, { passive: true });
    scroller.addEventListener('touchmove', handleTouchMove, { passive: true });

    return () => {
      scroller.removeEventListener('wheel', handleWheel);
      scroller.removeEventListener('touchstart', handleTouchStart);
      scroller.removeEventListener('touchmove', handleTouchMove);
    };
  }, [scrollRef]);
}
