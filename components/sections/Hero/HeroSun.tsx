'use client';

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { measureUntransformedRect } from '@/lib/measureUntransformedRect';
import { REVEAL_EVENT } from '@/components/effects/IntroSequence/introEvents';
import { SUN_CANVAS_HEADROOM } from '@/components/effects/IntroSequence/gatherShader';
import { BLACK_STAGE_EVENT, readBlackStageActive } from '@/lib/blackStageEvent';
import { useSunParallax } from './hooks/useSunParallax';

// The single sun for the whole page. It lives here (not in the hero card and not in the loader) so
// exactly one WebGL sun exists: the intro flies it from the loader "o" into the hero square, then
// scroll expands it.
//
// This is the real fractured_sun model rather than the old procedural plasma shader.
const SunCanvas = dynamic(() => import('./SunModelCanvas'), { ssr: false });

const HERO_SQUARE_SELECTOR = '.hero-sun-card';
const Z_DURING_INTRO = 10001; // above the loader veil (10000) so the sun shows in the "o"
const Z_AFTER_INTRO = 9500; //   above the fluid cursor (9000/9001), below the navbar (9999)
// In the services section the sun drops BEHIND the hero so the fleet + labels sit in front of
// it (the intervening layers go transparent via .is-services — see globals.css).
const Z_SERVICES = -1;

// Services-only: the sun drops behind the fleet but keeps its normal size (no swell) — only
// its churn/energy changes (in SunCanvas). SERVICES_SUN_SCALE stays a knob if a swell is ever
// wanted again; at 1 the services sun matches the hero sun's size.
const SERVICES_SUN_SCALE = 1;
const SERVICES_SUN_RAMP_SECONDS = 1.1;

// Resize handling: hide the sun while the window is being resized, then re-place + fade it back
// in once it settles. RESIZE_SETTLE_MS is the debounce that defines "done resizing".
const RESIZE_SETTLE_MS = 180;
const RESIZE_FADE_SECONDS = 0.35;

export default function HeroSun() {
  const layerRef = useRef<HTMLDivElement>(null);
  const flightRef = useRef<HTMLDivElement>(null);
  const parallaxRef = useRef<HTMLDivElement>(null);

  // The works camera's drag-to-look, applied to the star (see hooks/useSunParallax).
  useSunParallax(parallaxRef, layerRef);

  useEffect(() => {
    const layer = layerRef.current;
    const flight = flightRef.current;
    if (!layer) return;

    // Keep the outer layer parked over the hero square's footprint. The inner
    // element (intro) and this layer (scroll) animate from here.
    const syncToSquare = () => {
      const square = document.querySelector<HTMLElement>(HERO_SQUARE_SELECTOR);
      if (!square) return;
      // Measure the square's *untransformed* footprint. Its scroll transform scales it up to
      // fill the screen, and getBoundingClientRect includes that — reading it mid-scroll is what
      // made the sun balloon and drift out of the square on resize. The sun's own rise/scale is
      // applied separately by the hero pin, so the layer only needs the square's base box.
      const rect = measureUntransformedRect(square);
      // Padded well beyond the square, and CENTRED on it. The star renders the same size inside
      // (SunModelCanvas pulls its camera back by the same factor) — the extra pixels exist purely so
      // the bloom and the orbiting ring have somewhere to fade out. Sized to the square exactly, any
      // glow reaching the edge got cut flat and drew a rectangle around the sun.
      // The layer is transparent and pointer-events:none, so the overlap costs nothing.
      const width = rect.width * SUN_CANVAS_HEADROOM;
      const height = rect.height * SUN_CANVAS_HEADROOM;
      layer.style.width = `${width}px`;
      layer.style.height = `${height}px`;
      layer.style.left = `${rect.left - (width - rect.width) / 2}px`;
      layer.style.top = `${rect.top - (height - rect.height) / 2}px`;
    };
    syncToSquare();

    // ── Which side of the canvas the sun sits on. ONE owner. ──
    // Resolved through a single function rather than written from each listener directly. Kept that way
    // after a chamber listener was briefly added here and wrote the SERVICES rank whenever reveal
    // progress was 0 — which the pin publishes on its very FIRST update, so the star was buried behind
    // the hero's cream background before the visitor had scrolled at all. Anything that wants a say in
    // this must go through `applyZIndex`, never `layer.style.zIndex`.
    let baseZIndex = Z_DURING_INTRO;
    const applyZIndex = () => {
      layer.style.zIndex = String(baseZIndex);
    };

    // After the intro hands the sun over it stays visible (opacity:1). Track that so the resize
    // fade only runs post-intro and never fights the intro's own opacity animation.
    let introDone = false;
    const onReveal = () => {
      baseZIndex = Z_AFTER_INTRO;
      applyZIndex();
      introDone = true;
    };
    window.addEventListener(REVEAL_EVENT, onReveal);


    // Keeping the sun perfectly locked to the square *during* a live resize is a losing battle —
    // the square's base box (here) and the pin's scroll transform (ScrollTrigger) update on
    // different cadences, so the sun visibly skids. Instead: hide it the instant a resize starts,
    // wait for it to settle (debounce), refresh the pin + re-place the base box, then fade it back
    // in at the correct spot. On touch devices we ignore height-only resizes (the address bar
    // showing/hiding) so the sun doesn't blink on every scroll.
    const prefersCoarsePointer = window.matchMedia('(pointer: coarse)').matches;
    let lastWidth = window.innerWidth;
    let settleTimer = 0;
    let hidden = false;

    const hideSun = () => {
      layer.style.transition = 'none';
      layer.style.opacity = '0';
      hidden = true;
    };
    const showSun = () => {
      layer.style.transition = `opacity ${RESIZE_FADE_SECONDS}s ease`;
      layer.style.opacity = '1';
      hidden = false;
    };

    const handleResize = () => {
      const widthChanged = window.innerWidth !== lastWidth;
      lastWidth = window.innerWidth;
      // Mirror ScrollTrigger's ignoreMobileResize: a phone address bar fires height-only resizes
      // on almost every scroll — don't blink the sun for those.
      if (prefersCoarsePointer && !widthChanged) return;

      if (introDone && !hidden) hideSun();

      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => {
        // Recompute the pin's fill transform for the new size, re-place the base box, THEN show —
        // so the sun only ever reappears once everything is consistent again.
        ScrollTrigger.refresh();
        syncToSquare();
        if (introDone) requestAnimationFrame(showSun);
      }, RESIZE_SETTLE_MS);
    };
    window.addEventListener('resize', handleResize);

    // While a full-black scene is on screen the sun drops BEHIND the hero, so the fleet, the marks and
    // their labels all sit in front of it (the intervening layers go transparent via .is-services). It
    // comes back to the front when the page returns to the hero.
    //
    // ⚠ Driven by the BLACK STAGE, not by the deck's reveal. Those were interchangeable only while the
    // fleet was guaranteed to be the first black scene reached — a navbar jump goes straight from the
    // hero to works without entering it, and the star then stayed at its hero rank, painting in FRONT
    // of the mark. See lib/blackStageEvent.ts.
    const onBlackStage = (event: Event) => {
      const active = readBlackStageActive(event);
      baseZIndex = active ? Z_SERVICES : Z_AFTER_INTRO;
      applyZIndex();
      if (!flight) return;
      gsap.to(flight, {
        scale: active ? SERVICES_SUN_SCALE : 1,
        duration: SERVICES_SUN_RAMP_SECONDS,
        ease: 'power2.inOut',
        overwrite: true,
      });
    };
    window.addEventListener(BLACK_STAGE_EVENT, onBlackStage);

    return () => {
      window.removeEventListener(REVEAL_EVENT, onReveal);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener(BLACK_STAGE_EVENT, onBlackStage);
      window.clearTimeout(settleTimer);
    };
  }, []);

  return (
    <div
      ref={layerRef}
      className="hero-sun-layer"
      aria-hidden
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: 175,
        height: 175,
        zIndex: Z_DURING_INTRO,
        opacity: 0,
        pointerEvents: 'none',
        transformOrigin: 'center center',
      }}
    >
      {/* Between the pin's transform (outer) and the intro's (inner), because both of those are
          already owned. Carries only the works camera's drag-to-look — see hooks/useSunParallax.
          No `will-change` on purpose: the flight inside it is already promoted, so this only ever
          moves an existing compositor layer, and a second permanent hint would cost more than it saves. */}
      <div
        ref={parallaxRef}
        className="hero-sun-parallax"
        style={{ width: '100%', height: '100%', transformOrigin: 'center center' }}
      >
        <div
          ref={flightRef}
          className="hero-sun-flight"
          style={{ width: '100%', height: '100%', transformOrigin: 'center center', willChange: 'transform' }}
        >
          <SunCanvas />
        </div>
      </div>
    </div>
  );
}
