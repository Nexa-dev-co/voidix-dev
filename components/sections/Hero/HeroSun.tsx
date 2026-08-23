'use client';

import { useEffect, useRef } from 'react';
import dynamic from 'next/dynamic';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { measureUntransformedRect } from '@/lib/measureUntransformedRect';
import { REVEAL_EVENT } from '@/components/effects/IntroSequence/introEvents';
import { SUN_CANVAS_HEADROOM } from '@/components/effects/IntroSequence/gatherShader';
import { BLACK_STAGE_EVENT, readBlackStageActive } from '@/lib/blackStageEvent';
import {
  REFRAME_BEGIN_EVENT,
  REFRAME_SETTLE_EVENT,
  startViewportReframeWatch,
} from '@/lib/viewportReframe';
import { notifyViewportResized } from '@/lib/adaptivePixelRatio';
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
// in once it settles. The debounce that defines "done resizing" now lives in `lib/viewportReframe.ts`
// — this file had its own copy of it, on its own timer, alongside its own `ScrollTrigger.refresh()`.
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

      // ── Where the star is, for anything that has to sit relative to it ──
      //
      // ⚠ PUBLISHED RATHER THAN LOOKED UP, and that is the whole reason it exists. The only DOM anchor
      // for "under the sun" is the square's own box — and this function is proof of how carefully that
      // box has to be treated: it is measured with the transform stripped, because reading it live gave
      // a sun that ballooned and drifted. Hanging UI inside it to borrow its position puts a second
      // thing in the one subtree two systems already measure and transform. Two numbers cost nothing
      // and can be read from anywhere.
      //
      // Viewport pixels, exactly like the layer's own placement above. The hero's return control is the
      // only consumer today; it is `position: absolute` inside `.hero-section`, which sits at the
      // viewport origin for the whole time it is on screen.
      const rootStyle = document.documentElement.style;
      rootStyle.setProperty('--hero-square-x', `${rect.left + rect.width / 2}px`);
      rootStyle.setProperty('--hero-square-bottom', `${rect.bottom}px`);
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
    // wait for it to settle, re-place the base box, then fade it back in at the correct spot.
    //
    // ⚠ THE DEBOUNCE AND THE REFRESH ARE BOTH GONE FROM HERE, and both for the same reason: this file
    // was a second owner of them. `lib/viewportReframe.ts` now decides when a resize has finished (the
    // touch height-only rule went with it, and it picked up the minimised-window case on the way), and
    // ScrollTrigger owns its own refresh — this used to call `ScrollTrigger.refresh()` on a 180 ms
    // timer while GSAP's `_resizeDelay` fired one at 200 ms, so every resize refreshed the pin twice,
    // 20 ms apart. That is not merely wasteful now that a refresh re-anchors the whole journey and
    // re-arms snapping: see `useHeroAnimation`'s reframe block.
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

    const onReframeBegin = () => {
      if (introDone && !hidden) hideSun();
    };

    // ⚠ ONE FUNCTION FOR TWO SIGNALS, BECAUSE THEIR ORDER IS NOT DEFINED. The reframe settle is a
    // `setTimeout` and GSAP's refresh is a ticker-driven `delayedCall`, both at 200 ms, so either can
    // land first — and the sun needs whichever arrives last to have re-placed it. Idempotent: a second
    // `syncToSquare` writes the same numbers and `showSun` on an already-shown layer is a no-op.
    //
    // Hanging it on the refresh as well as the settle is also the belt for the case the settle cannot
    // cover: a touch device whose height changed more than a quarter of the viewport refreshes the pin
    // (GSAP's `ignoreMobileResize` threshold) without the reframe watch calling it a resize at all.
    //
    // ⚠ `hidden`, not `introDone`, gates the show — and it is not a tidy-up. `showSun` puts a
    // `transition: opacity` on the layer, and this now runs on refreshes that had nothing to do with a
    // resize (the pin's own creation, `load`, a late font). Writing that transition onto a layer whose
    // opacity `IntroSequence` is tweening would leave a CSS transition smearing every GSAP frame of it.
    // Only ever put back what this file took away.
    const settleSun = () => {
      syncToSquare();
      if (hidden) requestAnimationFrame(showSun);
    };

    // ── ⚠ AND THE PIXEL BUDGET, WHICH IS NOT THIS COMPONENT'S BUSINESS BUT HAS NOWHERE BETTER ──
    //
    // `MAX_DRAWING_BUFFER_MEGAPIXELS` is solved from the viewport ONCE, at load. Open the site in a
    // small window, go full screen, and the ceiling that stands between a dense panel and a 700 MB
    // render target was computed for a frame a fraction of the size. It has to be re-solved when the
    // window changes, and the settle is the moment to do it.
    //
    // It lives here because this component already owns the reframe watch on this page and the call is
    // one line to a module with no opinion about who makes it — a scene hook would be a worse home,
    // since there are three of them and the budget is shared. If a fourth consumer ever appears, move
    // this to whoever mounts unconditionally.
    const onReframeSettleBudget = () => notifyViewportResized();
    window.addEventListener(REFRAME_SETTLE_EVENT, onReframeSettleBudget);

    const stopReframeWatch = startViewportReframeWatch();
    window.addEventListener(REFRAME_BEGIN_EVENT, onReframeBegin);
    window.addEventListener(REFRAME_SETTLE_EVENT, settleSun);
    ScrollTrigger.addEventListener('refresh', settleSun);

    // ── ⚠ AND ANYTHING ELSE THAT MOVES THE SQUARE ──
    //
    // `resize` is not the only thing that re-lays-out the hero, and the sun coming adrift of its square
    // is one of the ugliest failures this page has: the star simply hangs beside the black box. It has
    // happened twice, both times from a sibling appearing AFTER this measured — a control rendered into
    // the hero's flex column, and a phone-only readout strip that mounted once a viewport hook resolved.
    // Neither fires `resize`, so the sun kept the box it had been given and the square moved out from
    // under it.
    //
    // ⚠ OBSERVING THE SQUARE ALONE DOES NOT CATCH THAT, and it is worth writing down because it is the
    // obvious thing to reach for. A ResizeObserver reports SIZE, not position — and in both failures the
    // square never changed size, it was pushed DOWN the column. What changes size is whatever is between
    // it and the section: `.hero-main` is `flex: 1`, so any sibling appearing or leaving resizes it, and
    // `.hero-title-group` resizes whenever the headline itself reflows (a late font swap, a copy edit).
    // All three are observed, because a square cannot move without one of them changing shape.
    //
    // Deliberately NOT routed through `handleResize`'s hide-and-settle: that dance exists because a live
    // window drag updates this box and the pin's transform on different cadences and the sun skids
    // between them. A one-off reflow has no such contest; it just needs the new number.
    const squareWatcher =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => syncToSquare());
    if (squareWatcher) {
      [
        HERO_SQUARE_SELECTOR,
        '.hero-main',
        '.hero-title-group',
      ].forEach((selector) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (element) squareWatcher.observe(element);
      });
    }

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
      window.removeEventListener(REFRAME_BEGIN_EVENT, onReframeBegin);
      window.removeEventListener(REFRAME_SETTLE_EVENT, settleSun);
      window.removeEventListener(REFRAME_SETTLE_EVENT, onReframeSettleBudget);
      ScrollTrigger.removeEventListener('refresh', settleSun);
      stopReframeWatch();
      squareWatcher?.disconnect();
      window.removeEventListener(BLACK_STAGE_EVENT, onBlackStage);
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
