import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import {
  TEXT_OUT_DURATION,
  TEXT_OUT_STAGGER,
  TEXT_IN_DURATION,
  TEXT_IN_STAGGER,
  TEXT_EXIT_SHIFT_PERCENT,
  TEXT_ENTER_SHIFT_PERCENT,
  TEXT_SHEAR_DEGREES,
  TEXT_IN_AT_SECONDS,
} from '../worksTransition';

/**
 * The works overlay's project-change shear.
 *
 * ── Why the displayed index lags ─────────────────────────────────────────────────────────────────
 * The copy used to be a `key`ed element running a CSS entrance animation, which meant React replaced
 * the content the instant the index changed — there was never an outgoing element left to animate. To
 * play text OUT before the new text comes in, the DOM has to keep showing the old project until the
 * exit has finished. So the hook owns a `displayedIndex` that trails `activeIndex`, and the component
 * renders from that.
 *
 * ── Why it's two effects and not one timeline ────────────────────────────────────────────────────
 * The entrance must not start until React has actually committed the new copy to the DOM. Driving
 * both halves from a single GSAP timeline would mean tweening whatever text happened to be rendered
 * when the playhead got there — correct only by luck of React's flush timing. Instead the exit's
 * `onComplete` advances `displayedIndex`, and a second effect keyed on that plays the entrance. Each
 * half is therefore guaranteed to be animating the content it belongs to.
 *
 * ── Direction ────────────────────────────────────────────────────────────────────────────────────
 * See worksTransition.ts: each block flows one way for the whole transition (out to its own edge, in
 * from the centre), so the change reads as advancing rather than as a rewind.
 */

interface WorksTextTransitionOptions {
  /** The left-hand block (eyebrow + section title). */
  leftRef: RefObject<HTMLElement | null>;
  /** The right-hand block (the active project's detail). */
  rightRef: RefObject<HTMLElement | null>;
  /** The project the pin has committed to — may be ahead of what's on screen. */
  activeIndex: number;
}

/** The lines a block animates: its direct children, so each block staggers its own rows. */
const linesOf = (block: HTMLElement | null): HTMLElement[] =>
  block ? (Array.from(block.children) as HTMLElement[]) : [];

export function useWorksTextTransition({
  leftRef,
  rightRef,
  activeIndex,
}: WorksTextTransitionOptions): number {
  const [displayedIndex, setDisplayedIndex] = useState(activeIndex);
  // The first render is the section's own reveal (the hero pin fades the whole overlay in), not a
  // project change — so it must not shear. Both effects skip until a real change has been seen.
  const hasChangedRef = useRef(false);

  // ── Exit ──
  useEffect(() => {
    if (activeIndex === displayedIndex) return;

    if (prefersReducedMotion()) {
      setDisplayedIndex(activeIndex);
      return;
    }

    hasChangedRef.current = true;
    const exitTimeline = gsap.timeline({
      onComplete: () => setDisplayedIndex(activeIndex),
    });

    // Both blocks leave on the same beat, each toward its own edge.
    exitTimeline
      .to(linesOf(leftRef.current), {
        xPercent: -TEXT_EXIT_SHIFT_PERCENT,
        skewX: TEXT_SHEAR_DEGREES,
        autoAlpha: 0,
        duration: TEXT_OUT_DURATION,
        stagger: TEXT_OUT_STAGGER,
        ease: 'power3.in',
        overwrite: true,
      }, 0)
      .to(linesOf(rightRef.current), {
        xPercent: TEXT_EXIT_SHIFT_PERCENT,
        skewX: TEXT_SHEAR_DEGREES,
        autoAlpha: 0,
        duration: TEXT_OUT_DURATION,
        stagger: TEXT_OUT_STAGGER,
        ease: 'power3.in',
        overwrite: true,
      }, 0);

    return () => {
      exitTimeline.kill();
    };
  }, [activeIndex, displayedIndex, leftRef, rightRef]);

  // ── Entrance ──
  // Layout effect so the incoming lines are placed off-screen in the same frame React paints them —
  // a plain effect would let one frame through with the new copy sitting at its rest position.
  useLayoutEffect(() => {
    const leftLines = linesOf(leftRef.current);
    const rightLines = linesOf(rightRef.current);
    const allLines = [...leftLines, ...rightLines];
    if (allLines.length === 0) return;

    // First paint, or reduced motion: just sit at rest. Clearing the props rather than setting them
    // to zero leaves the stylesheet in charge, so nothing carries an inline transform it didn't need.
    if (!hasChangedRef.current || prefersReducedMotion()) {
      gsap.set(allLines, { clearProps: 'transform,opacity,visibility' });
      return;
    }

    // The exit ended a little before the rock swaps; hold the gap so the copy returns after it, not
    // during it. See the schedule in worksTransition.ts. The exit's real length is set by whichever
    // block has the MOST lines, since the two stagger in parallel — averaging them would start the
    // entrance early and overlap the re-carve.
    const longestBlockLines = Math.max(leftLines.length, rightLines.length);
    const outEnd = TEXT_OUT_DURATION + TEXT_OUT_STAGGER * Math.max(longestBlockLines - 1, 0);
    const holdSeconds = Math.max(TEXT_IN_AT_SECONDS - outEnd, 0);

    const enterTimeline = gsap.timeline({ delay: holdSeconds });
    const enter = (lines: HTMLElement[], fromPercent: number) =>
      gsap.fromTo(
        lines,
        { xPercent: fromPercent, skewX: TEXT_SHEAR_DEGREES, autoAlpha: 0 },
        {
          xPercent: 0,
          skewX: 0,
          autoAlpha: 1,
          duration: TEXT_IN_DURATION,
          stagger: TEXT_IN_STAGGER,
          ease: 'power3.out',
          overwrite: true,
          // Drop the inline transform once it's home, so the resting text is exactly what the
          // stylesheet says it is — a left-over `skewX(0)` still forces a composited layer.
          clearProps: 'transform',
        },
      );

    // Each block continues the direction it left in, which means both arrive from the centre.
    enterTimeline
      .add(enter(leftLines, TEXT_ENTER_SHIFT_PERCENT), 0)
      .add(enter(rightLines, -TEXT_ENTER_SHIFT_PERCENT), 0);

    return () => {
      enterTimeline.kill();
    };
  }, [displayedIndex, leftRef, rightRef]);

  return displayedIndex;
}
