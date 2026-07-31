'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import {
  LOOP_COVERED_EVENT,
  LOOP_PROGRESS_EVENT,
  LOOP_RESET_EVENT,
  readLoopProgress,
} from '@/lib/loopEvents';

/**
 * The cover the loop's teleport happens behind, and the cream it comes back out of.
 *
 * ── Why a veil at all, when the black hole already goes black ─────────────────────────────────────
 * The dive's darkness is real and does the artistic work: the lensing pass grows the horizon's shadow
 * until it owns the frame, so what you watch is the hole swallowing the picture rather than a curtain
 * coming down. But "owns the frame" is a shader reaching for black through a tone curve, over a
 * starfield, at whatever exposure the adaptive tier settled on — it is *nearly* black, and nearly is
 * not a guarantee.
 *
 * And the thing underneath needs a guarantee. At the instant of the teleport EVERY scrubbed value on the
 * site snaps from its bottom-of-page state to its top-of-page one in a single frame. One row of pixels
 * of that showing is the whole illusion gone.
 *
 * So: the shadow does the fall, and this makes it certain. Belt and braces, deliberately.
 *
 * ── And then the cream ──
 * The hero's background is cream (#e2dfd2), so the arrival is this veil flooding to that colour and then
 * fading out onto a page that is already exactly it — there is no cross-fade and no seam to hide.
 *
 * The flood's edge is displaced by an SVG turbulence filter rather than swept cleanly, which is what
 * makes it read as liquid. NOT WebGL: this is the worst frame on the site to ask for a third GL context
 * — the works field is being torn down and the sun canvas is re-assembling in the same second.
 */

/** Where in the dive the veil starts helping. Late: the shader's shadow should be doing the work. */
const VEIL_BLACK_IN: [number, number] = [0.82, 0.97];
/** Seconds the cream takes to flood the frame after the jump. */
const CREAM_FLOOD_SECONDS = 1.15;
/** …and then to clear, revealing the hero underneath — which is the same colour, so this is seamless. */
const CREAM_CLEAR_SECONDS = 0.7;
/** A beat of held cream before it clears, so the flood lands rather than passing straight through. */
const CREAM_HOLD_SECONDS = 0.25;

export default function LoopVeil() {
  const blackRef = useRef<HTMLDivElement>(null);
  const creamRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const black = blackRef.current;
    const cream = creamRef.current;
    if (!black || !cream) return;

    const reduceMotion = prefersReducedMotion();
    let creamTimeline: gsap.core.Timeline | null = null;

    // 0..1 inside a window, clamped flat outside it.
    const windowed = (range: [number, number], value: number) =>
      gsap.utils.clamp(0, 1, (value - range[0]) / (range[1] - range[0]));

    const onLoopProgress = (event: Event) => {
      const progress = readLoopProgress(event);
      gsap.set(black, { autoAlpha: windowed(VEIL_BLACK_IN, progress) });
      // Scrolling back OUT of the dive has to clear the cream as well as the black, or a half-played
      // arrival would be left painted over a contact section the visitor has returned to.
      if (progress <= 0) {
        creamTimeline?.kill();
        creamTimeline = null;
        gsap.set(cream, { autoAlpha: 0, clipPath: 'circle(0% at 50% 50%)' });
      }
    };
    window.addEventListener(LOOP_PROGRESS_EVENT, onLoopProgress);

    const onLoopReset = () => {
      creamTimeline?.kill();
      // The flood grows from the middle — the point you just fell through — rather than wiping across.
      gsap.set(cream, { autoAlpha: 1, clipPath: 'circle(0% at 50% 50%)' });

      creamTimeline = gsap.timeline({
        onComplete: () => {
          creamTimeline = null;
        },
      });
      creamTimeline.to(cream, {
        // 75% of the diagonal covers the corners from the centre on any aspect.
        clipPath: 'circle(75% at 50% 50%)',
        duration: reduceMotion ? 0 : CREAM_FLOOD_SECONDS,
        ease: 'power2.inOut',
      });
      // The black is under the cream, so it can only be dropped once the cream has covered it.
      creamTimeline.set(black, { autoAlpha: 0 });
      // The screen is ours now — the hero can start building itself underneath. Announced from here
      // rather than timed from the pin, because only this knows when the cover actually closed.
      creamTimeline.call(() => {
        window.dispatchEvent(new Event(LOOP_COVERED_EVENT));
      });
      creamTimeline.to(cream, {
        autoAlpha: 0,
        duration: reduceMotion ? 0 : CREAM_CLEAR_SECONDS,
        ease: 'power2.out',
        delay: reduceMotion ? 0 : CREAM_HOLD_SECONDS,
      });
    };
    window.addEventListener(LOOP_RESET_EVENT, onLoopReset);

    return () => {
      window.removeEventListener(LOOP_PROGRESS_EVENT, onLoopProgress);
      window.removeEventListener(LOOP_RESET_EVENT, onLoopReset);
      creamTimeline?.kill();
    };
  }, []);

  return (
    <>
      {/*
        The turbulence that makes the flood's edge crawl. Rendered once, referenced by CSS `filter` —
        a displacement map on a clip-path edge is the cheapest liquid there is, and it costs nothing at
        all while the veil is hidden.
      */}
      <svg className="loop-veil-defs" aria-hidden focusable="false">
        <filter id="loop-veil-liquid">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.014 0.021"
            numOctaves={2}
            seed={7}
            result="noise"
          />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale={70} xChannelSelector="R" yChannelSelector="G" />
        </filter>
      </svg>

      <div ref={blackRef} className="loop-veil loop-veil-black" aria-hidden />
      <div ref={creamRef} className="loop-veil loop-veil-cream" aria-hidden />
    </>
  );
}
