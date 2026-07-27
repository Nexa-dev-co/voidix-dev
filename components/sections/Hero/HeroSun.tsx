'use client';

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { measureUntransformedRect } from '@/lib/measureUntransformedRect';
import { REVEAL_EVENT } from '@/components/effects/IntroSequence/introEvents';
import { DECK_REVEAL_EVENT, DECK_HIDE_EVENT } from '@/components/sections/ServicesDeck/deckEvents';

// The single sun for the whole page. It lives here (not in the hero card and not in the loader) so
// exactly one WebGL sun exists: the intro flies it from the loader "o" into the hero square, then
// scroll expands it.
//
// This is now the real fractured_sun model rather than the old procedural plasma shader, so the page and
// /sun-lab share one sun and the lab's presets can drive it.
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
      layer.style.width = `${rect.width}px`;
      layer.style.height = `${rect.height}px`;
      layer.style.left = `${rect.left}px`;
      layer.style.top = `${rect.top}px`;
    };
    syncToSquare();

    // After the intro hands the sun over it stays visible (opacity:1). Track that so the resize
    // fade only runs post-intro and never fights the intro's own opacity animation.
    let introDone = false;
    const onReveal = () => {
      layer.style.zIndex = String(Z_AFTER_INTRO);
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

    // Services-only: when the fleet reveals, drop the sun behind the hero (so ships + labels sit
    // in front) and swell it into a big background; reverse it when the fleet hides. The faster
    // churn / explosions live in SunCanvas, which listens to the same events.
    const onServicesEnter = () => {
      layer.style.zIndex = String(Z_SERVICES);
      if (flight) {
        gsap.to(flight, {
          scale: SERVICES_SUN_SCALE,
          duration: SERVICES_SUN_RAMP_SECONDS,
          ease: 'power2.inOut',
          overwrite: true,
        });
      }
    };
    const onServicesLeave = () => {
      layer.style.zIndex = String(Z_AFTER_INTRO);
      if (flight) {
        gsap.to(flight, {
          scale: 1,
          duration: SERVICES_SUN_RAMP_SECONDS,
          ease: 'power2.inOut',
          overwrite: true,
        });
      }
    };
    window.addEventListener(DECK_REVEAL_EVENT, onServicesEnter);
    window.addEventListener(DECK_HIDE_EVENT, onServicesLeave);

    return () => {
      window.removeEventListener(REVEAL_EVENT, onReveal);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener(DECK_REVEAL_EVENT, onServicesEnter);
      window.removeEventListener(DECK_HIDE_EVENT, onServicesLeave);
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
      <div
        ref={flightRef}
        className="hero-sun-flight"
        style={{ width: '100%', height: '100%', transformOrigin: 'center center', willChange: 'transform' }}
      >
        <SunCanvas />
      </div>
    </div>
  );
}
