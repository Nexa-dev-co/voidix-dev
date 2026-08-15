'use client';

import { useEffect, useState } from 'react';
import { LOOP_ARRIVED_EVENT, LOOP_REVERSE_REQUEST_EVENT } from '@/lib/loopEvents';

/**
 * The way back — the hero's half of the loop, which until now only ran one way.
 *
 * You reach the hero by falling through the black hole at the bottom of the site. From there the only
 * route back was to scroll the whole journey again, which is a strange thing to ask of someone who has
 * just been shown that the site is a circuit.
 *
 * ── ⚠ WHY IT IS NOT HERE ON A FIRST VISIT ────────────────────────────────────────────────────────
 * It renders `null` until `LOOP_ARRIVED_EVENT`, and that is a design decision rather than a
 * simplification. The hero is the site's opening frame and the shot it would be judged on; a control
 * offering to skip to the end has no business in it before the visitor knows there IS an end. Once they
 * have been through the hole the same control is not clutter, it is the obvious question answered.
 *
 * The pin arms the matching wheel gesture off the same latch, so the two can never disagree about
 * whether the way back exists.
 *
 * ── The name ──
 * The forward control, at contact, says "Travel in time" and lands you at the beginning — so the hero
 * is the past and this is the return. It names the EVENT HORIZON, which is the thing actually waiting
 * at the other end and the last thing the visitor saw before the cream took the screen. The site's own
 * vocabulary, and a word that means the edge of a place and the edge of a time at once.
 */
export default function HeroReturnCue() {
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    // Latched for the session, exactly as the pin latches its own copy. There is no un-looping.
    const onLoopArrived = () => setIsAvailable(true);
    window.addEventListener(LOOP_ARRIVED_EVENT, onLoopArrived);
    return () => window.removeEventListener(LOOP_ARRIVED_EVENT, onLoopArrived);
  }, []);

  // ⚠ Nothing is rendered before a loop lands, and nothing needs to be. An earlier cut kept an
  // always-present zero-height anchor here so that the control appearing mid-session could not change
  // the hero's flex column and move the star out from under itself. It is `position: absolute` now,
  // placed from the square's published box rather than from the flow, so it costs the layout nothing
  // whether it exists or not — and the reason for the anchor went with it.
  if (!isAvailable) return null;

  return (
    <button
      type="button"
      className="hero-return"
      // Routed through the pin, never scrolling by itself — the same rule the contact section's
      // "Travel in time" follows, so the button and the wheel gesture commit ONE cinematic. The pin is
      // also the only thing that can refuse (mid-entrance, mid-jump, not at the top).
      onClick={() => window.dispatchEvent(new Event(LOOP_REVERSE_REQUEST_EVENT))}
    >
      {/* The mirror of the scroll cue's downward arrow: down is onward, up is back. */}
      <svg
        className="hero-return-glyph"
        width="12"
        height="22"
        viewBox="0 0 12 22"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M6 21V3M1 8l5-5 5 5"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="hero-return-label">Back to the horizon</span>
    </button>
  );
}
