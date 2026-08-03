import { useEffect, type RefObject } from 'react';

/**
 * Let the panel's list and its long answers scroll without the page stealing the gesture.
 *
 * The hologram is the LAST stop of the hero pin, and the pin deliberately hands the wheel back to native
 * scroll at its ends so you can leave the page. A scroll area sitting inside that is a collision:
 *
 *   - scroll down through the content  → must move the content, not scroll out of the section
 *   - scroll up through the content    → must move the content, not step back and re-seal the panel
 *   - scroll at either END             → must behave normally again, so you are never trapped in it
 *
 * `overscroll-behavior: contain` (in the CSS) stops the BROWSER chaining the scroll out to the page. This
 * stops the PIN seeing it: the hero's stepper listens on `window`, so swallowing the event before it
 * bubbles that far is enough.
 *
 * `preventDefault` is deliberately NOT called: the browser still has to do the actual scrolling.
 *
 * ── ⚠ The rule is per GESTURE, not per event ─────────────────────────────────────────────────────
 * The first version tested only "can this scroller still move that way?" and let anything else through.
 * That reads correctly event by event and wrongly to a human: you scroll down the list of questions,
 * reach the bottom, and the *same continuous flick* — the one you were reading with, whose momentum is
 * still arriving — falls out of the panel and throws the whole section away. Nothing announced that the
 * list had ended; the page just left.
 *
 * So a gesture that has ever scrolled this panel keeps the rest of itself, end of content or not. Only a
 * gesture that BEGINS at the end is allowed out. That is exactly what `overscroll-behavior: contain`
 * does for native chaining, and it is the same rule the pin already applies to itself everywhere else
 * (`STEP_REARM_IDLE_MS` — the wheel must go quiet before it will step again). You are never trapped:
 * stop, and scroll again.
 */

/** Sub-pixel slack, so a scroller resting a hair off its end doesn't read as "still has room". */
const END_EPSILON = 1;

/**
 * How long the wheel must be quiet before the panel stops claiming the gesture.
 *
 * Wheel events carry no gesture boundary — there is no `wheelend` — so "the same flick" has to be
 * inferred from a gap in the stream. Trackpad momentum decays over roughly this long, which is also why
 * the hero pin picks the same figure for its own re-arm; the two want to agree, or a gesture the panel
 * has released can still be inside the pin's lock and do nothing at all.
 */
const GESTURE_IDLE_MS = 300;

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

    /**
     * True while a wheel gesture that this panel has already scrolled is still arriving.
     *
     * Set the moment the scroller consumes a wheel event, cleared once the wheel has been quiet for
     * `GESTURE_IDLE_MS`. It is what lets the tail of a flick be swallowed at the end of the content
     * instead of falling through to the pin.
     */
    let gestureOwned = false;
    let gestureIdleTimer = 0;
    const keepGesture = () => {
      gestureOwned = true;
      window.clearTimeout(gestureIdleTimer);
      gestureIdleTimer = window.setTimeout(() => {
        gestureOwned = false;
      }, GESTURE_IDLE_MS);
    };

    const handleWheel = (event: WheelEvent) => {
      // Still room to move → scroll, and claim the rest of this gesture.
      if (canScroll(event.deltaY)) {
        keepGesture();
        event.stopPropagation();
        return;
      }
      // Out of room. Swallow it anyway if this gesture was already ours — that is the overscroll tail
      // of a flick the visitor was reading with, and letting it out is what threw the section away.
      // Push the idle window along so a long tail cannot expire mid-flick and escape halfway through.
      if (gestureOwned) {
        keepGesture();
        event.stopPropagation();
      }
      // Otherwise this gesture BEGAN at the end of the content: let it go and leave the section.
    };

    // Touch has no delta on the event — the direction has to be measured against where the finger
    // landed. Swiping UP the screen scrolls the content DOWN, hence the inversion.
    //
    // Touch needs no idle timer: it has real gesture boundaries. `touchstart` opens one and `touchend`
    // closes it, so a finger that starts scrolling the panel keeps it until it lifts.
    let touchStartY = 0;
    const handleTouchStart = (event: TouchEvent) => {
      touchStartY = event.touches[0]?.clientY ?? 0;
      gestureOwned = false;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const currentY = event.touches[0]?.clientY ?? 0;
      if (canScroll(touchStartY - currentY)) gestureOwned = true;
      if (gestureOwned) event.stopPropagation();
    };
    const handleTouchEnd = () => {
      gestureOwned = false;
    };

    scroller.addEventListener('wheel', handleWheel, { passive: true });
    scroller.addEventListener('touchstart', handleTouchStart, { passive: true });
    scroller.addEventListener('touchmove', handleTouchMove, { passive: true });
    scroller.addEventListener('touchend', handleTouchEnd, { passive: true });
    scroller.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      window.clearTimeout(gestureIdleTimer);
      scroller.removeEventListener('wheel', handleWheel);
      scroller.removeEventListener('touchstart', handleTouchStart);
      scroller.removeEventListener('touchmove', handleTouchMove);
      scroller.removeEventListener('touchend', handleTouchEnd);
      scroller.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [scrollRef]);
}
