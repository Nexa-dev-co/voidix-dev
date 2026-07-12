import { useCallback, useEffect, useRef, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";
import { measureUntransformedRect } from "@/lib/measureUntransformedRect";
import {
  REVEAL_EVENT,
  INTRO_ACTIVE_EVENT,
} from "@/components/effects/IntroSequence/introEvents";
import {
  DECK_REVEAL_EVENT,
  DECK_HIDE_EVENT,
  GOTO_SERVICES_EVENT,
} from "@/components/sections/ServicesDeck/deckEvents";
import {
  HANDOFF_PROGRESS_EVENT,
  type HandoffProgressDetail,
} from "@/lib/handoffEvents";

// Marks the hero while a full-black scene (fleet or works) is on screen. Scopes the layering (sun
// drops behind, intervening hero layers go transparent) so it never touches the fill phase.
const SERVICES_CLASS = "is-services";

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
const SCROLL_SCRUB = 1.8;
const FILL_SCROLL_VH = 120; // viewport-heights of scroll the square takes to fill
const STAGE_SCROLL_VH = 100; // ...and per carousel stop after it (a craft, or a project meteor)
const SUN_SCROLL_SCALE = 1.1; // the sun grows to 1.1× as the square fills
const SUN_SCROLL_RISE = 200; // px the sun lifts above the square's centre and holds

// Overlay reveal / hide, keyed to which stop the carousel is on.
const DECK_REVEAL_DURATION = 0.6;
const DECK_HIDE_DURATION = 0.4;
const WORKS_HIDE_DURATION = 0.4;
const GOTO_DURATION = 0.6; // programmatic scroll when a label/arrow jumps to a stop
// Snap is only a SAFETY NET now (the discrete stepper below owns all carousel movement) — it just
// tidies up after a native scroll, so these are short, distance-scaled settles.
const SNAP_DURATION = 0.5; // how quickly the carousel settles onto the nearest stop
const SNAP_DURATION_MAX = 2.2; // a longer settle glides rather than lurches
// The carousel stops start a touch *past* the fill, so stop 0 lands on the fully revealed fleet
// instead of the fill/transition edge (which read as the section scrolling away).
const CAROUSEL_SETTLE_FRACTION = 0.06;

// ── Discrete scroll: one stop per gesture across the carousel ────────────
// Native momentum lets a single hard wheel-spin / swipe fly past several stops (scrub follows the
// scrollbar, then snap lands on whichever stop momentum happened to dump you nearest). To stop that,
// once the square has filled we take the wheel/touch over and step exactly ONE stop per gesture,
// locking further input until the glide settles. The fill phase stays free native scroll (see the
// progress < fillFraction guards) so the square-grow keeps its continuous scrub.
const STEP_REARM_IDLE_MS = 300; // wheel/touch must go quiet this long before the next step can fire
const WHEEL_STEP_THRESHOLD = 24; // accumulated |deltaY| before a wheel gesture counts as a step
const TOUCH_STEP_THRESHOLD_PX = 42; // vertical swipe travel (px) that counts as one step
// A normal stop step is a quick glide, but the last-craft ↔ project-01 step crosses the wide handoff
// span — the whole services → works flight — so it gets a long, cinematic glide instead of a snap.
const HANDOFF_STEP_DURATION = 4.0; // seconds to fly across the services → works handoff on one step
const HANDOFF_SETTLE_MS = 150; // grace on the handoff's input lock so the flight fully lands
// The scroll glide between two stops is INVISIBLE (the deck + works are fixed overlays) — what you
// actually see is the scene transition it triggers: the deck's craft swap, or the works' camera warp.
// So the input stays locked well past the glide, giving that transition room to play out before
// another step can interrupt it. Keep this roughly in step with the scene durations in
// useServicesDeck (SWAP_*) and useWorksField (TRAVEL_DURATION).
const STAGE_STEP_HOLD_MS = 1400;
// Entering the carousel out of the free-scrolling fill: glide onto craft 01 and hold, so a hard flick
// through the fill can never dump the user on craft 02 (see the arrival branch in onUpdate).
const CAROUSEL_ARRIVAL_DURATION = 0.5;

// ── The services → works handoff ────────────────────────────────────────
// One long scrubbed span between the last craft stop and project 01. The craft's departure and
// the meteor's arrival live in the two WebGL scenes (fed the same 0..1 via HANDOFF_PROGRESS_EVENT);
// here we own the DOM cross-fades, each a window (start..end fraction) inside the span: the deck
// UI drops out first, the field (backdrop + canvas) rises under the still-flying craft, and the
// works UI settles only once the meteor has landed.
// The handoff is auto-played by the snap "chasm" below (one flick carries the user across), so it no
// longer needs to be a long manual scrub — a tighter span keeps the committed glide snappy.
const HANDOFF_SCROLL_VH = 180;
const HANDOFF_CLASS = "is-handoff"; // raises the deck over the works field mid-handoff (CSS)
const HANDOFF_DECK_UI_FADE: [number, number] = [0.05, 0.24];
// The field fades in at the START of the fly-left beat (Phase B) — NOT during the launch (Phase A),
// so the debris + meteor stay hidden while the ship rises up-left off the pad, then the streaking
// stars + debris come in from the left as we fly.
const HANDOFF_FIELD_FADE: [number, number] = [0.33, 0.55];
const HANDOFF_WORKS_UI_FADE: [number, number] = [0.8, 0.94];

// ── Reveal (runs when the intro lands the sun in the square) ───────────
const TEXT_WIPE_DURATION = 0.9;
const TEXT_WIPE_STAGGER = 0.12;
const SQUARE_FILL_DURATION = 1.1; // the "cup filling with water" rise
const SUB_FADE_DURATION = 0.6;
const FILL_START = 0.25; // begins just after the headline starts rising
const FULL_CLIP = "inset(0% 0 0 0)";
const EMPTY_CLIP = "inset(100% 0 0 0)";
// If the intro never fires its reveal, reveal anyway. Two nets: a SHORT one for when the intro is
// absent / crashed on mount (recover fast), swapped for a LONG ultimate one the moment the intro
// signals it's alive (INTRO_ACTIVE_EVENT) — because a running intro legitimately holds its reveal
// until assets load (its own ASSET_WAIT_TIMEOUT_MS), so the net must clear that worst case.
const REVEAL_FALLBACK_NO_INTRO_MS = 7000;
const REVEAL_FALLBACK_WITH_INTRO_MS = 20000;

const SUN_LAYER_SELECTOR = ".hero-sun-layer";
const DECK_SELECTOR = ".services-deck";
const DECK_OVERLAY_SELECTOR = ".deck-overlay";
const WORKS_SELECTOR = ".works-field";
const WORKS_OVERLAY_SELECTOR = ".works-overlay";

type Stage = "fill" | "services" | "works";

interface HeroAnimationRefs {
  sectionRef: RefObject<HTMLElement | null>;
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
  const {
    sectionRef,
    heroCardRef,
    setActiveCraft,
    craftCount,
    setActiveProject,
    projectCount,
  } = heroAnimationRefs;

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
    const heroSection = sectionRef.current;
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
      stopVhOffsets.push(
        handoffStartVh + HANDOFF_SCROLL_VH + projectStop * STAGE_SCROLL_VH,
      );
    }
    const carouselVhTotal = stopVhOffsets[stopVhOffsets.length - 1] || 1;
    const totalVh = FILL_SCROLL_VH + carouselVhTotal;
    // The fraction of the pin the square-fill occupies; the carousel owns the rest.
    const fillFraction = FILL_SCROLL_VH / totalVh;
    // Stops sit in [carouselStart, 1] — a touch past the fill so stop 0 isn't on the reveal edge.
    const carouselStart =
      fillFraction + (1 - fillFraction) * CAROUSEL_SETTLE_FRACTION;
    const carouselSpan = 1 - carouselStart;
    const stopProgressValues = stopVhOffsets.map(
      (stopVh) => carouselStart + (stopVh / carouselVhTotal) * carouselSpan,
    );
    const handoffStartProgress = stopProgressValues[craftCount - 1];
    const handoffEndProgress = stopProgressValues[craftCount] ?? 1;
    // Progress span the project stops cover — feeds the navbar "work" meter.
    const worksMeterSpan =
      stopProgressValues[totalStops - 1] - stopProgressValues[craftCount];

    const textInners = heroSection.querySelectorAll(".hero-mask-inner");
    const squareFill = heroSection.querySelector(".hero-sun-fill");
    const subline = heroSection.querySelector(".hero-sub");
    const sunLayer = document.querySelector(SUN_LAYER_SELECTOR);
    const deck = heroSection.querySelector<HTMLElement>(DECK_SELECTOR);
    const deckOverlay = heroSection.querySelector<HTMLElement>(
      DECK_OVERLAY_SELECTOR,
    );
    const works = heroSection.querySelector<HTMLElement>(WORKS_SELECTOR);
    const worksOverlay = heroSection.querySelector<HTMLElement>(
      WORKS_OVERLAY_SELECTOR,
    );

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
        duration: reduceMotion ? 0 : duration,
        ease: alpha ? "power2.out" : "power2.in",
        overwrite: true,
      });
    };

    let currentStage: Stage = "fill";
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
      if (fromStage === "works") return;
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
      if (stage === "fill") enterFill();
      else if (stage === "services") enterServices(fromStage);
      else enterWorks();
    };

    // ── The handoff scrub ──
    // One 0..1 value across the services→works span drives everything: the DOM cross-fades here,
    // and — via the event — the craft's departure (deck scene) + the meteor's arrival (field
    // scene). Runs on every pin update so snaps and programmatic jumps land in the right state.
    const fadeWindow = (fadeRange: [number, number], value: number) =>
      gsap.utils.clamp(
        0,
        1,
        (value - fadeRange[0]) / (fadeRange[1] - fadeRange[0]),
      );

    let lastHandoffProgress = -1;
    const applyHandoff = (progress: number) => {
      const handoffProgress = gsap.utils.clamp(
        0,
        1,
        (progress - handoffStartProgress) /
          (handoffEndProgress - handoffStartProgress),
      );
      if (handoffProgress === lastHandoffProgress) return;
      lastHandoffProgress = handoffProgress;

      // Mid-handoff the deck must outrank the works field so the craft flies OVER the incoming
      // meteors (see .is-handoff in globals.css).
      heroSection.classList.toggle(
        HANDOFF_CLASS,
        handoffProgress > 0 && handoffProgress < 1,
      );

      if (deckOverlay) {
        gsap.set(deckOverlay, {
          autoAlpha: 1 - fadeWindow(HANDOFF_DECK_UI_FADE, handoffProgress),
        });
      }
      if (works)
        gsap.set(works, {
          autoAlpha: fadeWindow(HANDOFF_FIELD_FADE, handoffProgress),
        });
      if (worksOverlay) {
        gsap.set(worksOverlay, {
          autoAlpha: fadeWindow(HANDOFF_WORKS_UI_FADE, handoffProgress),
        });
      }

      window.dispatchEvent(
        new CustomEvent<HandoffProgressDetail>(HANDOFF_PROGRESS_EVENT, {
          detail: { progress: handoffProgress },
        }),
      );
    };

    // 2. The single pin — built lazily at reveal, never on mount (Contract 2). While the loader
    //    plays the page is locked at the top, but the binding must not exist at all: a restored or
    //    stray scroll would otherwise drive the sun/square while it's still flying in.
    let scrollTimeline: ReturnType<typeof gsap.timeline> | null = null;
    let lastCraft = -1;
    let lastProject = -1;

    // ── Discrete-scroll state ──
    // `currentStop` is the stop the carousel is COMMITTED to. A step or a jump commits its target up
    // front — so the craft swap / meteor warp begins on the same frame you scroll, instead of waiting
    // for the scroll glide's midpoint — and raises `committedGlide` while the scroll animates there.
    // Only when nothing is committed (native scroll through the fill, a resize) does the pin fall back
    // to picking the nearest stop from the raw scroll position.
    let currentStop = 0;
    let committedGlide = false;
    let wasInFill = true;
    let stepLocked = false;
    let wheelAccum = 0;
    let touchStartY = 0;
    let touchActive = false;
    let stepMinUnlockAt = 0; // timestamp the lock can't lift before (covers the in-flight transition)
    let rearmTimer = 0;
    // Re-arm the stepper only after the wheel/touch has gone QUIET for STEP_REARM_IDLE_MS. Every
    // intercepted event pushes this out (see the handlers), so holding a spin or spamming the wheel
    // never advances more than one stop — you have to stop and scroll again. The in-flight
    // transition's hold is also honoured (stepMinUnlockAt), so a step can't re-arm mid-transition.
    const scheduleRearm = () => {
      window.clearTimeout(rearmTimer);
      const wait = Math.max(STEP_REARM_IDLE_MS, stepMinUnlockAt - performance.now());
      rearmTimer = window.setTimeout(() => {
        stepLocked = false;
        wheelAccum = 0;
      }, wait);
    };
    const lockStepping = (holdMs: number) => {
      stepLocked = true;
      wheelAccum = 0;
      stepMinUnlockAt = performance.now() + holdMs;
      scheduleRearm();
    };

    // Commit a stop — this is what actually swaps the craft on the pad / focuses the project meteor.
    // Called up front by goToStop, and by the pin's onUpdate whenever no glide is committed.
    const commitStop = (stop: number) => {
      currentStop = stop;
      if (stop < craftCount) {
        if (stop !== lastCraft) {
          lastCraft = stop;
          setActiveCraftRef.current(stop);
        }
        return;
      }
      const project = stop - craftCount;
      if (project !== lastProject) {
        lastProject = project;
        setActiveProjectRef.current(project);
      }
    };

    // Jump to a stop by scrolling to its snap point. The target is committed IMMEDIATELY (so the scene
    // transition begins on the same frame as the scroll, not at the glide's midpoint), and
    // `committedGlide` stops both onUpdate and the snap from second-guessing it while the scroll
    // animates. Before the pin exists (a reduced-motion bypass) this degrades to just setting the index.
    const goToStop = (stop: number, durationSeconds = GOTO_DURATION) => {
      commitStop(stop);
      const trigger = scrollTimeline?.scrollTrigger;
      if (!trigger) return;
      committedGlide = true;
      const targetProgress = stopProgressValues[stop];
      const targetScroll =
        trigger.start + targetProgress * (trigger.end - trigger.start);
      gsap.to(window, {
        scrollTo: targetScroll,
        duration: reduceMotion ? 0 : durationSeconds,
        ease: "power2.inOut",
        overwrite: true,
        onComplete: () => {
          committedGlide = false;
        },
      });
    };

    // Free scrub through the fill, then settle on the nearest stop.
    //
    // There is deliberately NO "chasm" rule here any more. It used to force any value inside the
    // services→works span to that span's far end in the direction of travel — but the LAST CRAFT'S
    // STOP *IS* that span's lower edge, so landing on it (via goToStop) with a sub-pixel rounding
    // overshoot read as "inside the chasm" and catapulted the user straight on into the works section.
    // The discrete stepper owns all carousel movement now, so snap is only a safety net for native
    // scroll; and while a glide is committed it can only agree with that target, never yank us back to
    // a stop we happen to be passing through.
    const snapProgress = (value: number) => {
      if (committedGlide) return stopProgressValues[currentStop];
      if (value <= carouselStart) return value; // free scrub through the fill + settle zone
      let nearest = stopProgressValues[0];
      for (const stopProgressValue of stopProgressValues) {
        if (Math.abs(value - stopProgressValue) < Math.abs(value - nearest)) {
          nearest = stopProgressValue;
        }
      }
      return nearest;
    };

    // Where the square + sun must travel/scale to fill the viewport. Measured from the square's
    // *untransformed* layout and recomputed on every ScrollTrigger refresh — see invalidateOnRefresh
    // / onRefreshInit below. This keeps the sun locked to the square on resize.
    const computeGeometry = () => {
      const rect = measureUntransformedRect(heroCardElement);
      const cardCenterX = rect.left + rect.width / 2;
      const cardCenterY = rect.top + rect.height / 2;
      return {
        translateX: document.documentElement.clientWidth / 2 - cardCenterX,
        translateY: window.innerHeight / 2 - cardCenterY,
        scaleX: document.documentElement.clientWidth / rect.width,
        scaleY: window.innerHeight / rect.height,
      };
    };
    let geometry = computeGeometry();

    const createTransition = () => {
      scrollTimeline = gsap.timeline({
        scrollTrigger: {
          trigger: heroSection,
          start: "top top",
          end: `+=${totalVh}%`,
          pin: true,
          scrub: SCROLL_SCRUB,
          anticipatePin: 1,
          invalidateOnRefresh: true,
          onRefreshInit: () => {
            geometry = computeGeometry();
          },
          snap:
            totalStops > 1
              ? {
                  snapTo: snapProgress,
                  // Distance-scaled: a normal stop settles quickly, the wide handoff span glides.
                  duration: reduceMotion
                    ? 0
                    : { min: SNAP_DURATION, max: SNAP_DURATION_MAX },
                  ease: "power2.inOut",
                }
              : undefined,
          onUpdate: (self) => {
            const progress = self.progress;
            // Feed the navbar "home" meter with the fill phase only.
            document.documentElement.style.setProperty(
              "--nav-progress-home",
              String(Math.min(progress / fillFraction, 1)),
            );

            // Scrub the services→works handoff in every stage, so even a jump from the top of the
            // page to the last project passes through (and lands in) the right state.
            applyHandoff(progress);

            if (progress < fillFraction) {
              wasInFill = true;
              setStage("fill");
              document.documentElement.style.setProperty(
                "--nav-progress-work",
                "0",
              );
              return;
            }

            // First update past the fill. The fill is free native scroll, so the flick that carried us
            // here is still delivering momentum — absorb it: lock the stepper (the wheel/touch handlers
            // then preventDefault the rest of that gesture, killing the momentum) and glide onto craft
            // 01. Without this, one hard scroll from the hero overshoots and dumps you on craft 02.
            if (wasInFill) {
              wasInFill = false;
              lockStepping(CAROUSEL_ARRIVAL_DURATION * 1000);
              goToStop(0, CAROUSEL_ARRIVAL_DURATION);
            }

            // A committed glide's target is authoritative. Only without one (native scroll, a resize)
            // do we resolve the nearest stop across the non-uniform layout and commit that.
            if (!committedGlide) {
              let nearest = 0;
              for (
                let stopIndex = 1;
                stopIndex < stopProgressValues.length;
                stopIndex += 1
              ) {
                if (
                  Math.abs(progress - stopProgressValues[stopIndex]) <
                  Math.abs(progress - stopProgressValues[nearest])
                ) {
                  nearest = stopIndex;
                }
              }
              commitStop(nearest);
            }

            if (currentStop < craftCount) {
              setStage("services");
              document.documentElement.style.setProperty(
                "--nav-progress-work",
                "0",
              );
            } else {
              setStage("works");
              // Fill the "work" meter across the project stops.
              const worksMeter =
                worksMeterSpan > 0
                  ? gsap.utils.clamp(
                      0,
                      1,
                      (progress - stopProgressValues[craftCount]) /
                        worksMeterSpan,
                    )
                  : 1;
              document.documentElement.style.setProperty(
                "--nav-progress-work",
                String(worksMeter),
              );
            }
          },
        },
      });

      // Phase 1 — the square expands to fill the viewport while the sun rises + grows.
      // Function-based values so invalidateOnRefresh recomputes them from fresh geometry.
      scrollTimeline.to(
        heroCardElement,
        {
          x: () => geometry.translateX,
          y: () => geometry.translateY,
          scaleX: () => geometry.scaleX,
          scaleY: () => geometry.scaleY,
          borderRadius: 0,
          ease: "power1.inOut",
          duration: fillFraction,
        },
        0,
      );

      if (sunLayer) {
        scrollTimeline.to(
          sunLayer,
          {
            x: () => geometry.translateX,
            y: () => geometry.translateY - SUN_SCROLL_RISE, // sits a little above centre and holds
            scale: SUN_SCROLL_SCALE,
            ease: "power1.inOut",
            duration: fillFraction,
          },
          0,
        );
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
      revealTimeline.to(
        textInners,
        {
          yPercent: 0,
          duration: TEXT_WIPE_DURATION,
          stagger: TEXT_WIPE_STAGGER,
          ease: "power4.out",
        },
        0,
      );
      // b. the square pours in like water behind the sun
      if (squareFill)
        revealTimeline.to(
          squareFill,
          {
            clipPath: FULL_CLIP,
            duration: SQUARE_FILL_DURATION,
            ease: "power2.inOut",
          },
          FILL_START,
        );
      // c. tagline settles last
      if (subline)
        revealTimeline.to(
          subline,
          {
            autoAlpha: 1,
            y: 0,
            duration: SUB_FADE_DURATION,
            ease: "power2.out",
          },
          ">-0.3",
        );
    };

    window.addEventListener(REVEAL_EVENT, runReveal);
    // Start with the short net; if the intro announces itself, swap to the long one (it will drive the
    // real reveal itself). Reassigned, so the cleanup clears whichever timer is live.
    let fallbackTimeout = window.setTimeout(
      runReveal,
      REVEAL_FALLBACK_NO_INTRO_MS,
    );
    const onIntroActive = () => {
      window.clearTimeout(fallbackTimeout);
      fallbackTimeout = window.setTimeout(
        runReveal,
        REVEAL_FALLBACK_WITH_INTRO_MS,
      );
    };
    window.addEventListener(INTRO_ACTIVE_EVENT, onIntroActive);

    // The navbar "Services" link asks the pin to scroll to the revealed fleet (craft 0).
    const onGotoServices = () => goToCraftImplRef.current(0);
    window.addEventListener(GOTO_SERVICES_EVENT, onGotoServices);

    goToCraftImplRef.current = (index) =>
      goToStop(gsap.utils.clamp(0, craftCount - 1, index));
    goToProjectImplRef.current = (index) =>
      goToStop(craftCount + gsap.utils.clamp(0, projectCount - 1, index));

    // ── One stop per wheel/touch gesture (carousel only) ──
    // Take the gesture over once the square has filled: preventDefault so native momentum can't drive
    // the pin, then step exactly one stop and lock further input for a cooldown. In the fill phase, and
    // at the carousel's two ends (scroll up off stop 0 → back into the fill; scroll down off the last
    // stop → out the bottom), we let native scroll through so those boundaries feel continuous.
    const stepBy = (direction: number) => {
      const target = gsap.utils.clamp(
        0,
        totalStops - 1,
        currentStop + direction,
      );
      // The last-craft ↔ project-01 step crosses the handoff span — the whole services → works flight
      // — so it glides slowly and stays locked for the full flight, and a second gesture can't cut it
      // short. A normal stage step's scroll glide is quick (the scroll itself is invisible: the deck
      // and works are fixed overlays), but the lock is held for STAGE_STEP_HOLD_MS so the craft swap /
      // meteor warp it kicks off gets to play out before another step can interrupt it.
      // NB: read `currentStop` before goToStop — that commits the target and moves it.
      const crossesHandoff =
        (currentStop === craftCount - 1 && target === craftCount) ||
        (currentStop === craftCount && target === craftCount - 1);
      const durationSeconds = crossesHandoff
        ? HANDOFF_STEP_DURATION
        : GOTO_DURATION;
      const holdMs = reduceMotion
        ? 0
        : crossesHandoff
          ? durationSeconds * 1000 + HANDOFF_SETTLE_MS
          : STAGE_STEP_HOLD_MS;
      goToStop(target, durationSeconds);
      lockStepping(holdMs);
    };
    // The pin is live and we're past the fill — i.e. inside the discrete carousel region.
    // Deliberately NOT gated on trigger.isActive: the last works stop sits at progress 1 (the pin's
    // very end), where isActive flips false — gating on it there let native momentum leak in and spam
    // past projects (works-section only). Progress bounds + the per-end guards decide it instead.
    const inCarouselRegion = () => {
      if (!hasRevealed) return false;
      const trigger = scrollTimeline?.scrollTrigger;
      return !!trigger && trigger.progress >= fillFraction;
    };
    const carouselDirection = (rawDelta: number): number => {
      if (rawDelta === 0 || !inCarouselRegion()) return 0;
      const direction = rawDelta > 0 ? 1 : -1;
      // Let the two ends spill back to native scroll so entering/leaving the carousel stays seamless.
      if (direction < 0 && currentStop <= 0) return 0;
      if (direction > 0 && currentStop >= totalStops - 1) return 0;
      return direction;
    };
    // A committed glide owns the scroll outright, so swallow the gesture — including at the two ends,
    // where we'd otherwise hand back to native and let a native scroll fight the running tween.
    const swallowDuringGlide = (event: Event) => {
      if (!committedGlide || !inCarouselRegion()) return false;
      event.preventDefault();
      scheduleRearm();
      return true;
    };

    const handleWheel = (event: WheelEvent) => {
      if (swallowDuringGlide(event)) return;
      const direction = carouselDirection(event.deltaY);
      if (direction === 0) return; // fill phase or an end → native scroll handles it
      event.preventDefault(); // we own carousel movement now
      // Keep the lock alive while you keep scrolling — this is what makes one continuous spin move
      // exactly one stop no matter how hard/long you scroll; the lock only re-arms after a quiet gap.
      if (stepLocked) {
        scheduleRearm();
        return;
      }
      wheelAccum += event.deltaY;
      if (Math.abs(wheelAccum) < WHEEL_STEP_THRESHOLD) return;
      stepBy(wheelAccum > 0 ? 1 : -1);
    };

    const handleTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      touchStartY = event.touches[0].clientY;
      touchActive = true;
    };
    const handleTouchMove = (event: TouchEvent) => {
      if (!touchActive) return;
      if (swallowDuringGlide(event)) return;
      const deltaY = touchStartY - event.touches[0].clientY; // swipe up = go forward
      const direction = carouselDirection(deltaY);
      if (direction === 0) return;
      event.preventDefault();
      // Same as the wheel: a held/continuous swipe keeps the lock alive so it only ever moves one stop.
      if (stepLocked) {
        scheduleRearm();
        return;
      }
      if (Math.abs(deltaY) < TOUCH_STEP_THRESHOLD_PX) return;
      touchStartY = event.touches[0].clientY; // reset so each step needs a fresh swipe of travel
      stepBy(direction);
    };
    const handleTouchEnd = () => {
      touchActive = false;
    };

    window.addEventListener("wheel", handleWheel, { passive: false });
    window.addEventListener("touchstart", handleTouchStart, { passive: true });
    window.addEventListener("touchmove", handleTouchMove, { passive: false });
    window.addEventListener("touchend", handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener(REVEAL_EVENT, runReveal);
      window.removeEventListener(INTRO_ACTIVE_EVENT, onIntroActive);
      window.removeEventListener(GOTO_SERVICES_EVENT, onGotoServices);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.clearTimeout(fallbackTimeout);
      window.clearTimeout(rearmTimer);
      gsap.killTweensOf(window);
      scrollTimeline?.scrollTrigger?.kill();
      scrollTimeline?.kill();
    };
    // Built once at reveal; the counts are constant for the page's life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionRef, heroCardRef, craftCount, projectCount]);

  const goToCraft = useCallback(
    (index: number) => goToCraftImplRef.current(index),
    [],
  );
  const goToProject = useCallback(
    (index: number) => goToProjectImplRef.current(index),
    [],
  );
  return { goToCraft, goToProject };
}
