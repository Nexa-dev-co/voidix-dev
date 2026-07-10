import { useCallback, useEffect, useRef, type RefObject } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ScrollToPlugin } from 'gsap/ScrollToPlugin';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { measureUntransformedRect } from '@/lib/measureUntransformedRect';
import { REVEAL_EVENT, INTRO_ACTIVE_EVENT } from '@/components/effects/IntroSequence/introEvents';
import { DECK_REVEAL_EVENT, DECK_HIDE_EVENT, GOTO_SERVICES_EVENT } from '@/components/sections/ServicesDeck/deckEvents';
import { HANDOFF_PROGRESS_EVENT, type HandoffProgressDetail } from '@/lib/handoffEvents';

// Marks the hero while a full-black scene (fleet or works) is on screen. Scopes the layering (sun
// drops behind, intervening hero layers go transparent) so it never touches the fill phase.
const SERVICES_CLASS = 'is-services';

gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);
// A mobile address bar showing/hiding fires a resize on almost every scroll. Don't re-pin /
// re-measure on those vertical-only changes — only on real (width / orientation) ones — or the
// pinned square + sun jitter as you scroll on a phone.
ScrollTrigger.config({ ignoreMobileResize: true });

// ── One pin, one continuous scroll ─────────────────────────────────────
// A single pinned ScrollTrigger owns the whole homepage journey so there's never a second pinned
// section glued on with a seam:
//   phase 1 (scrubbed) — the black square fills the screen, the sun rises
//   at fill = 1         — a carousel of "stops" begins, all on the now-full-black screen:
//     stops 0..craftCount-1        → the services fleet (one craft each)
//     stops craftCount..end        → the works field (one project meteor each)
//   Between the last craft and the first project sits the HANDOFF — a wide scrubbed span where
//   the craft grows, turns and exits screen-right while the meteor field rises beneath it (see
//   the handoff constants below). So the stops are NOT uniformly spaced.
const SCROLL_SCRUB     = 1.8;
const FILL_SCROLL_VH   = 120; // viewport-heights of scroll the square takes to fill
const STAGE_SCROLL_VH  = 100; // ...and per carousel stop after it (a craft, or a project meteor)
const SUN_SCROLL_SCALE = 1.1; // the sun grows to 1.1× as the square fills
const SUN_SCROLL_RISE  = 200; // px the sun lifts above the square's centre and holds

// Overlay reveal / hide, keyed to which stop the carousel is on.
const DECK_REVEAL_DURATION  = 0.6;
const DECK_HIDE_DURATION    = 0.4;
const WORKS_HIDE_DURATION   = 0.4;
const GOTO_DURATION         = 0.6; // programmatic scroll when a label/arrow jumps to a stop
const SNAP_DURATION         = 0.5; // how quickly the carousel settles onto the nearest stop
const SNAP_DURATION_MAX     = 2.2; // long snaps (across the handoff span) glide rather than lurch
// The carousel stops start a touch *past* the fill, so stop 0 lands on the fully revealed fleet
// instead of the fill/transition edge (which read as the section scrolling away).
const CAROUSEL_SETTLE_FRACTION = 0.06;

// ── The services → works handoff ────────────────────────────────────────
// One long scrubbed span between the last craft stop and project 01. The craft's departure and
// the meteor's arrival live in the two WebGL scenes (fed the same 0..1 via HANDOFF_PROGRESS_EVENT);
// here we own the DOM cross-fades, each a window (start..end fraction) inside the span: the deck
// UI drops out first, the field (backdrop + canvas) rises under the still-flying craft, and the
// works UI settles only once the meteor has landed.
// The handoff is auto-played by the snap "chasm" below (one flick carries the user across), so it no
// longer needs to be a long manual scrub — a tighter span keeps the committed glide snappy.
const HANDOFF_SCROLL_VH = 180;
const HANDOFF_CLASS     = 'is-handoff'; // raises the deck over the works field mid-handoff (CSS)
const HANDOFF_DECK_UI_FADE:  [number, number] = [0.05, 0.24];
// The field fades in at the START of the fly-left beat (Phase B) — NOT during the launch (Phase A),
// so the debris + meteor stay hidden while the ship rises up-left off the pad, then the streaking
// stars + debris come in from the left as we fly.
const HANDOFF_FIELD_FADE:    [number, number] = [0.33, 0.55];
const HANDOFF_WORKS_UI_FADE: [number, number] = [0.8, 0.94];

// ── Reveal (runs when the intro lands the sun in the square) ───────────
const TEXT_WIPE_DURATION   = 0.9;
const TEXT_WIPE_STAGGER    = 0.12;
const SQUARE_FILL_DURATION = 1.1; // the "cup filling with water" rise
const SUB_FADE_DURATION    = 0.6;
const FILL_START           = 0.25; // begins just after the headline starts rising
const FULL_CLIP  = 'inset(0% 0 0 0)';
const EMPTY_CLIP = 'inset(100% 0 0 0)';
// If the intro never fires its reveal, reveal anyway. Two nets: a SHORT one for when the intro is
// absent / crashed on mount (recover fast), swapped for a LONG ultimate one the moment the intro
// signals it's alive (INTRO_ACTIVE_EVENT) — because a running intro legitimately holds its reveal
// until assets load (its own ASSET_WAIT_TIMEOUT_MS), so the net must clear that worst case.
const REVEAL_FALLBACK_NO_INTRO_MS = 7000;
const REVEAL_FALLBACK_WITH_INTRO_MS = 20000;

const SUN_LAYER_SELECTOR    = '.hero-sun-layer';
const DECK_SELECTOR         = '.services-deck';
const DECK_OVERLAY_SELECTOR = '.deck-overlay';
const WORKS_SELECTOR        = '.works-field';
const WORKS_OVERLAY_SELECTOR = '.works-overlay';

type Stage = 'fill' | 'services' | 'works';

interface HeroAnimationRefs {
  sectionRef:  RefObject<HTMLElement | null>;
  heroCardRef: RefObject<HTMLDivElement | null>;
  /** Set the craft on the pad — driven by the services stops of the pin. */
  setActiveCraft: (index: number) => void;
  /** How many craft the services carousel cycles through. */
  craftCount: number;
  /** Set the focused project — driven by the works stops of the pin. */
  setActiveProject: (index: number) => void;
  /** How many project meteors the works carousel cycles through. */
  projectCount: number;
}

export function useHeroAnimation(heroAnimationRefs: HeroAnimationRefs) {
  const { sectionRef, heroCardRef, setActiveCraft, craftCount, setActiveProject, projectCount } =
    heroAnimationRefs;

  // Keep the latest setters so the pin (built once at reveal) always calls the current closures.
  const setActiveCraftRef = useRef(setActiveCraft);
  setActiveCraftRef.current = setActiveCraft;
  const setActiveProjectRef = useRef(setActiveProject);
  setActiveProjectRef.current = setActiveProject;

  // The live jump fns live in refs so the returned callbacks stay stable across renders.
  const goToCraftImplRef = useRef<(index: number) => void>((index) =>
    setActiveCraftRef.current(index),
  );
  const goToProjectImplRef = useRef<(index: number) => void>((index) =>
    setActiveProjectRef.current(index),
  );

  useEffect(() => {
    const heroSection     = sectionRef.current;
    const heroCardElement = heroCardRef.current;
    if (!heroSection || !heroCardElement) return;

    const reduceMotion = prefersReducedMotion();

    // The carousel is one flat list of stops: [craft 0..N] then [project 0..M] — but NOT uniformly
    // spaced: normal neighbours sit STAGE_SCROLL_VH apart, while the gap between the last craft and
    // project 0 is the wide handoff span. Lay the stops out in vh first, then map them into the
    // pin's progress space.
    const totalStops = craftCount + projectCount;
    const stopVhOffsets: number[] = [];
    for (let craftStop = 0; craftStop < craftCount; craftStop += 1) {
      stopVhOffsets.push(craftStop * STAGE_SCROLL_VH);
    }
    const handoffStartVh = (craftCount - 1) * STAGE_SCROLL_VH;
    for (let projectStop = 0; projectStop < projectCount; projectStop += 1) {
      stopVhOffsets.push(handoffStartVh + HANDOFF_SCROLL_VH + projectStop * STAGE_SCROLL_VH);
    }
    const carouselVhTotal = stopVhOffsets[stopVhOffsets.length - 1] || 1;
    const totalVh = FILL_SCROLL_VH + carouselVhTotal;
    // The fraction of the pin the square-fill occupies; the carousel owns the rest.
    const fillFraction = FILL_SCROLL_VH / totalVh;
    // Stops sit in [carouselStart, 1] — a touch past the fill so stop 0 isn't on the reveal edge.
    const carouselStart = fillFraction + (1 - fillFraction) * CAROUSEL_SETTLE_FRACTION;
    const carouselSpan  = 1 - carouselStart;
    const stopProgressValues = stopVhOffsets.map(
      (stopVh) => carouselStart + (stopVh / carouselVhTotal) * carouselSpan,
    );
    const handoffStartProgress = stopProgressValues[craftCount - 1];
    const handoffEndProgress   = stopProgressValues[craftCount] ?? 1;
    // Progress span the project stops cover — feeds the navbar "work" meter.
    const worksMeterSpan = stopProgressValues[totalStops - 1] - stopProgressValues[craftCount];

    const textInners  = heroSection.querySelectorAll('.hero-mask-inner');
    const squareFill  = heroSection.querySelector('.hero-sun-fill');
    const subline     = heroSection.querySelector('.hero-sub');
    const sunLayer    = document.querySelector(SUN_LAYER_SELECTOR);
    const deck        = heroSection.querySelector<HTMLElement>(DECK_SELECTOR);
    const deckOverlay = heroSection.querySelector<HTMLElement>(DECK_OVERLAY_SELECTOR);
    const works       = heroSection.querySelector<HTMLElement>(WORKS_SELECTOR);
    const worksOverlay = heroSection.querySelector<HTMLElement>(WORKS_OVERLAY_SELECTOR);

    // 1. Hide everything the reveal/transition will bring in. The intro veil covers
    //    the hero while this runs, so there's no flash.
    gsap.set(textInners, { yPercent: 115 });
    if (subline) gsap.set(subline, { autoAlpha: 0, y: 12 });
    if (squareFill) gsap.set(squareFill, { clipPath: EMPTY_CLIP });
    if (deck) gsap.set(deck, { autoAlpha: 0 });
    if (works) gsap.set(works, { autoAlpha: 0 });

    // ── Stage transitions — which full-black scene is on screen ──
    // The sun's "behind + energised" state is turned on when the fleet first reveals and stays on
    // through works; it's only turned back off (sun forward, calm) when we scroll back to the fill.
    const fade = (element: Element | null, alpha: number, duration: number) => {
      if (!element) return;
      gsap.to(element, {
        autoAlpha: alpha,
        duration:  reduceMotion ? 0 : duration,
        ease:      alpha ? 'power2.out' : 'power2.in',
        overwrite: true,
      });
    };

    let currentStage: Stage = 'fill';
    const enterFill = () => {
      heroSection.classList.remove(SERVICES_CLASS);
      fade(deck, 0, DECK_HIDE_DURATION);
      fade(works, 0, WORKS_HIDE_DURATION);
      // The tagline belongs to the hero only — bring it back when we return to the fill. (It carries
      // an inline opacity from the reveal that beats the .is-services CSS, so it must be driven here.)
      fade(subline, 1, SUB_FADE_DURATION);
      // Return the sun to its calm hero look + front position.
      window.dispatchEvent(new Event(DECK_HIDE_EVENT));
    };
    const enterServices = (fromStage: Stage) => {
      heroSection.classList.add(SERVICES_CLASS);
      fade(deck, 1, DECK_REVEAL_DURATION);
      // Hide the hero tagline ("software with its own gravity") — it's hero-only and would otherwise
      // bleed through the now-transparent works/deck backdrop.
      fade(subline, 0, DECK_REVEAL_DURATION);
      // Coming back down out of works the handoff scrub owns everything — it flies the craft back
      // onto the pad and fades the field away — so replaying the deck entrance would double the
      // motion and yank the returning craft.
      if (fromStage === 'works') return;
      fade(works, 0, WORKS_HIDE_DURATION);
      // Replay the centred craft's entrance + drop the sun behind the fleet / energise it.
      window.dispatchEvent(new Event(DECK_REVEAL_EVENT));
    };
    const enterWorks = () => {
      // Keep the services layering (sun stays behind — the field's opaque backdrop covers it, so
      // no DECK_HIDE here). Every visual of this crossing — deck UI out, field in, craft out,
      // meteor in — is scrubbed from the handoff span, so there is nothing to tween here.
      heroSection.classList.add(SERVICES_CLASS);
      // Keep the hero tagline hidden here too (hero-only).
      fade(subline, 0, DECK_REVEAL_DURATION);
    };
    const setStage = (stage: Stage) => {
      if (stage === currentStage) return;
      const fromStage = currentStage;
      currentStage = stage;
      if (stage === 'fill') enterFill();
      else if (stage === 'services') enterServices(fromStage);
      else enterWorks();
    };

    // ── The handoff scrub ──
    // One 0..1 value across the services→works span drives everything: the DOM cross-fades here,
    // and — via the event — the craft's departure (deck scene) + the meteor's arrival (field
    // scene). Runs on every pin update so snaps and programmatic jumps land in the right state.
    const fadeWindow = (fadeRange: [number, number], value: number) =>
      gsap.utils.clamp(0, 1, (value - fadeRange[0]) / (fadeRange[1] - fadeRange[0]));

    // Last scroll direction (1 down, -1 up), read from the pin's onUpdate. The snap "chasm" below
    // resolves in this direction so a commitment either way carries the user all the way across.
    let scrollDirection = 1;

    let lastHandoffProgress = -1;
    const applyHandoff = (progress: number) => {
      const handoffProgress = gsap.utils.clamp(
        0, 1, (progress - handoffStartProgress) / (handoffEndProgress - handoffStartProgress),
      );
      if (handoffProgress === lastHandoffProgress) return;
      lastHandoffProgress = handoffProgress;

      // Mid-handoff the deck must outrank the works field so the craft flies OVER the incoming
      // meteors (see .is-handoff in globals.css).
      heroSection.classList.toggle(HANDOFF_CLASS, handoffProgress > 0 && handoffProgress < 1);

      if (deckOverlay) {
        gsap.set(deckOverlay, { autoAlpha: 1 - fadeWindow(HANDOFF_DECK_UI_FADE, handoffProgress) });
      }
      if (works) gsap.set(works, { autoAlpha: fadeWindow(HANDOFF_FIELD_FADE, handoffProgress) });
      if (worksOverlay) {
        gsap.set(worksOverlay, { autoAlpha: fadeWindow(HANDOFF_WORKS_UI_FADE, handoffProgress) });
      }

      window.dispatchEvent(
        new CustomEvent<HandoffProgressDetail>(HANDOFF_PROGRESS_EVENT, {
          detail: { progress: handoffProgress },
        }),
      );
    };

    // Free scrub through the fill, then snap to the nearest stop. The stops aren't uniform (the
    // handoff span is wider than a normal gap), so snap against the laid-out positions.
    const snapProgress = (value: number) => {
      if (value <= carouselStart) return value; // free scrub through the fill + settle zone
      // The handoff is a "chasm" — there is NO resting stop inside it. Any commitment resolves in the
      // direction of travel, so ONE flick past the last craft auto-glides the entire flight to
      // project 01 (and a flick back returns to the fleet). This is what carries the user across
      // "right away", and — because you can never come to rest mid-flight — it's also what stops the
      // progress-driven meteor entrance from being skipped: you always land on project 01 (progress
      // 1 = meteor fully arrived) or back on the fleet, never in between.
      if (value > handoffStartProgress && value < handoffEndProgress) {
        return scrollDirection >= 0 ? handoffEndProgress : handoffStartProgress;
      }
      let nearest = stopProgressValues[0];
      for (const stopProgressValue of stopProgressValues) {
        if (Math.abs(value - stopProgressValue) < Math.abs(value - nearest)) {
          nearest = stopProgressValue;
        }
      }
      return nearest;
    };

    // 2. The single pin — built lazily at reveal, never on mount (Contract 2). While the loader
    //    plays the page is locked at the top, but the binding must not exist at all: a restored or
    //    stray scroll would otherwise drive the sun/square while it's still flying in.
    let scrollTimeline: ReturnType<typeof gsap.timeline> | null = null;
    let lastCraft = -1;
    let lastProject = -1;

    // Where the square + sun must travel/scale to fill the viewport. Measured from the square's
    // *untransformed* layout and recomputed on every ScrollTrigger refresh — see invalidateOnRefresh
    // / onRefreshInit below. This keeps the sun locked to the square on resize.
    const computeGeometry = () => {
      const rect = measureUntransformedRect(heroCardElement);
      const cardCenterX = rect.left + rect.width  / 2;
      const cardCenterY = rect.top  + rect.height / 2;
      return {
        translateX: document.documentElement.clientWidth / 2 - cardCenterX,
        translateY: window.innerHeight / 2 - cardCenterY,
        scaleX:     document.documentElement.clientWidth / rect.width,
        scaleY:     window.innerHeight / rect.height,
      };
    };
    let geometry = computeGeometry();

    const createTransition = () => {
      scrollTimeline = gsap.timeline({
        scrollTrigger: {
          trigger:       heroSection,
          start:         'top top',
          end:           `+=${totalVh}%`,
          pin:           true,
          scrub:         SCROLL_SCRUB,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onRefreshInit: () => { geometry = computeGeometry(); },
          snap:
            totalStops > 1
              ? {
                  snapTo: snapProgress,
                  // Distance-scaled: a normal stop settles quickly, the wide handoff span glides.
                  duration: reduceMotion ? 0 : { min: SNAP_DURATION, max: SNAP_DURATION_MAX },
                  ease: 'power2.inOut',
                }
              : undefined,
          onUpdate: (self) => {
            const progress = self.progress;
            scrollDirection = self.direction;
            // Feed the navbar "home" meter with the fill phase only.
            document.documentElement.style.setProperty(
              '--nav-progress-home',
              String(Math.min(progress / fillFraction, 1)),
            );

            // Scrub the services→works handoff in every stage, so even a jump from the top of the
            // page to the last project passes through (and lands in) the right state.
            applyHandoff(progress);

            if (progress < fillFraction) {
              setStage('fill');
              document.documentElement.style.setProperty('--nav-progress-work', '0');
              return;
            }

            // Nearest stop across the non-uniform layout.
            let stop = 0;
            for (let stopIndex = 1; stopIndex < stopProgressValues.length; stopIndex += 1) {
              if (
                Math.abs(progress - stopProgressValues[stopIndex]) <
                Math.abs(progress - stopProgressValues[stop])
              ) {
                stop = stopIndex;
              }
            }

            if (stop < craftCount) {
              setStage('services');
              document.documentElement.style.setProperty('--nav-progress-work', '0');
              if (stop !== lastCraft) {
                lastCraft = stop;
                setActiveCraftRef.current(stop);
              }
            } else {
              setStage('works');
              const project = stop - craftCount;
              // Fill the "work" meter across the project stops.
              const worksMeter = worksMeterSpan > 0
                ? gsap.utils.clamp(0, 1, (progress - stopProgressValues[craftCount]) / worksMeterSpan)
                : 1;
              document.documentElement.style.setProperty('--nav-progress-work', String(worksMeter));
              if (project !== lastProject) {
                lastProject = project;
                setActiveProjectRef.current(project);
              }
            }
          },
        },
      });

      // Phase 1 — the square expands to fill the viewport while the sun rises + grows.
      // Function-based values so invalidateOnRefresh recomputes them from fresh geometry.
      scrollTimeline.to(heroCardElement, {
        x:            () => geometry.translateX,
        y:            () => geometry.translateY,
        scaleX:       () => geometry.scaleX,
        scaleY:       () => geometry.scaleY,
        borderRadius: 0,
        ease:         'power1.inOut',
        duration:     fillFraction,
      }, 0);

      if (sunLayer) {
        scrollTimeline.to(sunLayer, {
          x:        () => geometry.translateX,
          y:        () => geometry.translateY - SUN_SCROLL_RISE, // sits a little above centre and holds
          scale:    SUN_SCROLL_SCALE,
          ease:     'power1.inOut',
          duration: fillFraction,
        }, 0);
      }

      // Phase 2 — hold the filled square + risen sun while the carousel scroll runs.
      scrollTimeline.to({}, { duration: 1 - fillFraction });
    };

    // 3. Reveal — fired once, when the intro lands the sun in the square. This is also
    //    the moment the pin is allowed to come online (Contract 2).
    let hasRevealed = false;
    const runReveal = () => {
      if (hasRevealed) return;
      hasRevealed = true;

      createTransition();

      if (prefersReducedMotion()) {
        gsap.set(textInners, { yPercent: 0 });
        if (subline) gsap.set(subline, { autoAlpha: 1, y: 0 });
        if (squareFill) gsap.set(squareFill, { clipPath: FULL_CLIP });
        return;
      }

      const revealTimeline = gsap.timeline();
      // a. headline rises out of its masks
      revealTimeline.to(textInners, {
        yPercent: 0,
        duration: TEXT_WIPE_DURATION,
        stagger:  TEXT_WIPE_STAGGER,
        ease:     'power4.out',
      }, 0);
      // b. the square pours in like water behind the sun
      if (squareFill) revealTimeline.to(squareFill, {
        clipPath: FULL_CLIP,
        duration: SQUARE_FILL_DURATION,
        ease:     'power2.inOut',
      }, FILL_START);
      // c. tagline settles last
      if (subline) revealTimeline.to(subline, {
        autoAlpha: 1, y: 0, duration: SUB_FADE_DURATION, ease: 'power2.out',
      }, '>-0.3');
    };

    window.addEventListener(REVEAL_EVENT, runReveal);
    // Start with the short net; if the intro announces itself, swap to the long one (it will drive the
    // real reveal itself). Reassigned, so the cleanup clears whichever timer is live.
    let fallbackTimeout = window.setTimeout(runReveal, REVEAL_FALLBACK_NO_INTRO_MS);
    const onIntroActive = () => {
      window.clearTimeout(fallbackTimeout);
      fallbackTimeout = window.setTimeout(runReveal, REVEAL_FALLBACK_WITH_INTRO_MS);
    };
    window.addEventListener(INTRO_ACTIVE_EVENT, onIntroActive);

    // The navbar "Services" link asks the pin to scroll to the revealed fleet (craft 0).
    const onGotoServices = () => goToCraftImplRef.current(0);
    window.addEventListener(GOTO_SERVICES_EVENT, onGotoServices);

    // Jump to a stop by scrolling to its snap point; onUpdate then re-stages it. Before the pin
    // exists (e.g. reduced-motion bypass), fall back to setting the index directly.
    const goToStop = (stop: number) => {
      const trigger = scrollTimeline?.scrollTrigger;
      if (!trigger) {
        if (stop < craftCount) setActiveCraftRef.current(stop);
        else setActiveProjectRef.current(stop - craftCount);
        return;
      }
      const targetProgress = stopProgressValues[stop];
      const targetScroll   = trigger.start + targetProgress * (trigger.end - trigger.start);
      gsap.to(window, {
        scrollTo:  targetScroll,
        duration:  reduceMotion ? 0 : GOTO_DURATION,
        ease:      'power2.inOut',
        overwrite: true,
      });
    };
    goToCraftImplRef.current = (index) => goToStop(gsap.utils.clamp(0, craftCount - 1, index));
    goToProjectImplRef.current = (index) =>
      goToStop(craftCount + gsap.utils.clamp(0, projectCount - 1, index));

    return () => {
      window.removeEventListener(REVEAL_EVENT, runReveal);
      window.removeEventListener(INTRO_ACTIVE_EVENT, onIntroActive);
      window.removeEventListener(GOTO_SERVICES_EVENT, onGotoServices);
      window.clearTimeout(fallbackTimeout);
      gsap.killTweensOf(window);
      scrollTimeline?.scrollTrigger?.kill();
      scrollTimeline?.kill();
    };
    // Built once at reveal; the counts are constant for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionRef, heroCardRef, craftCount, projectCount]);

  const goToCraft = useCallback((index: number) => goToCraftImplRef.current(index), []);
  const goToProject = useCallback((index: number) => goToProjectImplRef.current(index), []);
  return { goToCraft, goToProject };
}
