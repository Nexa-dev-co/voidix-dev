'use client';

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import {
  LOOP_COVERED_EVENT,
  LOOP_PROGRESS_EVENT,
  LOOP_RESET_EVENT,
  LOOP_REVERSE_BEGIN_EVENT,
  LOOP_REVERSE_COVERED_EVENT,
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

// ── The reverse's iris ──
// Radii are gradient-line percentages, so 100 reaches the farthest corner of the frame.
/** Wide enough to be entirely off-frame, so the cover reads as absent rather than as a ring at the edge. */
const IRIS_OPEN_RADIUS = 112;
/**
 * The soft shoulder between clear and black.
 *
 * ⚠ IT SCALES WITH THE APERTURE, AND THAT IS A BUG FIX RATHER THAN A REFINEMENT. Held at a constant
 * width, the closed state is `transparent 0%, black 9%` — which is not black at all, it is black with a
 * hole punched through the middle of the screen. The cover never closed: you could watch the site
 * through it for the whole return. Multiplied by the aperture it collapses to `transparent 0%, black 0%`
 * at the end, which is opaque everywhere.
 */
const IRIS_FEATHER = 9;
/** Slower than the forward loop's flood — this is a departure, and a departure that happens in a
    second reads as a glitch rather than as a decision the visitor made. */
const IRIS_CLOSE_SECONDS = 1.3;
/** Unhurried too, because what it uncovers IS the shot: the hole under full lensing, arriving already
    zoomed in. The pin's zoom-out starts the moment the jump lands, so this opens ONTO the motion rather
    than before it — the first thing the eye catches is the lensing already relaxing. */
const IRIS_OPEN_SECONDS = 0.9;
/** A beat of full black at the pivot, so the two halves read as one gesture rather than a bounce. */
const IRIS_HOLD_SECONDS = 0.3;

export default function LoopVeil() {
  const blackRef = useRef<HTMLDivElement>(null);
  const creamRef = useRef<HTMLDivElement>(null);
  const irisRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const black = blackRef.current;
    const cream = creamRef.current;
    const iris = irisRef.current;
    if (!black || !cream || !iris) return;

    const reduceMotion = prefersReducedMotion();
    let creamTimeline: gsap.core.Timeline | null = null;

    /**
     * ⚠ The dive has completed and this veil owns the screen outright until it hands it back.
     *
     * Everything else on the site is a pure function of its crossing's progress, and un-plays when the
     * teleport throws that progress back to 0. This is the one thing that must NOT — it is the cover
     * the un-playing happens behind.
     *
     * And the teleport reports 0 through the dive BEFORE it fires LOOP_RESET (it has to: every scene
     * snaps `current = target`, and the targets arrive with that report). So without this latch the
     * black is dropped one statement before the cream is asked to start, and the flood grows from
     * `circle(0%)` over a hero that is already fully on screen — which is exactly the "hero first,
     * flood second" the loop was meant to hide. Latched here rather than fixed by reordering, because
     * ordering is a timing fix and this needs to hold by construction.
     */
    let coveringLoop = false;

    /**
     * ⚠ ITS OWN TIMELINE, AND SHARING ONE WITH THE CREAM WAS A REAL DEFECT.
     *
     * `onLoopProgress`'s `progress <= 0` branch kills `creamTimeline` — correctly, because scrolling back
     * out of a dive has to clear a half-played arrival. The iris ran on that same variable, so the first
     * dive report of 0 to arrive during a return killed the cover mid-gesture and left the black frozen
     * on screen with no way to clear it. Two covers, two timelines, and neither can reach the other.
     */
    let irisTimeline: gsap.core.Timeline | null = null;


    // 0..1 inside a window, clamped flat outside it.
    const windowed = (range: [number, number], value: number) =>
      gsap.utils.clamp(0, 1, (value - range[0]) / (range[1] - range[0]));

    const onLoopProgress = (event: Event) => {
      if (coveringLoop) return;
      const progress = readLoopProgress(event);
      gsap.set(black, { autoAlpha: windowed(VEIL_BLACK_IN, progress) });
      // Reaching the end of the dive IS the teleport — `applyContactToHeroLoop` dispatches this and
      // then jumps on the next statement — so from here the screen is ours until the cream has cleared.
      if (progress >= 1) {
        coveringLoop = true;
        return;
      }
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
          // The cream has cleared onto a hero that is already built. Hand the screen back — the next
          // dive drives the black from its progress again, as an ordinary crossing.
          coveringLoop = false;
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

    /**
     * ── The cover for the loop run BACKWARDS, and it is a different gesture in every respect ────────
     *
     * Not the cream, and not a flood. Forward, the cream is what you ARRIVE out of — a colour growing
     * from the middle onto a page that is already that colour. Backwards you are going the other way,
     * to the hole, so:
     *
     *   · it is BLACK, because black is what is at the other end. Flooding cream to leave for a black
     *     hole announces the wrong destination.
     *   · it closes INWARD, from the edges to the middle — the frame being pulled shut around the point
     *     you are about to fall through — and then opens from that same point onto the hole itself.
     *
     * ⚠ An IRIS, therefore, and not `clip-path: circle()`. The shape that is wanted is a rectangle with
     * a hole in it, which `circle()` cannot express (it fills the circle, this needs the inverse). A
     * radial-gradient MASK can, so the mask string is written per frame from a tweened proxy — the same
     * technique, for the same reason, as `SectionJumpVeil`'s.
     *
     * ⚠ The order inside the `call` is the contract with the pin and cannot be rearranged: the dispatch
     * teleports the pin SYNCHRONOUSLY, so by the line after it the dive is parked and every scene has
     * been told to be there. Releasing the latch after that is what lets the dive's own progress take
     * the flat black layer back over — and at the parking depth it asks for 0, because the point of
     * that depth is that the hole is on screen rather than blacked out.
     */
    // 1 = wide open (the cover is off-frame), 0 = shut (the frame is solid black).
    const irisAperture = { openness: 1 };
    const writeIris = () => {
      const clear = irisAperture.openness * IRIS_OPEN_RADIUS;
      // ⚠ The shoulder scales with the aperture so that a shut iris is genuinely shut — see IRIS_FEATHER.
      const solid = clear + IRIS_FEATHER * irisAperture.openness;
      const image = `radial-gradient(circle at 50% 50%, rgba(0,0,0,0) ${clear}%, rgba(0,0,0,1) ${solid}%)`;
      iris.style.setProperty('mask-image', image);
      iris.style.setProperty('-webkit-mask-image', image);
    };

    const onReverseBegin = () => {
      irisTimeline?.kill();
      irisAperture.openness = 1;
      writeIris();
      gsap.set(iris, { autoAlpha: 1 });

      irisTimeline = gsap.timeline({
        onComplete: () => {
          irisTimeline = null;
        },
      });
      // 1 · The frame closes around the middle.
      irisTimeline.to(irisAperture, {
        openness: 0,
        duration: reduceMotion ? 0 : IRIS_CLOSE_SECONDS,
        ease: 'power2.inOut',
        onUpdate: writeIris,
      });
      // 2 · Solid black. The jump happens here, unwatched, and the pin arms its zoom-out in the same
      //     synchronous call — so the frame this uncovers is already the lensed, zoomed-in hole.
      irisTimeline.call(() => {
        window.dispatchEvent(new Event(LOOP_REVERSE_COVERED_EVENT));
      });
      // 3 · …and opens again from the same point, onto it.
      irisTimeline.to(irisAperture, {
        openness: 1,
        duration: reduceMotion ? 0 : IRIS_OPEN_SECONDS,
        ease: 'power2.out',
        delay: reduceMotion ? 0 : IRIS_HOLD_SECONDS,
        onUpdate: writeIris,
      });
      irisTimeline.set(iris, { autoAlpha: 0 });
    };
    window.addEventListener(LOOP_REVERSE_BEGIN_EVENT, onReverseBegin);

    return () => {
      window.removeEventListener(LOOP_PROGRESS_EVENT, onLoopProgress);
      window.removeEventListener(LOOP_RESET_EVENT, onLoopReset);
      window.removeEventListener(LOOP_REVERSE_BEGIN_EVENT, onReverseBegin);
      creamTimeline?.kill();
      irisTimeline?.kill();
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
      {/* The reverse's iris. Last, so it covers the other two while it is up — the reverse begins on a
          cream hero and has to hide that, not blend with it. */}
      <div ref={irisRef} className="loop-veil loop-veil-iris" aria-hidden />
    </>
  );
}
