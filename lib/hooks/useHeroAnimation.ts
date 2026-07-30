import { useCallback, useEffect, useRef, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";
import { isTuneScrollLocked } from "@/lib/tuneScrollLock";
import { measureUntransformedRect } from "@/lib/measureUntransformedRect";
// Shared, because the works field has to draw a copy of the sun in exactly this place inside the space
// render — see lib/sunPlacement.ts and WorksField/sunBackdrop.ts.
import { SUN_SCROLL_SCALE, SUN_SCROLL_RISE } from "@/lib/sunPlacement";
import {
  computeCarouselLayout,
  type CarouselSectionGeometry,
} from "@/lib/carouselLayout";
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
import {
  CHAMBER_PROGRESS_EVENT,
  type ChamberProgressDetail,
} from "@/lib/chamberEvents";
import {
  HERO_SERVICES_PROGRESS_EVENT,
  type HeroServicesProgressDetail,
} from "@/lib/heroServicesEvents";

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
//   at fill = 1         — a carousel of "stops" begins, all on the now-full-black screen: one stop
//                         per craft, then one per project meteor.
//   Between two sections sits a CROSSING — a wide scrubbed span (the services→works flight) where
//   the two scenes hand over. So the stops are NOT uniformly spaced.
// The stop layout is DATA (see the carousel section list below + lib/carouselLayout.ts), not
// arithmetic spread through this file: adding a section or a crossing is one entry in that list.
const SCROLL_SCRUB = 1.8;
const FILL_SCROLL_VH = 120; // viewport-heights of scroll the square takes to fill
const STAGE_SCROLL_VH = 100; // ...and per carousel stop after it (a craft, or a project meteor)

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
// The scroll glide between two stops is INVISIBLE (the deck + works are fixed overlays) — what you
// actually see is the scene transition it triggers: the deck's craft swap, or the works' camera warp.
// So the input stays locked well past the glide, giving that transition room to play out before
// another step can interrupt it. Keep this roughly in step with the scene durations in
// useServicesDeck (the PORTAL_* beats) and useWorksField (TRAVEL_DURATION).
//
// Sized to the deck's portal swap: the gates form, the craft turns onto one and flies through it, its
// replacement comes out of the other and settles, and the gates collapse — ~2.77s end to end. At the
// old 1400 a second gesture landed while the gates were still standing and cut the cinematic in half.
//
// This is the DEFAULT. It used to be the only value, which was fine while both sections happened to
// take about the same time — and stopped being fine the moment the works change stretched to 6s, at
// which point a section holding for 2.9s would let a second gesture land while the mark was still
// half-built. A section that needs longer states so itself (see `stepHoldMs`).
const STAGE_STEP_HOLD_MS = 2900;
// The works change is `MARK_CHANGE_SECONDS` (6s) plus grace, so one gesture always buys the whole
// build: the stones let go, the two streams cross, the next mark grows and the geode finishes.
const WORKS_STEP_HOLD_MS = 6300;
// Entering the carousel out of the free-scrolling fill: glide onto craft 01 and hold, so a hard flick
// through the fill can never dump the user on craft 02 (see the arrival branch in onUpdate).
const CAROUSEL_ARRIVAL_DURATION = 0.5;

// ── Crossings — the wide scrubbed spans between two sections ─────────────
// One long span between the last stop of one section and the first of the next. The scene-side
// choreography lives in the WebGL scenes (fed the same 0..1 via the crossing's event); here we own
// the DOM cross-fades, each a window (start..end fraction) inside the span.
//
// A crossing is auto-played by the stepper (one flick carries the user across on a long cinematic
// glide), so it doesn't need to be a long manual scrub — a tighter span keeps the committed glide
// snappy.

// The services → works flight: the deck UI drops out first, the field (backdrop + canvas) rises
// under the still-flying craft, and the works UI settles only once the meteor has landed.
const HANDOFF_SCROLL_VH = 180;
const HANDOFF_CLASS = "is-handoff"; // raises the deck over the works field mid-handoff (CSS)
const HANDOFF_DECK_UI_FADE: [number, number] = [0.05, 0.24];
// The field fades in at the START of the fly-left beat (Phase B) — NOT during the launch (Phase A),
// so the debris + meteor stay hidden while the ship rises up-left off the pad, then the streaking
// stars + debris come in from the left as we fly.
const HANDOFF_FIELD_FADE: [number, number] = [0.33, 0.55];
const HANDOFF_WORKS_UI_FADE: [number, number] = [0.8, 0.94];
// A crossing's step is a long, cinematic glide — the whole flight on one gesture — so it stays
// locked for the full duration and a second gesture can't cut it short.
const HANDOFF_STEP_DURATION = 4.0; // seconds to fly across the services → works handoff on one step
const HANDOFF_SETTLE_MS = 150; // grace on the handoff's input lock so the flight fully lands

// ── The works → chamber reveal ──
// The camera backs out of the space and it turns out to have been a display in a room all along. The
// camera move itself lives in the WebGL scene (fed this same 0..1); the DOM this crossing owns is now
// only the works UI dropping out.
//
// ── The sun, and why it is faded rather than carried into the room ──
// It is a fixed DOM billboard sitting BEHIND the canvas (which is why it shows through the empty space
// around the mark). The moment the display starts shrinking, a full-size sun is still pinned to the
// middle of the viewport, hanging in front of the room — so it fades out over the same fast window in
// which the display's dark turns opaque (see OPAQUE_WINDOW in chamberScene), early, while the display
// still fills the frame. What you perceive is a light dimming, not the site's anchor vanishing.
//
// ⚠ This is a COMPROMISE, and it is worth knowing which one. The star should really shrink into the
// screen along with everything else in the picture — that is what the reveal claims is happening, and
// it is what the planned collapse finale needs (the star is supposed to die ON the table's screen, and
// right now there is no star on that screen to die).
//
// A DOM element cannot do that. It was tried: the chamber published where the display landed and the
// sun was transformed onto it. Two things defeat it. The room sets an opaque `scene.background` and the
// display's own alpha closes over OPAQUE_WINDOW, so a layer BEHIND the canvas cannot be seen at all
// past ~0.12; and raising it in FRONT leaves a flat circle sitting on a screen that the tour views at
// an angle, which a 2D transform cannot skew to match.
//
// The real fix is to stop compositing and put the sun INSIDE the space render — a `CanvasTexture` of
// the sun's canvas (which already runs `preserveDrawingBuffer: true`) drawn as a camera-attached
// backdrop in the works scene. Then it lands on the table exactly as the mark does, with correct
// perspective and occlusion and no special cases. The open question is cost: a per-frame canvas upload
// on the heaviest scene on the site, plus deciding whether it should re-bloom through the field's pass.
const REVEAL_SCROLL_VH = 140;
const REVEAL_WORKS_UI_FADE: [number, number] = [0.02, 0.16];
// ⚠ The sun is NOT faded here any more, and must not be. It hands over to an in-render copy of itself
// (WorksField/sunBackdrop.ts), and the other half of that swap is driven by the works field's own EASED
// copy of this progress. Fading it from the raw value here meant the two halves ran on different clocks
// and disagreed by ~10 frames — which showed up as two suns on screen at once when scrolling back out
// of the room. Both halves now live together in useWorksField, computed from one number.
// The reveal glide now scrubs the WHOLE chamber cinematic on one gesture — the pull-back out of the screen
// AND the tour across the room to the podium — as a single reversible span (the TOUR_START split lives in
// chamberScene; see docs/chamber-tour-smoothing-plan.md). So the glide is long enough to contain both:
// ~3.2s pull-back + ~2.6s tour.
const REVEAL_STEP_DURATION = 5.8;
// The tour lives inside the glide now, so the forward settle only has to cover the hologram unsealing once
// you arrive — `holoOpenSeconds` in lib/chamberTuning (1.55) plus a little grace — not the whole tour.
const REVEAL_SETTLE_MS = 1900;
// The return mirrors the forward cinematic in reverse (same glide length), but there is nothing to LAND on
// the way out: the hologram is already sealing and you're heading back to the meteors. So it frees the
// stepper almost immediately instead of holding the forward settle — this is what fixes the "can't step
// back to the previous project for a few seconds after leaving the room" lock-out.
const REVEAL_REVERSE_SETTLE_MS = 150;
// The chamber is ONE stop, and everything in it plays off the single scroll that lands the reveal: the
// camera backs out of the display, the showcase walks you across the room to the podium, and the FAQ
// hologram unseals above the plinth as you arrive. One gesture, one continuous shot.
//
// So the pin has nothing to commit here — the chamber's beats are moments in a timeline, not scroll
// positions, and only the scene knows when the walk-up ends. It says so itself (CHAMBER_HOLOGRAM_EVENT).
const CHAMBER_STOP_COUNT = 1;

// The far edge of a crossing IS the next section's first stop, and browsers round the settled scroll
// to device pixels — so a glide "onto" that stop can leave the pin a hair inside the span and the
// clamp below yields 0.999… instead of 1. The WebGL scenes hand their camera back to normal browsing
// only on an EXACT boundary value (the contract in handoffEvents.ts), so that near-miss left the works
// flight camera engaged forever: warping to project 02 cross-faded the fire but the camera never flew.
// Snap anything this close to an edge onto it before dispatch. ~0.005 of the span is ≈5px of scroll —
// far above rounding noise, far below the nearest fade window (0.05/0.94).
const CROSSING_SNAP_EPSILON = 0.005;

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

// Indices into the carousel section list built in the effect — the sections the public jump API
// (the deck's labels, the works arrows, the navbar's Services link) targets.
const SERVICES_SECTION_INDEX = 0;
const WORKS_SECTION_INDEX = 1;

const SUN_LAYER_SELECTOR = ".hero-sun-layer";
const DECK_SELECTOR = ".services-deck";
const DECK_OVERLAY_SELECTOR = ".deck-overlay";
const WORKS_SELECTOR = ".works-field";
const WORKS_OVERLAY_SELECTOR = ".works-overlay";

/** The full-black scene currently on screen — "fill" plus one name per carousel section. */
type Stage = "fill" | "services" | "work" | "process";

/** What a crossing owns, beyond the scroll length the layout needs. */
interface CrossingSpec {
  scrollVh: number;
  /** Seconds the committed glide across this crossing takes (one long cinematic step). */
  stepDurationSeconds: number;
  /** Grace on the input lock after that glide, so the flight fully lands. */
  settleMs: number;
  /**
   * Grace on the input lock when crossing BACKWARD, if it should differ from the forward settle. The
   * reveal uses this so leaving the room frees the stepper at once (there's nothing to land on the way
   * out), instead of holding the long forward settle. Falls back to `settleMs` when unset.
   */
  reverseSettleMs?: number;
  /** Drive everything this crossing owns from its 0..1 progress (already boundary-snapped). */
  apply: (progress: number) => void;
}

/** One carousel section: its stops, the navbar meter it feeds, and the crossing out of it. */
interface CarouselSectionSpec extends CarouselSectionGeometry {
  /** Doubles as the stage name and the navbar meter key (--nav-progress-<key>). */
  key: Stage;
  /**
   * How long input stays locked after stepping WITHIN this section, in ms.
   *
   * A step's scroll glide is invisible (the deck and the works field are fixed overlays) — what you
   * actually see is the scene transition it kicks off, so the lock has to outlast that transition
   * rather than the scroll. Sections differ: the deck's portal swap is ~2.8s, the works mark change is
   * 6s. Defaults to STAGE_STEP_HOLD_MS.
   */
  stepHoldMs?: number;
  /**
   * Commit a stop within this section — the index is section-local.
   *
   * Optional, because a single-stop section has nothing to choose between: the chamber's beats play off
   * the reveal landing, not off a scroll position, so there is no index for the pin to hand it.
   */
  setActiveStop?: (index: number) => void;
  crossingAfter?: CrossingSpec;
}

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

    // 0..1 inside a fade window, clamped flat outside it — keeps each beat of a crossing in sequence.
    const fadeWindow = (fadeRange: [number, number], value: number) =>
      gsap.utils.clamp(
        0,
        1,
        (value - fadeRange[0]) / (fadeRange[1] - fadeRange[0]),
      );

    // ── The services → works handoff ──
    // One 0..1 across the span drives everything: the DOM cross-fades here, and — via the event —
    // the craft's departure (deck scene) + the meteor's arrival (field scene).
    const applyServicesToWorksHandoff = (progress: number) => {
      // Mid-handoff the deck must outrank the works field so the craft flies OVER the incoming
      // meteors (see .is-handoff in globals.css).
      heroSection.classList.toggle(HANDOFF_CLASS, progress > 0 && progress < 1);

      if (deckOverlay) {
        gsap.set(deckOverlay, {
          autoAlpha: 1 - fadeWindow(HANDOFF_DECK_UI_FADE, progress),
        });
      }
      if (works) {
        gsap.set(works, {
          autoAlpha: fadeWindow(HANDOFF_FIELD_FADE, progress),
        });
      }
      if (worksOverlay) {
        gsap.set(worksOverlay, {
          autoAlpha: fadeWindow(HANDOFF_WORKS_UI_FADE, progress),
        });
      }

      window.dispatchEvent(
        new CustomEvent<HandoffProgressDetail>(HANDOFF_PROGRESS_EVENT, {
          detail: { progress },
        }),
      );
    };

    // ── The works → chamber reveal ──
    // The camera move is in the WebGL scene; here we drop the works UI and retire the sun.
    const applyWorksToChamberReveal = (progress: number) => {
      if (worksOverlay) {
        gsap.set(worksOverlay, {
          autoAlpha: 1 - fadeWindow(REVEAL_WORKS_UI_FADE, progress),
        });
      }

      window.dispatchEvent(
        new CustomEvent<ChamberProgressDetail>(CHAMBER_PROGRESS_EVENT, {
          detail: { progress },
        }),
      );
    };

    // ── The carousel, as data ──
    // Everything the pin needs to know about the journey past the fill. Adding a section (or the
    // crossing into it) is one entry here — the stop layout, the crossing spans and the navbar
    // meters all derive from it (see lib/carouselLayout.ts).
    const carouselSections: CarouselSectionSpec[] = [
      {
        key: "services",
        stopCount: craftCount,
        setActiveStop: (index) => setActiveCraftRef.current(index),
        crossingAfter: {
          scrollVh: HANDOFF_SCROLL_VH,
          stepDurationSeconds: HANDOFF_STEP_DURATION,
          settleMs: HANDOFF_SETTLE_MS,
          apply: applyServicesToWorksHandoff,
        },
      },
      {
        key: "work",
        stopCount: projectCount,
        stepHoldMs: WORKS_STEP_HOLD_MS,
        setActiveStop: (index) => setActiveProjectRef.current(index),
        crossingAfter: {
          scrollVh: REVEAL_SCROLL_VH,
          stepDurationSeconds: REVEAL_STEP_DURATION,
          settleMs: REVEAL_SETTLE_MS,
          reverseSettleMs: REVEAL_REVERSE_SETTLE_MS,
          apply: applyWorksToChamberReveal,
        },
      },
      {
        key: "process",
        stopCount: CHAMBER_STOP_COUNT,
        // Nothing to commit: the room, the tour and the hologram all run off the reveal landing, and the
        // input lock that covers the lot lives on the crossing (REVEAL_SETTLE_MS).
      },
    ];
    // Crossings in the same order the layout resolves them (both walk the sections in order).
    const crossingSpecs = carouselSections.flatMap((section) =>
      section.crossingAfter ? [section.crossingAfter] : [],
    );

    const layout = computeCarouselLayout(carouselSections, {
      fillScrollVh: FILL_SCROLL_VH,
      stageScrollVh: STAGE_SCROLL_VH,
      settleFraction: CAROUSEL_SETTLE_FRACTION,
    });
    const { fillFraction, carouselStart, stopProgressValues, totalStops } =
      layout;

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
      if (fromStage === "work") return;
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

    const enterChamber = () => {
      // You're in the room now, but it's still the works canvas drawing it — so the layering doesn't
      // change at all. Every visual of the reveal is scrubbed from its span, so there is nothing to
      // tween here; this only holds the hero's own elements down.
      heroSection.classList.add(SERVICES_CLASS);
      fade(subline, 0, DECK_REVEAL_DURATION);
    };

    const enterStage: Record<Stage, (fromStage: Stage) => void> = {
      fill: enterFill,
      services: enterServices,
      work: enterWorks,
      process: enterChamber,
    };
    let currentStage: Stage = "fill";
    const setStage = (stage: Stage) => {
      if (stage === currentStage) return;
      const fromStage = currentStage;
      currentStage = stage;
      enterStage[stage](fromStage);
    };

    // ── The crossing scrubs ──
    // Run on every pin update — so snaps and programmatic jumps land in the right state — but a
    // crossing only re-applies when its own progress actually moved.
    const lastCrossingProgress = layout.crossings.map(() => -1);
    const applyCrossings = (progress: number) => {
      layout.crossings.forEach((crossing, crossingIndex) => {
        let crossingProgress = gsap.utils.clamp(
          0,
          1,
          (progress - crossing.startProgress) /
            (crossing.endProgress - crossing.startProgress),
        );
        // Honour the boundary contract (see CROSSING_SNAP_EPSILON): a settle that rounds to just
        // inside the span still reads as "span exited", so the scenes always get a clean 0 / 1.
        if (crossingProgress < CROSSING_SNAP_EPSILON) crossingProgress = 0;
        else if (crossingProgress > 1 - CROSSING_SNAP_EPSILON)
          crossingProgress = 1;
        if (crossingProgress === lastCrossingProgress[crossingIndex]) return;
        lastCrossingProgress[crossingIndex] = crossingProgress;
        crossingSpecs[crossingIndex].apply(crossingProgress);
      });
    };

    // ── The hero → services transition ──
    // The square filling the screen IS this transition, and the sun comes apart across it. Published
    // as two plain fractions (see lib/heroServicesEvents): the pin owns the LAYOUT of the span — where
    // the square finishes covering the viewport, where the fleet lands — and the sun owns what to do
    // with it, so nothing about the star's look leaks in here.
    //
    // Unlike a crossing this is dispatched from EVERY update including the fill's early return, because
    // the fill is exactly where it does its work.
    let lastHeroServicesProgress = -1;
    const applyHeroServicesProgress = (progress: number) => {
      const transitionProgress = gsap.utils.clamp(0, 1, progress / carouselStart);
      // Deduped on the transition alone: both fractions rise together and saturate together (fill
      // reaches 1 first, at fillFraction, which is inside carouselStart), so one is enough to tell
      // whether anything moved.
      if (transitionProgress === lastHeroServicesProgress) return;
      lastHeroServicesProgress = transitionProgress;
      window.dispatchEvent(
        new CustomEvent<HeroServicesProgressDetail>(HERO_SERVICES_PROGRESS_EVENT, {
          detail: {
            progress: transitionProgress,
            fill: gsap.utils.clamp(0, 1, progress / fillFraction),
          },
        }),
      );
    };

    // 2. The single pin — built lazily at reveal, never on mount (Contract 2). While the loader
    //    plays the page is locked at the top, but the binding must not exist at all: a restored or
    //    stray scroll would otherwise drive the sun/square while it's still flying in.
    let scrollTimeline: ReturnType<typeof gsap.timeline> | null = null;

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
      const wait = Math.max(
        STEP_REARM_IDLE_MS,
        stepMinUnlockAt - performance.now(),
      );
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
    // Called up front by goToStop, and by the pin's onUpdate whenever no glide is committed. Each
    // section remembers its own last committed index, so re-entering a section doesn't re-fire it.
    const lastCommittedIndex = carouselSections.map(() => -1);
    const commitStop = (stop: number) => {
      currentStop = stop;
      const sectionIndex = layout.sectionIndexOfStop(stop);
      const localIndex = stop - layout.sections[sectionIndex].firstStop;
      if (lastCommittedIndex[sectionIndex] === localIndex) return;
      lastCommittedIndex[sectionIndex] = localIndex;
      carouselSections[sectionIndex].setActiveStop?.(localIndex);
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

    // Jump to a stop by its section-local index (what the deck's labels and the works arrows ask for).
    const goToStopInSection = (sectionIndex: number, localIndex: number) => {
      const { firstStop, lastStop } = layout.sections[sectionIndex];
      goToStop(
        firstStop + gsap.utils.clamp(0, lastStop - firstStop, localIndex),
      );
    };

    // Free scrub through the fill, then settle on the nearest stop.
    //
    // There is deliberately NO "chasm" rule here any more. It used to force any value inside a
    // crossing's span to that span's far end in the direction of travel — but the LAST STOP OF THE
    // SECTION *IS* that span's lower edge, so landing on it (via goToStop) with a sub-pixel rounding
    // overshoot read as "inside the chasm" and catapulted the user straight on into the next section.
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

    // Feed one of the navbar's per-section scroll meters. Each nav item's cyan fill scales to
    // --nav-progress-<key> (see Navbar / useNavbarAnimation), and it's the owning section's job to
    // publish it — the hero pin owns "home" (the fill) plus one key per carousel section.
    const setNavMeter = (key: string, value: number) => {
      document.documentElement.style.setProperty(
        `--nav-progress-${key}`,
        String(value),
      );
    };
    // Fill the meter of every section behind us, empty every section ahead, and track the one we're
    // in across its own stops.
    const setSectionNavMeters = (
      progress: number,
      currentSectionIndex: number,
    ) => {
      layout.sections.forEach((sectionLayout, sectionIndex) => {
        const key = carouselSections[sectionIndex].key;
        if (sectionIndex < currentSectionIndex) {
          setNavMeter(key, 1);
        } else if (sectionIndex > currentSectionIndex) {
          setNavMeter(key, 0);
        } else {
          setNavMeter(
            key,
            sectionLayout.meterSpan > 0
              ? gsap.utils.clamp(
                  0,
                  1,
                  (progress - sectionLayout.firstStopProgress) /
                    sectionLayout.meterSpan,
                )
              : 1,
          );
        }
      });
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
          end: `+=${layout.totalScrollVh}%`,
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
                  // Distance-scaled: a normal stop settles quickly, a longer one glides.
                  duration: reduceMotion
                    ? 0
                    : { min: SNAP_DURATION, max: SNAP_DURATION_MAX },
                  ease: "power2.inOut",
                  // BOTH of these default to TRUE in GSAP, and both are actively harmful now that the
                  // discrete stepper owns carousel movement:
                  //   inertia    — projects the landing point from the scroll VELOCITY. On a slow
                  //                machine a dropped frame makes goToStop's last step a big jump, so
                  //                the velocity reads huge and snap projects far past the stop.
                  //   directional — only snaps in the direction of travel. Land on a section's LAST
                  //                stop (which is the lower edge of a crossing span) while moving
                  //                forward, and the next snap point forward is the next section's
                  //                first stop — so it carried the user straight on across.
                  // We already know exactly where we want to be, so: no projection, no direction bias.
                  inertia: false,
                  directional: false,
                }
              : undefined,
          onUpdate: (self) => {
            const progress = self.progress;
            // The "home" meter tracks the fill phase only.
            setNavMeter("home", Math.min(progress / fillFraction, 1));

            // Scrub every crossing in every stage, so even a jump from the top of the page to the
            // last project passes through (and lands in) the right state.
            applyCrossings(progress);
            // Same reasoning, and deliberately ABOVE the fill's early return — this span's whole job
            // is inside the fill, and a jump past it still has to land the sun fully open.
            applyHeroServicesProgress(progress);

            if (progress < fillFraction) {
              wasInFill = true;
              setStage("fill");
              // No carousel section has been entered yet.
              carouselSections.forEach((section) => setNavMeter(section.key, 0));
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

            const sectionIndex = layout.sectionIndexOfStop(currentStop);
            setStage(carouselSections[sectionIndex].key);
            setSectionNavMeters(progress, sectionIndex);
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
      goToStopInSection(SERVICES_SECTION_INDEX, index);
    goToProjectImplRef.current = (index) =>
      goToStopInSection(WORKS_SECTION_INDEX, index);

    // ── One stop per wheel/touch gesture (carousel only) ──
    // Take the gesture over once the square has filled: preventDefault so native momentum can't drive
    // the pin, then step exactly one stop and lock further input for a cooldown. In the fill phase, and
    // at the carousel's two ends (scroll up off stop 0 → back into the fill; scroll down off the last
    // stop → out the bottom), we let native scroll through so those boundaries feel continuous.
    //
    // A step that crosses a CROSSING is the exception: it glides slowly across the whole flight and
    // stays locked for its full duration, so a second gesture can't cut the cinematic short.
    const crossingBetween = (fromStop: number, toStop: number) =>
      layout.crossings.findIndex(
        (crossing) =>
          (crossing.fromStop === fromStop && crossing.toStop === toStop) ||
          (crossing.fromStop === toStop && crossing.toStop === fromStop),
      );
    const stepBy = (direction: number) => {
      const target = gsap.utils.clamp(
        0,
        totalStops - 1,
        currentStop + direction,
      );
      // NB: read `currentStop` before goToStop — that commits the target and moves it.
      const crossingIndex = crossingBetween(currentStop, target);
      const crossing =
        crossingIndex >= 0 ? crossingSpecs[crossingIndex] : undefined;
      // A normal stage step's scroll glide is quick (the scroll itself is invisible: the deck and works
      // are fixed overlays), but the lock is held for STAGE_STEP_HOLD_MS so the craft swap / meteor warp
      // it kicks off gets to play out before another step can interrupt it.
      const durationSeconds = crossing
        ? crossing.stepDurationSeconds
        : GOTO_DURATION;
      // A crossing holds its lock for the whole glide plus a settle — but the settle can differ by
      // direction: leaving a section backward has nothing to land, so a crossing can free the stepper right
      // away instead of holding the forward cinematic's grace (see the reveal's reverseSettleMs).
      const crossingSettleMs =
        crossing && direction < 0
          ? crossing.reverseSettleMs ?? crossing.settleMs
          : crossing?.settleMs ?? 0;
      // A stage step's hold belongs to the section the step happens INSIDE — read off the target, so
      // stepping forward into works already holds for the works change rather than for the deck's.
      const targetSection = carouselSections[layout.sectionIndexOfStop(target)];
      const holdMs = reduceMotion
        ? 0
        : crossing
          ? durationSeconds * 1000 + crossingSettleMs
          : targetSection?.stepHoldMs ?? STAGE_STEP_HOLD_MS;
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
      // Authoring freeze (?tune only). SWALLOWED rather than ignored: letting it through would still
      // scroll the page, which moves the pin, which is the exact thing being frozen. Reads false on any
      // normal load — see lib/tuneScrollLock.
      if (isTuneScrollLocked()) {
        event.preventDefault();
        return;
      }
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
      if (isTuneScrollLocked()) {
        event.preventDefault();
        return;
      }
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
