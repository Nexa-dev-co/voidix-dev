import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';

/**
 * The application form's step change, as a movement rather than a swap.
 *
 * ── Why this exists at all ───────────────────────────────────────────────────────────────────────
 * Both shells the form lives in are sized BY THEIR CONTENT: the dialog is a centred panel with a
 * `max-height`, the sheet is anchored to the bottom edge. So two steps of different heights mean the
 * panel changes size at the moment you press Continue — and because the dialog is centred, a height
 * change moves BOTH its edges. Left alone that reads as the panel flinching away from the press.
 *
 * So the wrapper's height is tweened from the old to the new while the incoming step slides in from the
 * side it came from. Two properties, one clock, ~0.4s.
 *
 * ── ⚠ THE OUTGOING HEIGHT CANNOT BE MEASURED HERE ────────────────────────────────────────────────
 * By the time any effect runs, React has already swapped which step is `hidden` — the DOM is showing
 * the NEW step and the old height is gone. A ref updated on the previous run would only be right if
 * nothing else had changed the height since, and plenty does: an error message appearing under a field
 * is a height change with no step change behind it.
 *
 * So the caller reads it at the one moment it is still true — in the handler, immediately before the
 * state update — through `capturePreviousHeight`. A run with nothing captured is a render that was not
 * a step change, and does nothing.
 *
 * ⚠ The wrapper is `overflow: hidden` for the duration. Without it the taller step's overflow paints
 * outside the shrinking box mid-tween, and in the dialog that means content spilling over the sticky
 * action bar it is supposed to pass under.
 */

const HEIGHT_DURATION = 0.38;
const CONTENT_DURATION = 0.42;

/** How far the incoming step travels, in px. Small — this is a hand-off, not a carousel. */
const CONTENT_OFFSET = 20;

/**
 * ⚠ `useLayoutEffect` warns when it is rendered on the server, and this form is: the contact section
 * renders it directly, unlike the dialog and the sheet, which portal only after mount. There is never
 * anything to do before hydration — a first render has no captured height — so falling back to
 * `useEffect` there costs nothing and keeps the console honest.
 */
const useMeasuredEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

interface StepTransitionOptions {
  /** The box holding every step. Its height is what moves. */
  stepsRef: RefObject<HTMLDivElement | null>;
  stepIndex: number;
  /** 1 going forward, -1 coming back — the incoming step enters from the side it came from. */
  direction: 1 | -1;
}

interface StepTransition {
  /** Call in the handler, BEFORE the state update that changes the step. See the header. */
  capturePreviousHeight: () => void;
}

export function useStepTransition({
  stepsRef,
  stepIndex,
  direction,
}: StepTransitionOptions): StepTransition {
  const previousHeightRef = useRef<number | null>(null);

  useMeasuredEffect(() => {
    const steps = stepsRef.current;
    const previousHeight = previousHeightRef.current;
    // Spent on read, so a later render that is not a step change can never replay the last one.
    previousHeightRef.current = null;

    if (!steps || previousHeight === null) return;

    const incomingStep = steps.querySelector<HTMLElement>('.enquiry-step:not([hidden])');
    const nextHeight = steps.offsetHeight;

    if (prefersReducedMotion()) {
      // The step still changes — only the movement is given up. Anything a tween left behind is cleared
      // anyway (the setting can be changed mid-session), or a reduced-motion visitor inherits a step
      // frozen half-slid at whatever opacity it had reached.
      gsap.killTweensOf([steps, incomingStep].filter(Boolean));
      steps.style.removeProperty('height');
      steps.style.removeProperty('overflow');
      if (incomingStep) gsap.set(incomingStep, { clearProps: 'opacity,transform' });
      return;
    }

    if (nextHeight !== previousHeight) {
      gsap.fromTo(
        steps,
        { height: previousHeight },
        {
          height: nextHeight,
          duration: HEIGHT_DURATION,
          ease: 'expo.out',
          // ⚠ `overwrite` matters here: pressing Continue and Back quickly enough starts a second tween
          // on the same property, and two of them competing would leave the wrapper at a height that
          // belongs to neither step.
          overwrite: true,
          onStart: () => {
            steps.style.overflow = 'hidden';
          },
          // Back to `auto`, so an error message appearing later still grows the box.
          onComplete: () => {
            steps.style.removeProperty('height');
            steps.style.removeProperty('overflow');
          },
        },
      );
    }

    if (incomingStep) {
      // ⚠ `opacity`, NOT `autoAlpha` — and this is not a style preference. `autoAlpha` writes
      // `visibility: hidden` at 0, and a visibility-hidden element CANNOT TAKE FOCUS. The step is
      // focused on arrival so its name is announced (see EnquiryForm), and that effect runs while this
      // tween is still sitting on its "from" values, so the focus would silently go nowhere. An element
      // at `opacity: 0` is focusable, which is exactly the difference needed here.
      gsap.fromTo(
        incomingStep,
        { opacity: 0, x: direction * CONTENT_OFFSET },
        {
          opacity: 1,
          x: 0,
          duration: CONTENT_DURATION,
          ease: 'expo.out',
          overwrite: true,
          // Back to no inline styles at all, so `hidden` stays the only thing deciding whether a step
          // is on screen.
          onComplete: () => {
            gsap.set(incomingStep, { clearProps: 'opacity,transform' });
          },
        },
      );
    }
  }, [stepIndex, direction, stepsRef]);

  return {
    capturePreviousHeight: () => {
      previousHeightRef.current = stepsRef.current?.offsetHeight ?? null;
    },
  };
}
