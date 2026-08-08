'use client';

import { useEffect, useState } from 'react';
import {
  isReducedMotion,
  isSystemReducedMotion,
  MOTION_CHOICE_EVENT,
  setMotionPreference,
  shouldAskMotionChoice,
  subscribeMotionPreference,
  type MotionPreference,
} from '@/lib/motionPreference';

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
 * underline's hold pulse. What lives in state here is only this component's own mode and pressed
 * state, and a child re-rendering itself is not the loader re-rendering.
 *
 * ⚠ It renders OUTSIDE the intro's root element. That root is `aria-hidden` with
 * `pointer-events: none`, and neither can be undone from a descendant — `aria-hidden="false"` on a
 * child of an `aria-hidden="true"` ancestor does not restore it. An interactive control has to be a
 * sibling.
 */
export default function MotionPrompt() {
  // ⚠ All three start at their SSR answers and are corrected in an effect. `isReducedMotion()`
  // returns `false` on the server, so branching on it during render would give a reduced-motion
  // machine a different first paint than the server sent — the same hydration trap that keeps
  // `GatherCanvas` mounted unconditionally. `null` renders nothing, which is what the server sent.
  const [shouldAsk, setShouldAsk] = useState(false);
  const [isReduced, setIsReduced] = useState(false);
  const [askedBySystem, setAskedBySystem] = useState(false);
  // Set between the press and the reload, which on a cold connection is long enough to look broken.
  const [isCommitting, setIsCommitting] = useState(false);

  useEffect(() => {
    const syncFromPreference = () => {
      setIsReduced(isReducedMotion());
      setAskedBySystem(isSystemReducedMotion());
      // ⚠ ASKED ONCE. Once a choice is stored this goes false and the panel never returns, which is
      // only tolerable because `readStoredPreference` retires a choice whose OS baseline has since
      // moved — a later flip of the system switch re-opens the question by itself. Showing the panel
      // on every subsequent load was the first cut and it read as the site having forgotten.
      setShouldAsk(shouldAskMotionChoice());
    };
    syncFromPreference();
    return subscribeMotionPreference(syncFromPreference);
  }, []);

  /**
   * Record the choice, then either restart the page or release the loader.
   *
   * ⚠ THE RELOAD IS NOT LAZINESS, and it is also not always needed. Every consumer of
   * `prefersReducedMotion()` reads it once and captures the answer: the pin's snap durations are
   * baked into a ScrollTrigger built ONCE by design, `GatherCanvas` has either created a WebGL
   * context or refused to, and both scene hooks hold a `reduceMotion` const from their own
   * construction. So a choice that CHANGES the resolved answer has to start the page again, or the
   * visitor presses a button and watches nothing happen.
   *
   * A choice that agrees with what is already running changes nothing that needs rebuilding — it
   * only records the opinion — so it releases the loader in place. That is the common path (most
   * people accept what their OS already asked for) and it is the one that must not cost a reload.
   */
  const choose = (next: MotionPreference) => {
    const wasReduced = isReducedMotion();
    setMotionPreference(next);

    if (isReducedMotion() !== wasReduced) {
      setIsCommitting(true);
      window.location.reload();
      return;
    }
    window.dispatchEvent(new Event(MOTION_CHOICE_EVENT));
  };

  // ⚠ Returning null is what gates this, and it works because the loader reveals the prompt by
  // QUERYING for it (`.intro-motion-prompt`) rather than holding a ref. The loader does NOT infer
  // anything from the element's absence, though — it asks `shouldAskMotionChoice()` itself, so the
  // two can never disagree about whether a decision is owed.
  if (!shouldAsk) return null;

  // The same two outcomes whichever way round they are offered, so the consequence text is written
  // once. Order puts what is already running first: the answer that costs nothing should be the
  // easy one to reach for.
  const reducedOption = {
    preference: 'reduced' as const,
    label: 'Reduce motion',
    // ⚠ Describes what reduced motion does TODAY. The crossings between sections still travel at
    // full amplitude — that is Phase 3 of docs/reduced-motion-plan.md and it is not built. When it
    // lands this gains "and sections cross-fade instead of flying". Do not promise it early.
    detail: 'Idle motion stops — nothing drifts, spins or pulses on its own.',
  };
  const fullOption = {
    preference: 'full' as const,
    label: 'Show everything',
    detail: 'Orbital drift, the cursor trail, and the collapse at the end.',
  };
  const options = isReduced
    ? [reducedOption, fullOption]
    : [fullOption, reducedOption];

  return (
    <div
      className="intro-motion-prompt"
      data-committing={isCommitting}
      // Always a real dialog now: the only time it renders, the loader is holding for it.
      role="dialog"
      aria-modal
      aria-labelledby="intro-motion-title"
    >
      <p className="intro-motion-title" id="intro-motion-title">
        {askedBySystem
          ? 'Your device asked for less motion.'
          : 'This site is one continuous flight.'}
      </p>

      <div className="intro-motion-options">
        {options.map((option) => {
          // Exactly one of the two will change the resolved answer, and only that one restarts.
          const willReload = (option.preference === 'reduced') !== isReduced;
          return (
            <button
              key={option.preference}
              type="button"
              className="intro-motion-option"
              disabled={isCommitting}
              onClick={() => choose(option.preference)}
            >
              <span className="intro-motion-option-label">
                {isCommitting && willReload ? 'Restarting…' : option.label}
              </span>
              <span className="intro-motion-option-detail">{option.detail}</span>
              {willReload ? (
                <span className="intro-motion-option-note">Reloads the page</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
