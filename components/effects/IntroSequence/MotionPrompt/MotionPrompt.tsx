'use client';

import { useEffect, useState } from 'react';
import {
  getMotionPreference,
  isReducedMotion,
  setMotionPreference,
  subscribeMotionPreference,
  type MotionPreference,
} from '@/lib/motionPreference';

/**
 * Who gets offered the choice unprompted.
 *
 * ⚠ A TOUCH test, not a size test, and not a platform test. The camera work is hardest to sit
 * through on something held close in one hand, which is a property of the device rather than of the
 * window — a narrow browser window on a desktop is a mouse user who has resized, and does not want
 * an accessibility prompt over their first impression. This is the same distinction
 * `useIsLowPowerViewport` and `useIsNarrowViewport` exist to keep apart, so it deliberately does not
 * reuse either: the first would also match any window under 760px.
 *
 * ⚠ And explicitly NOT a user-agent test for iPhone, which is where this started. `Reduce Motion` is
 * a platform-wide standard — Android reports it from "Remove animations", Windows and macOS from
 * their own settings — so sniffing for one vendor would deny the choice to the Android visitor who
 * has already asked their phone for exactly this. It would also miss iPads, which report as Macs.
 */
const TOUCH_POINTER_QUERY = '(pointer: coarse)';

/**
 * The motion offer, made while the loader holds.
 *
 * ── Why here rather than in the bar ──────────────────────────────────────────────────────────────
 * The loader is the one beat on this site where the visitor is already waiting, so asking costs
 * nothing — and it lands BEFORE the first cinematic rather than after one has already made someone
 * feel unwell. It also gets to acknowledge the OS setting instead of silently obeying it, which is
 * the difference between a site that stripped itself back and a site that says it did.
 *
 * ⚠ Its visibility is NOT React state. `IntroSequence` never re-renders during the intro — a
 * re-render would re-apply its JSX inline styles over the values GSAP is driving — so the loader
 * shows and hides this by toggling a class from its own effect, exactly as it does for the
 * underline's hold pulse. What lives in state here is only this component's own pressed state, and
 * a child re-rendering itself is not the loader re-rendering.
 *
 * ⚠ It renders OUTSIDE the intro's root element. That root is `aria-hidden` with
 * `pointer-events: none`, and neither can be undone from a descendant — `aria-hidden="false"` on a
 * child of an `aria-hidden="true"` ancestor does not restore it. An interactive control has to be a
 * sibling.
 */
export default function MotionPrompt() {
  // ⚠ Starts `false` and is corrected in an effect. `isReducedMotion()` answers `false` during SSR,
  // so branching on it during render would give a reduced-motion machine a different first paint
  // than the server sent — the same hydration trap that keeps `GatherCanvas` mounted unconditionally.
  const [isReduced, setIsReduced] = useState(false);
  // Renders nothing until proven otherwise, which doubles as the hydration guard: the server cannot
  // know the pointer type or the OS setting, so the first client render has to match its `null`.
  const [shouldOffer, setShouldOffer] = useState(false);

  useEffect(() => {
    const syncFromPreference = () => {
      const reduced = isReducedMotion();
      setIsReduced(reduced);
      setShouldOffer(
        // Already asked for less motion, on any device: this is an acknowledgement and a way back,
        // not an interruption. Worth showing on a desktop too — being told the site heard you is
        // better than silently getting the lesser version of it.
        reduced ||
          // ⚠ Or they have chosen something explicitly at some point. Without this the control is a
          // one-way door on desktop: a mouse user whose OS asked for reduced motion presses "Show me
          // all of it", the flag resolves to false, the pointer is fine — and the offer never
          // appears again to let them change their mind back.
          getMotionPreference() !== 'system' ||
          window.matchMedia(TOUCH_POINTER_QUERY).matches,
      );
    };
    syncFromPreference();
    return subscribeMotionPreference(syncFromPreference);
  }, []);

  /**
   * Record the choice, then start the page again.
   *
   * ⚠ THE RELOAD IS THE POINT, not laziness. By the time this offer is on screen every consumer of
   * `prefersReducedMotion()` has already read it and captured the answer: the pin's snap durations
   * are baked into a ScrollTrigger that is built ONCE by design, `GatherCanvas` has either created a
   * WebGL context or refused to, and both scene hooks hold a `reduceMotion` const from their own
   * construction. Flipping the module now would change a value that nothing is going to ask again,
   * and the visitor would press a button and watch nothing happen.
   *
   * The loader is also the cheapest possible place to pay for it. Nothing has been seen yet, the
   * assets are in the HTTP cache so the second pass revalidates rather than re-downloads, and the
   * page comes back with the preference applied from its very first frame instead of half-applied
   * from its thirtieth.
   */
  const chooseAndRestart = (preference: MotionPreference) => {
    setMotionPreference(preference);
    window.location.reload();
  };

  // ⚠ Returning null is what gates this, and it works because the loader reveals the prompt by
  // QUERYING for it (`.intro-motion-prompt`) rather than holding a ref — no element, no class, no
  // offer, and nothing in IntroSequence needs to know the rule.
  if (!shouldOffer) return null;

  return (
    <div className="intro-motion-prompt" data-reduced={isReduced}>
      <span className="intro-motion-copy">
        {isReduced
          ? 'Motion reduced, as your system asked.'
          : 'This one travels — the whole site is one flight.'}
      </span>
      <button
        type="button"
        className="intro-motion-action"
        // Explicit values, never a flip back to `system`: choosing the full experience has to be
        // recorded as a CHOICE, or the OS setting quietly overrules it on the next visit.
        onClick={() => chooseAndRestart(isReduced ? 'full' : 'reduced')}
      >
        {isReduced ? 'Show me all of it' : 'Reduce motion'}
      </button>
    </div>
  );
}
