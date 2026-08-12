import { useCallback, useEffect, useRef, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { ScrollToPlugin } from "gsap/ScrollToPlugin";
import { prefersReducedMotion } from "@/lib/prefersReducedMotion";
import { measureUntransformedRect } from "@/lib/measureUntransformedRect";
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
} from "@/components/sections/ServicesDeck/deckEvents";
import {
  GOTO_SECTION_EVENT,
  readGotoSection,
  requestSection,
} from "@/lib/sectionNavigation";
import { findNavItem } from "@/components/layout/Navbar/navItems";
import {
  BLACK_STAGE_EVENT,
  type BlackStageDetail,
} from "@/lib/blackStageEvent";
import { profileGauge } from "@/lib/frameProfiler";
import {
  JUMP_ARRIVED_EVENT,
  JUMP_BEGIN_EVENT,
  JUMP_COVERED_EVENT,
  type JumpBeginDetail,
} from "@/lib/sectionJumpEvents";
import {
  HANDOFF_PROGRESS_EVENT,
  type HandoffProgressDetail,
} from "@/lib/handoffEvents";
import {
  CHAMBER_PROGRESS_EVENT,
  type ChamberProgressDetail,
} from "@/lib/chamberEvents";
import {
  CONTACT_PROGRESS_EVENT,
  type ContactProgressDetail,
} from "@/lib/contactEvents";
import {
  HERO_SERVICES_PROGRESS_EVENT,
  type HeroServicesProgressDetail,
} from "@/lib/heroServicesEvents";
import {
  LOOP_COVERED_EVENT,
  LOOP_PROGRESS_EVENT,
  LOOP_REQUEST_EVENT,
  LOOP_RESET_EVENT,
  SUN_REGATHER_EVENT,
  type LoopProgressDetail,
} from "@/lib/loopEvents";

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
const SUN_SCROLL_SCALE = 1.1; // the sun grows to 1.1× as the square fills
const SUN_SCROLL_RISE = 200; // px the sun lifts above the square's centre and holds

// Overlay reveal / hide, keyed to which stop the carousel is on.
const DECK_REVEAL_DURATION = 0.6;
const DECK_HIDE_DURATION = 0.4;
const WORKS_HIDE_DURATION = 0.4;
const GOTO_DURATION = 0.6; // programmatic scroll when a label/arrow jumps to a stop
// A navbar jump can cross the whole site. Its glide scales with the distance travelled, between the
// plain GOTO_DURATION for a neighbour and this for hero → contact, so a long jump reads as travel
// rather than as the entire page being scrubbed past in half a second.
const NAV_JUMP_MAX_DURATION = 3.2;
const NAV_JUMP_DURATION_PER_PROGRESS = 3.4;
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
// This is the DEFAULT, and it applies to a section whose transition must not be cut into. A section
// that wants a different answer states so itself (see `stepHoldMs`) — works does, in the other
// direction: its change is interruptible by design, so it holds for far less than it lasts.
const STAGE_STEP_HOLD_MS = 2900;
/**
 * Works is the deliberate exception: its hold is SHORTER than the transition it kicks off.
 *
 * It used to be 6300 — `MARK_CHANGE_SECONDS` plus grace — on the reasoning that one gesture should
 * buy the whole build. What that actually bought was six seconds in which the section ignored you,
 * and a visitor who has decided to move on does not want to be told to sit still. The mark change
 * now turns around under a step instead of being outrun by one (`runMarkTo` in useWorksField), so
 * the build no longer needs protecting from input — scrolling back reverses it, scrolling on carries
 * it into the next mark.
 *
 * What is left for this to do is only what STAGE_STEP_HOLD_MS does everywhere else: stop one flick's
 * tail counting twice. Paired with STEP_REARM_IDLE_MS (the wheel must go quiet for 300ms, and every
 * intercepted event pushes that out), this asks for a genuine second gesture without ever swallowing
 * one.
 */
const WORKS_STEP_HOLD_MS = 800;
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
// ⚠ 4.0 → 5.0 on 2026-08-11, to buy the MARK its entrance. It used to start arriving at handoff 0.80
// and the ship only began clearing at 0.88 (EXIT_PROGRESS_START in useServicesDeck), so the incoming
// mark and the departing craft shared the frame for ~0.3 s — despite a comment on that constant
// claiming the arrival "begins only once the ship is clearing". METEOR_ARRIVE_PROGRESS_START now
// matches 0.88 exactly, and the extra second is what stops that costing the mark its approach: at 4 s
// there were only 0.8 s of crossing left after 0.88, and the arrival had nowhere to go.
// The input lock is `stepDurationSeconds * 1000 + settleMs`, so it follows this on its own.
const HANDOFF_STEP_DURATION = 5.0; // seconds to fly across the services → works handoff on one step
const HANDOFF_SETTLE_MS = 150; // grace on the handoff's input lock so the flight fully lands

// ── The works → chamber reveal ──
// The camera backs out of the space and it turns out to have been a display in a room all along. The
// camera move itself lives in the WebGL scene (fed this same 0..1); the DOM this crossing owns is the
// works UI dropping out — and the SUN.
//
// The sun has to go, and this is the only place that can do it. It's a fixed DOM billboard sitting
// BEHIND the canvas (which is why it shows through the empty space between the meteors). The moment
// the display starts shrinking, a full-size sun would still be pinned to the middle of the viewport,
// hanging in front of the room. So it fades out over the same fast window in which the display's dark
// turns opaque (see OPAQUE_WINDOW in chamberScene) — early, while the display still fills the frame,
// so all you can actually perceive is a light dimming rather than the site's anchor vanishing.
//
// ⚠ Know what this costs before you change it. The star never reaches the table, so the planned
// collapse finale has no star on that screen to die. Carrying it into the room was built once — a
// CanvasTexture of the sun's canvas drawn as a quad inside the space render — and reverted, because
// the site then had two sun images whose handoff had to be timed, and both ended up on screen at
// once. The quad itself was also written in clip space, so the works camera could not move it; drag
// -to-look swung the whole field around a star that stayed nailed to the glass.
//
// Neither of those is an argument against the idea, only against that build of it. If it is tried
// again, the two images must be mutually exclusive by construction rather than by timing.
const REVEAL_SCROLL_VH = 140;
const REVEAL_WORKS_UI_FADE: [number, number] = [0.02, 0.16];
// ⚠ Sits at the END of the reveal's look-down lead-in (REVEAL_LEADIN_END, 0.18 in useWorksField), NOT
// at the start of the span. The works camera turns away from the star across that lead-in, and a fade
// beginning at 0 would dim the star out before the turn had carried it anywhere — which is the whole
// point of the turn. The pan does the visible work; this only closes the door behind it, and guarantees
// the star is gone on any viewport where the turn alone doesn't clear the frame.
//
// It must still be CLOSED by the time the room starts, because that is when the canvas seals opaque
// (OPAQUE_WINDOW) and a half-faded star would simply be cut off mid-fade. Keep the end on the lead-in.
const REVEAL_SUN_FADE: [number, number] = [0.12, 0.18];
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
const SUN_FLIGHT_SELECTOR = ".hero-sun-flight";
// The chamber is ONE stop, and everything in it plays off the single scroll that lands the reveal: the
// camera backs out of the display, the showcase walks you across the room to the podium, and the FAQ
// hologram unseals above the plinth as you arrive. One gesture, one continuous shot.
//
// So the pin has nothing to commit here — the chamber's beats are moments in a timeline, not scroll
// positions, and only the scene knows when the walk-up ends. It says so itself (CHAMBER_HOLOGRAM_EVENT).
const CHAMBER_STOP_COUNT = 1;

// ── The chamber → contact return ──
// You go back INTO the display, and the space has changed while you were away: the mark is gone and the
// star is a black hole. The camera move is the reveal's pull-back run backwards, so there is no new path
// to author — the return simply unwinds the chamber's progress (see lib/contactEvents.ts for why it is
// its own signal rather than a second writer of the chamber's).
//
// Sized to match the reveal it undoes: the same glide length, so leaving the room takes as long as
// arriving did. The settle is short — there is nothing to land on the way in, the same reasoning as the
// reveal's own reverse settle.
const RETURN_SCROLL_VH = 140;
const RETURN_STEP_DURATION = 5.8;
const RETURN_SETTLE_MS = 200;
const RETURN_CONTACT_UI_FADE: [number, number] = [0.72, 0.94];
// ⚠ There is no sun-restore window here any more. The star that comes back is not this one — it is a
// real object in the works scene, and the span that fades it up lives there (`CONTACT_STAR_PRESENCE` in
// useWorksField). Re-adding one here would put two stars on screen; §2.1 of the plan explains why the
// single-owner opacity below is load-bearing rather than tidy.
const CONTACT_STOP_COUNT = 1;
const CONTACT_SELECTOR = ".contact-section";

// ── The contact → hero loop ──
// You fall into the black hole and come back out at the top of the page. The dive is a normal scrubbed
// crossing; what is NOT normal is what happens at its far end, because a loop here is a TELEPORT — the
// pin has a fixed range and contact sits at progress 1, so returning to the hero means throwing the
// scrollbar back to 0. See lib/loopEvents.ts and docs/contact-loop-plan.md.
// Long, because the fall is the point. This is not a transition between two things you want to look at
// — it is the one stretch of the site with no content in it at all, so its whole job is the ride.
const LOOP_SCROLL_VH = 200;
const LOOP_STEP_DURATION = 6.5;
/** Long enough to cover the jump AND the hero arrival that plays under it, so nothing can interrupt. */
const LOOP_SETTLE_MS = 2400;
/** The contact panel and footer drop out early — you are falling, not reading. */
const LOOP_CONTACT_UI_FADE: [number, number] = [0.0, 0.2];
/**
 * ⚠ A crossing on the LAST section breaks the layout, silently and globally.
 *
 * `computeCarouselLayout` records every `crossingAfter` as `toStop: lastStop + 1`. On the final section
 * that stop does not exist, so its `endProgress` is `undefined` → the crossing's progress is `NaN` →
 * and because `applyCrossings` walks the whole list, EVERY crossing on the site gets NaN, not just this
 * one. The dive therefore needs a section to cross INTO; this is it.
 *
 * It is a landing pad and nothing else — one stop, no content, no navbar item reads its meter.
 */
const LOOP_STOP_COUNT = 1;

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
// signals it's alive (INTRO_ACTIVE_EVENT).
//
// ⚠ The long net is no longer sized against anything the intro can be measured against, and it must
// not be. A running intro legitimately holds its reveal until the STAR has downloaded, with no upper
// bound — at 20 KB/s that is well over a minute — so no fixed number here could both cover a crashed
// intro quickly and outlast a slow one. `INTRO_ACTIVE_EVENT` is therefore repeated as a heartbeat
// while the intro's gate is waiting, and the handler below re-arms this timer on every one. So what
// this value really means is "how long after the intro STOPS reporting do we take over", and 20 s is
// generous for that.
const REVEAL_FALLBACK_NO_INTRO_MS = 7000;
const REVEAL_FALLBACK_WITH_INTRO_MS = 20000;

// Indices into the carousel section list built in the effect — the sections the public jump API
// (the deck's labels, the works arrows, the navbar's Services link) targets.
const SERVICES_SECTION_INDEX = 0;
const WORKS_SECTION_INDEX = 1;
/** The hero sits before every carousel section, so it is one short of the first. */
const HERO_SECTION_INDEX = -1;

// ── Covered nav jumps ────────────────────────────────────────────────────
// Every jump to a different section is hidden: a cover closes, the ordinary glide runs underneath
// unwatched, the cover opens on the destination. See lib/sectionJumpEvents.ts.
//
// This was briefly 2, on the reasoning that an ADJACENT jump should keep its crossing in full view —
// those crossings are the best shots on the site and hiding them looked like throwing the work away.
// Watching it decided otherwise: a neighbouring crossing is still played at several times the rate it
// was authored for, so what you actually get is not the cinematic, it is the cinematic fast-forwarded.
// The choice was never "see it or skip it" — it was "see it badly or be taken there properly", and
// those crossings are still shown, in full, to anyone who scrolls.
//
// At 1 the only jump that stays uncovered is one to the section you are already in, which is a move
// WITHIN a section (works project 03 → 01) and has never been a crossing at all.
const JUMP_SECTION_DISTANCE = 1;
/**
 * How close the pin's progress must get to the target stop to count as ARRIVED.
 *
 * The scrub tween has a real duration, so progress lands on the target exactly rather than
 * asymptotically — this only has to clear device-pixel rounding on the settled scroll. ~0.0015 of the
 * pin is a couple of viewport-heights of scroll, far above that noise and far below one stop's span.
 */
const JUMP_ARRIVE_EPSILON = 0.0015;
/** If the cover never announces itself, glide anyway rather than sitting on a dead click. */
const JUMP_COVER_TIMEOUT_MS = 2000;
/**
 * ...and if the pin never reports arrival, open anyway. A jump that silently fails must not leave the
 * visitor staring at a full-screen cover. Measured from the glide's start, on top of its own length.
 */
const JUMP_ARRIVE_GRACE_MS = 2500;
/**
 * Input stays locked this long after a jump lands, covering the cover's opening and the section's
 * entrance behind it. Generous on purpose: the cover owns those timings, and this only has to outlast
 * them.
 */
const JUMP_ARRIVE_HOLD_MS = 1600;

const SUN_LAYER_SELECTOR = ".hero-sun-layer";
const DECK_SELECTOR = ".services-deck";
const DECK_OVERLAY_SELECTOR = ".deck-overlay";
const WORKS_SELECTOR = ".works-field";
const WORKS_OVERLAY_SELECTOR = ".works-overlay";

/** The full-black scene currently on screen — "fill" plus one name per carousel section. */
type Stage = "fill" | "services" | "work" | "faq" | "contact" | "loop";

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
   * actually see is the scene transition it kicks off, so this is measured against that transition
   * rather than against the scroll. Which way it is measured is the section's own call: the deck's
   * portal swap must not be cut into, so it holds for the whole ~2.8s; the works mark change turns
   * around under a step instead, so it holds for a fraction of its 4s. Defaults to
   * STAGE_STEP_HOLD_MS.
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
    const contact = heroSection.querySelector<HTMLElement>(CONTACT_SELECTOR);

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
    const sunFlight = document.querySelector<HTMLElement>(SUN_FLIGHT_SELECTOR);

    // ── The hero star's opacity is a function of the REVEAL, and of nothing else ──
    //
    // It used to have a second input: the return faded it back in so it could die at contact. That is
    // gone, because the star that dies is no longer this one — it is a real object inside the works
    // scene (`Contact/singularityScene.ts`), where the lensing pass has a starfield to bend.
    //
    // ⚠ This single input is what makes the two stars mutually exclusive BY CONSTRUCTION rather than by
    // timing, which is the condition CLAUDE.md sets for retrying a handoff that was reverted once
    // already. This one is 0 for everything past reveal 0.18; the other cannot leave 0 until reveal is
    // pinned at 1. Give this a second input again and that guarantee is gone — you get two stars on
    // screen, which is exactly how the previous attempt failed. See docs/contact-singularity-plan.md §2.1.
    let revealSunProgress = 0;
    const applySunOpacity = () => {
      if (!sunFlight) return;
      gsap.set(sunFlight, {
        opacity: 1 - fadeWindow(REVEAL_SUN_FADE, revealSunProgress),
      });
    };
    const applyWorksToChamberReveal = (progress: number) => {
      if (worksOverlay) {
        gsap.set(worksOverlay, {
          autoAlpha: 1 - fadeWindow(REVEAL_WORKS_UI_FADE, progress),
        });
      }
      // Driven on the INNER sun element on purpose: HeroSun owns the outer layer's opacity for its
      // resize hide/settle, and two owners of one property is how you get a sun that flickers back on
      // when the window is nudged. Reported rather than written, for the same reason — see
      // applySunOpacity, which is the only thing that touches it.
      revealSunProgress = progress;
      applySunOpacity();

      window.dispatchEvent(
        new CustomEvent<ChamberProgressDetail>(CHAMBER_PROGRESS_EVENT, {
          detail: { progress },
        }),
      );
    };

    // ── The chamber → contact return ──
    // The camera dives back into the display and the space has changed. The move itself lives in the
    // WebGL scene (fed this same 0..1, and combined there with the reveal's — see lib/contactEvents.ts);
    // the DOM this crossing owns is the contact panel coming in, late, once you are back inside.
    // ── The contact panel's opacity has ONE owner, for exactly the reason the star's does ──
    //
    // Two spans move it in opposite directions: the return brings it in, the loop's dive takes it away.
    // Letting each write `autoAlpha` directly does not work, and fails in the loudest possible way —
    // EVERY crossing's `apply` runs on EVERY pin update, including the first one at scroll 0. So the
    // loop, sitting at its own progress 0, writes "not yet taken away" = 1 over the return's "not yet
    // brought in" = 0, and the contact form and footer are painted over the hero, the fleet and the
    // works field for the whole site. (They were. That is exactly what happened.)
    //
    // So both spans report here and this resolves the single value. Order-independent by construction:
    // whichever crossing dispatches last, the answer is the same.
    let contactShownProgress = 0;
    let contactTakenProgress = 0;
    const applyContactOpacity = () => {
      if (!contact) return;
      const shown = fadeWindow(RETURN_CONTACT_UI_FADE, contactShownProgress);
      const taken = fadeWindow(LOOP_CONTACT_UI_FADE, contactTakenProgress);
      gsap.set(contact, { autoAlpha: gsap.utils.clamp(0, 1, shown - taken) });
    };

    const applyChamberToContactReturn = (progress: number) => {
      contactShownProgress = progress;
      applyContactOpacity();
      // ⚠ The hero star is NOT brought back here, and must not be. The star you watch die is a separate
      // object inside the works scene, faded in by `CONTACT_STAR_PRESENCE` over this same span — see
      // useWorksField's onContactProgress. Restoring this one too would put two stars on screen.

      window.dispatchEvent(
        new CustomEvent<ContactProgressDetail>(CONTACT_PROGRESS_EVENT, {
          detail: { progress },
        }),
      );
    };

    // ── The contact → hero loop ──
    // The dive is an ordinary scrubbed crossing right up until its final value. At exactly 1 the screen
    // is black (the hole's own shadow, plus the veil's guarantee) and the teleport fires underneath it.
    //
    // Declared here but assigned after `playHeroEntrance` exists — the two are mutually recursive in
    // spirit: the crossing lands the jump, the jump plays the entrance.
    let commitTeleport = () => {};
    // Latched so the jump fires ONCE per arrival at the far edge. `apply` runs on every update whose
    // progress moved, and after the teleport the pin immediately reports 0 through this same crossing.
    let teleported = false;
    const applyContactToHeroLoop = (progress: number) => {
      // Reported, never written — applyContactOpacity owns the property. See its note for what writing
      // it directly from here did.
      contactTakenProgress = progress;
      applyContactOpacity();

      window.dispatchEvent(
        new CustomEvent<LoopProgressDetail>(LOOP_PROGRESS_EVENT, {
          detail: { progress },
        }),
      );
      // ⚠ Exactly 1, never a threshold. This is the one irreversible action on the site apart from the
      // intro — once the scrollbar is at 0 there is no scrolling back — so it must never fire because a
      // value drifted to 0.9997. CROSSING_SNAP_EPSILON guarantees the boundary is exact.
      if (progress >= 1 && !teleported) {
        teleported = true;
        commitTeleport();
      } else if (progress < 1) {
        teleported = false;
      }
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
        key: "faq",
        stopCount: CHAMBER_STOP_COUNT,
        // Nothing to commit: the room, the tour and the hologram all run off the reveal landing, and the
        // input lock that covers the lot lives on the crossing (REVEAL_SETTLE_MS).
        crossingAfter: {
          scrollVh: RETURN_SCROLL_VH,
          stepDurationSeconds: RETURN_STEP_DURATION,
          settleMs: RETURN_SETTLE_MS,
          apply: applyChamberToContactReturn,
        },
      },
      {
        key: "contact",
        stopCount: CONTACT_STOP_COUNT,
        // Also nothing to commit — the section is one held pose inside the space, and everything about
        // getting there is scrubbed from the return crossing above.
        crossingAfter: {
          scrollVh: LOOP_SCROLL_VH,
          stepDurationSeconds: LOOP_STEP_DURATION,
          settleMs: LOOP_SETTLE_MS,
          apply: applyContactToHeroLoop,
        },
      },
      {
        key: "loop",
        stopCount: LOOP_STOP_COUNT,
        // The landing pad the dive crosses into, and nothing else — see LOOP_STOP_COUNT for why it has
        // to exist at all. Nobody ever rests here: arriving IS the teleport.
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
      //
      // ⚠ Skipped while the hero's entrance is playing. The loop lands at progress 0, so this runs a
      // frame or two AFTER `playHeroEntrance` has already staged the tagline at 0 and started animating
      // it — and `fade` overwrites, so it would kill the entrance's own tween and replace "settles last"
      // with a plain 0.6s fade. Two owners of one property, and the entrance is the one that should win.
      if (!heroEntrancePlaying) fade(subline, 1, SUB_FADE_DURATION);
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

    // You are back inside the screen, and it is still the works canvas drawing it — so, exactly as with
    // the chamber, the layering does not change and every visual of the return is scrubbed from its span.
    const enterContact = () => {
      heroSection.classList.add(SERVICES_CLASS);
      fade(subline, 0, DECK_REVEAL_DURATION);
    };

    // Nothing to do: the loop stop exists only to be the far edge of the dive, and arriving at it
    // teleports. By the time this could run the screen is already black and the scrollbar is moving.
    const enterLoop = () => {};

    const enterStage: Record<Stage, (fromStage: Stage) => void> = {
      fill: enterFill,
      services: enterServices,
      work: enterWorks,
      faq: enterChamber,
      contact: enterContact,
      loop: enterLoop,
    };
    let currentStage: Stage = "fill";
    // Published once up front too — `setStage` returns early on a no-op, so without this the very
    // first reports (the hero, which is the one section that is only ever ARRIVED at by starting
    // there) would carry no section at all.
    profileGauge("section", currentStage);
    const setStage = (stage: Stage) => {
      if (stage === currentStage) return;
      const fromStage = currentStage;
      currentStage = stage;
      // ⚠ The profiler prints one breakdown every three seconds and, until now, nothing in it said
      // WHICH section the frame belonged to — so a report read off a laptop was un-attributable the
      // moment the page had been scrolled. Per-section cost is the whole question this instrument
      // exists to answer. Free in production: `profileGauge` folds away with `telemetryEnabled`.
      profileGauge("section", stage);
      enterStage[stage](fromStage);

      // ⚠ Published from HERE — the boundary — and not from `enterServices`.
      //
      // The sun's rank, the fluid cursor's gate and the constellation's freeze all mean "a full-black
      // scene is on screen", and all three used to read DECK_REVEAL_EVENT for it. That worked only
      // while the fleet was guaranteed to be the first black scene you met. A navbar jump commits its
      // target stop up front, so this can go straight from "fill" to "work" — services never entered,
      // no deck event, and the ink kept splatting over the rest of the site with the star in front of
      // the marks. Keyed off the fill boundary instead, it cannot depend on the route taken.
      const wasBlack = fromStage !== "fill";
      const isBlack = stage !== "fill";
      if (wasBlack === isBlack) return;
      window.dispatchEvent(
        new CustomEvent<BlackStageDetail>(BLACK_STAGE_EVENT, {
          detail: { active: isBlack },
        }),
      );
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
    /** Set by the loop's teleport, cleared by the next genuine update — see the arrival branch below. */
    let justTeleported = false;
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

    // ── A covered nav jump ──
    // Three beats, each handed off by a signal rather than by a duration: we ask for a cover, the
    // COVER says when it has the screen, we glide, and the PIN says when it has landed. Nothing here
    // knows how long the cover takes to close and nothing over there knows how long the glide takes —
    // which is the whole reason this is three events and not one timed sequence.
    //
    // The glide itself is the ordinary `goToStop`. Nothing is skipped and nothing is snapped: the
    // journey plays in full underneath, so every lazy fetch it triggers on the way (the chamber room,
    // the contact star) happens exactly as it does when you scroll there by hand.
    let coveredJump: { targetStop: number; durationSeconds: number } | null =
      null;
    /** True once the cover has the screen and the glide is actually running under it. */
    let coveredJumpGliding = false;
    /** Whichever net is currently armed — one variable, because only one is ever pending. */
    let coveredJumpNet = 0;
    const armCoveredJumpNet = (delayMs: number, onLapse: () => void) => {
      window.clearTimeout(coveredJumpNet);
      coveredJumpNet = window.setTimeout(onLapse, delayMs);
    };

    const beginCoveredJump = (
      key: string,
      origin: JumpBeginDetail["origin"],
      targetStop: number,
      durationSeconds: number,
    ) => {
      coveredJump = { targetStop, durationSeconds };
      coveredJumpGliding = false;
      // The pin does not move yet — that waits on JUMP_COVERED_EVENT.
      window.dispatchEvent(
        new CustomEvent<JumpBeginDetail>(JUMP_BEGIN_EVENT, {
          detail: { key, origin },
        }),
      );
      armCoveredJumpNet(JUMP_COVER_TIMEOUT_MS, startCoveredGlide);
    };

    const startCoveredGlide = () => {
      if (!coveredJump || coveredJumpGliding) return;
      coveredJumpGliding = true;
      goToStop(coveredJump.targetStop, coveredJump.durationSeconds);
      armCoveredJumpNet(
        coveredJump.durationSeconds * 1000 + JUMP_ARRIVE_GRACE_MS,
        finishCoveredJump,
      );
    };
    const onJumpCovered = () => startCoveredGlide();
    window.addEventListener(JUMP_COVERED_EVENT, onJumpCovered);

    const finishCoveredJump = () => {
      if (!coveredJump) return;
      window.clearTimeout(coveredJumpNet);
      coveredJump = null;
      coveredJumpGliding = false;
      // Covers the cover's opening and whatever entrance plays behind it, so a wheel gesture cannot
      // land on a section that is still arriving.
      lockStepping(JUMP_ARRIVE_HOLD_MS);
      window.dispatchEvent(new Event(JUMP_ARRIVED_EVENT));
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
            // Scrub every crossing in every stage, so even a jump from the top of the page to the
            // last project passes through (and lands in) the right state.
            applyCrossings(self.progress);
            // ⚠ Read AFTER the crossings, never captured before them.
            //
            // `applyCrossings` can TELEPORT. The dive's far edge throws the scrollbar to the top from
            // inside the loop crossing's `apply` (see commitTeleport), so by the time it returns the pin
            // is at the TOP of the page while a value captured above would still say the bottom. Running
            // the rest of this against that stale 1 re-applies the whole ending at the hero, three ways
            // at once: `applyHeroServicesProgress` publishes `fill = 1` and the star is told to be fully
            // cracked — you loop back onto the SERVICES sun; every section's navbar meter fills; and the
            // carousel commits itself to the loop stop it just left.
            //
            // Everything below is idempotent, so re-reading is also all this needs — it is correct
            // whether or not the teleport's own nested update has already run this pass.
            const progress = self.progress;
            // The "home" meter tracks the fill phase only.
            setNavMeter("home", Math.min(progress / fillFraction, 1));
            // The WHOLE circuit as one number, for the orbit dial (see Navbar/OrbitDial). Every other
            // meter answers "how far through THIS section"; the dial's travelling node needs "how far
            // around the whole journey", which is the pin's own progress and nothing else — there is
            // exactly one pin, so this is not an approximation of the journey, it IS the journey.
            setNavMeter("total", progress);
            // Deliberately ABOVE the fill's early return — this span's whole job is inside the fill, and
            // a jump past it still has to land the sun fully open.
            applyHeroServicesProgress(progress);

            // ⚠ A covered jump opens on THIS, not on its scrollTo tween completing. The pin is scrubbed,
            // so its progress trails the scrollbar by up to SCROLL_SCRUB seconds — opening when the tween
            // ends would uncover onto a pin still sliding the last stretch of the journey, which is the
            // very thing the cover is there to hide. Also above the fill's return, so the check cannot be
            // missed by a destination the branch below would have skipped past.
            if (
              coveredJumpGliding &&
              coveredJump &&
              Math.abs(progress - stopProgressValues[coveredJump.targetStop]) <
                JUMP_ARRIVE_EPSILON
            ) {
              finishCoveredJump();
            }

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
            // ⚠ Suppressed for one update after a teleport. Belt-and-braces: the scrub tween is flushed
            // in `commitTeleport` and the progress above is re-read, so this should be unreachable — but
            // if a stale update ever did land here at the old progress it would glide the visitor onto
            // craft 01 and the loop would end in SERVICES instead of the hero. The failure is silent and
            // confusing enough to be worth one boolean. Costs nothing when it does fire: `wasInFill` is
            // only cleared INSIDE the branch, so the arrival is deferred by one update, never lost.
            if (wasInFill && !justTeleported) {
              wasInFill = false;
              // ⚠ Only when nothing else already owns the scroll. There is no momentum to absorb during
              // a committed glide — starting one kills the native scroll — and `goToStop` overwrites, so
              // firing here HIJACKS whatever was under way. That is what made every navbar item clicked
              // from the hero land on Services and need a second click: the jump to Work crossed this
              // line on its way past the fill, and got overwritten with a glide to craft 01.
              if (!committedGlide) {
                lockStepping(CAROUSEL_ARRIVAL_DURATION * 1000);
                goToStop(0, CAROUSEL_ARRIVAL_DURATION);
              }
            }
            justTeleported = false;

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
      //
      // ⚠ Transforms ONLY, and `borderRadius: 0` is deliberately not among them any more. Nothing gives
      // `.hero-sun-card` a radius — check globals.css, there is no rule — so that tween was
      // interpolating 0px to 0px. Not free, though: `border-radius` is a PAINT property, and GSAP wrote
      // it every frame of the fill on an element that by the end of the span covers the whole viewport,
      // so every one of those frames invalidated a full-screen repaint underneath whatever else was
      // drawing. Transforms composite; keeping this list to transforms is what makes the fill cheap.
      scrollTimeline.to(
        heroCardElement,
        {
          x: () => geometry.translateX,
          y: () => geometry.translateY,
          scaleX: () => geometry.scaleX,
          scaleY: () => geometry.scaleY,
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

    // ── The hero's entrance ──
    // Pulled out of `runReveal` so the LOOP can replay it. Only the timeline may be replayed: the pin
    // is built once and once only (`createTransition`), because a second ScrollTrigger on this element
    // is the exact thing the single-pin architecture exists to prevent.
    // True from the moment the hero is staged until its entrance finishes — so `enterFill`, which runs
    // somewhere in the middle of all this, knows not to grab the tagline off it.
    let heroEntrancePlaying = false;

    /**
     * Put the hero back to its pre-entrance pose: headline under its masks, square empty, tagline out.
     *
     * Split from `playHeroEntrance` for the LOOP. On the loop these elements are wherever the last
     * playthrough left them, and the arrival cannot start until the cream has closed over the screen —
     * so there is a window of a second or so where the hero must be staged but must NOT be moving. Play
     * it at the teleport instead and the whole entrance happens under the cover, handing the visitor a
     * fully-built hero the instant it clears.
     */
    const stageHeroEntrance = () => {
      heroEntrancePlaying = true;
      gsap.set(textInners, { yPercent: 115 });
      if (subline) gsap.set(subline, { autoAlpha: 0, y: 12 });
      if (squareFill) gsap.set(squareFill, { clipPath: EMPTY_CLIP });
    };

    const playHeroEntrance = () => {
      if (prefersReducedMotion()) {
        gsap.set(textInners, { yPercent: 0 });
        if (subline) gsap.set(subline, { autoAlpha: 1, y: 0 });
        if (squareFill) gsap.set(squareFill, { clipPath: FULL_CLIP });
        heroEntrancePlaying = false;
        return;
      }

      stageHeroEntrance();
      const revealTimeline = gsap.timeline({
        onComplete: () => {
          heroEntrancePlaying = false;
        },
      });
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

    // 3. Reveal — fired once, when the intro lands the sun in the square. This is also the moment the
    //    pin is allowed to come online (Contract 2).
    let hasRevealed = false;
    const runReveal = () => {
      if (hasRevealed) return;
      hasRevealed = true;
      createTransition();
      playHeroEntrance();
      consumeArrivalHash();
    };

    // ── Arriving from another route with a section in the URL ──
    // `/about` and `/careers` render the same navbar, and off the homepage its items fall through to
    // their real `/#work` hrefs. Something has to be listening on this side or those four links are
    // links that appear to do nothing — which is what they did until the site had a second route to
    // click them from. (`Navbar.tsx` has claimed in a comment since it was written that "the pin picks
    // it up on arrival"; this is the first time that has been true.)
    //
    // It goes through `requestSection` rather than seeking directly, so an arrival gets the identical
    // treatment a click gets: the distance-scaled glide, and the cover if it is far enough to be worth
    // hiding. Called from inside `runReveal` because the pin must EXIST first — `goToStop` no-ops
    // without it, which would leave a covered jump sitting on a black screen.
    function consumeArrivalHash() {
      const key = window.location.hash.slice(1);
      if (!key || !findNavItem(key)) return;
      // Drop the hash before travelling. It has been spent, and leaving it in the URL means a reload —
      // or the loop's teleport back to the hero — silently re-triggering the journey to a section the
      // visitor has since scrolled away from.
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      requestSection(key);
    }

    // ── The teleport ──
    // Runs with the screen already black, so the order below is about what must be TRUE by the next
    // frame rather than about what is seen.
    //
    // ⚠ It runs RE-ENTRANTLY — from a crossing's `apply`, from `applyCrossings`, from the pin's own
    // `onUpdate` — and moves the scroll under all three. Two things depend on knowing that: `onUpdate`
    // re-reads `self.progress` afterwards rather than trusting a captured one, and `LoopVeil` latches
    // its cover rather than following the progress this reports on the way past. Both are noted where
    // they live.
    commitTeleport = () => {
      const trigger = scrollTimeline?.scrollTrigger;
      if (!trigger) return;
      // The gesture that committed the dive is still delivering momentum, and a live scrollTo tween
      // would fight the jump. Kill both before moving.
      gsap.killTweensOf(window);
      committedGlide = false;
      // Straight to the top. No duration: there is nothing to watch, and a tween here would scrub the
      // whole site backwards through every crossing it passes.
      window.scrollTo(0, 0);
      trigger.scroll(0);
      // ⚠ Moving the scrollbar is NOT enough, because this pin is scrubbed (SCROLL_SCRUB = 1.8). Scrub
      // means progress does not follow the scrollbar, it EASES toward it — so after the jump the pin
      // spends nearly two seconds animating from 1 back down to 0, playing the entire site backwards
      // through every crossing on the way.
      //
      // Two things go wrong with that, and the second is worse. The site un-plays where the cream cannot
      // cover it; and the very next update still reports progress ≈ 1, which is `>= fillFraction`, so the
      // arrival branch below fires `goToStop(0)` and glides the visitor onto craft 01 — you land in
      // SERVICES instead of the hero.
      //
      // Flushing the scrub tween to its end makes progress actually be 0 on the next frame.
      trigger.update();
      trigger.getTween()?.progress(1);
      // Everything that EASES toward a target has to stop easing and be there now — otherwise the
      // chamber re-assembles and the star un-dies behind the cover. See LOOP_RESET_EVENT.
      window.dispatchEvent(new Event(LOOP_RESET_EVENT));
      // Re-arm the carousel: the pin is back in the fill, and the next scroll down must glide onto
      // craft 01 rather than resuming from wherever the stepper thought it was.
      currentStop = 0;
      wasInFill = true;
      justTeleported = true;
      lastCommittedIndex.fill(-1);
      lastCrossingProgress.fill(-1);
      // Staged, NOT played. The screen is black and the cream has not closed yet — the hero holds this
      // pose until the veil says it has the screen (LOOP_COVERED_EVENT below), so the entrance is
      // actually watched rather than spent under the cover.
      stageHeroEntrance();
    };

    // ── The cream has the screen; build the hero underneath it ──
    // The entrance and the star's re-gather both start here, so they play THROUGH the cream clearing
    // rather than behind it: the headline rises and the shards close as the colour drains away, which is
    // the arrival reading as the page assembling itself out of the flood.
    const onLoopCovered = () => {
      window.dispatchEvent(new Event(SUN_REGATHER_EVENT));
      playHeroEntrance();
    };
    window.addEventListener(LOOP_COVERED_EVENT, onLoopCovered);

    // The Travel in time button. Routed through the pin rather than scrolling by itself, so the button
    // and the scroll gesture commit the SAME cinematic and cannot drift apart when its length changes.
    const onLoopRequest = () => {
      if (!hasRevealed || teleported) return;
      const loopStop = totalStops - 1;
      if (currentStop >= loopStop) return;
      goToStop(loopStop, reduceMotion ? 0 : LOOP_STEP_DURATION);
      lockStepping(reduceMotion ? 0 : LOOP_STEP_DURATION * 1000 + LOOP_SETTLE_MS);
    };
    window.addEventListener(LOOP_REQUEST_EVENT, onLoopRequest);

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

    // ── The navbar ──
    // Every item and the CTA route through here. The pin owns the scroll, so a link cannot simply jump:
    // the sections are overlays inside this one pin, and an anchor would land on the hero whatever it
    // pointed at.
    //
    // The glide is DISTANCE-SCALED. Hero → contact crosses four sections and three long cinematics, and
    // taking the default 0.6s would scrub the whole site past the visitor in a blur. Scaling it means a
    // near jump stays snappy while a far one reads as travel.
    const onGotoSection = (event: Event) => {
      const request = readGotoSection(event);
      if (request === null) return;
      // A jump already under way owns the screen. A second click during it would interleave two
      // glides under one cover, and the cover would open on whichever finished last.
      if (coveredJump) return;
      const sectionIndex = carouselSections.findIndex(
        (section) => section.key === request.key,
      );
      if (sectionIndex < 0) return;
      const targetStop = layout.sections[sectionIndex].firstStop;
      const trigger = scrollTimeline?.scrollTrigger;
      const distance = Math.abs(
        stopProgressValues[targetStop] - (trigger?.progress ?? 0),
      );
      const durationSeconds = reduceMotion
        ? 0
        : gsap.utils.clamp(
            GOTO_DURATION,
            NAV_JUMP_MAX_DURATION,
            GOTO_DURATION + distance * NAV_JUMP_DURATION_PER_PROGRESS,
          );

      // ── Far enough to hide? ──
      // Measured in SECTIONS, not in progress: what makes a jump unwatchable is how many authored
      // crossings it drags you through, and those are per section boundary rather than per unit of
      // scroll. The hero counts as one before the first section (see HERO_SECTION_INDEX), so
      // hero → Services is adjacent and keeps the fill + the sun cracking open in full view.
      const inFill = !trigger || trigger.progress < fillFraction;
      const currentSectionIndex = inFill
        ? HERO_SECTION_INDEX
        : layout.sectionIndexOfStop(currentStop);
      // `trigger` is required, not incidental: with no pin yet (a click during the intro, before
      // REVEAL_EVENT built it) `goToStop` no-ops, so no update would ever report arrival and the cover
      // would sit on a black screen until its net lapsed. Fall through to the plain path, which
      // degrades to setting the index and nothing else.
      if (
        !reduceMotion &&
        trigger &&
        Math.abs(sectionIndex - currentSectionIndex) >= JUMP_SECTION_DISTANCE
      ) {
        beginCoveredJump(request.key, request.origin, targetStop, durationSeconds);
        return;
      }

      goToStop(targetStop, durationSeconds);
      // Held past the glide so the scene transition it lands on gets to play out, exactly as a step does.
      lockStepping(durationSeconds * 1000 + STAGE_STEP_HOLD_MS);
    };
    window.addEventListener(GOTO_SECTION_EVENT, onGotoSection);

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
    //
    // A covered jump owns it for LONGER than its glide — from the moment the cover starts closing to
    // the moment the pin lands — and owns it regardless of where we are, because one can start from the
    // hero, where `inCarouselRegion` is false and a gesture would otherwise fall through to native
    // scroll and drag the page around underneath the cover.
    const swallowDuringGlide = (event: Event) => {
      if (!coveredJump && !(committedGlide && inCarouselRegion())) return false;
      event.preventDefault();
      scheduleRearm();
      return true;
    };

    const handleWheel = (event: WheelEvent) => {
      // ⚠ This handler is bound `{ passive: false }` and `preventDefault`s every gesture in the
      // carousel region, so it cancels the scrolling of ANYTHING layered over the page as readily as
      // the page's own. Nothing on the site scrolls independently today; if something ever does, it
      // needs an exemption here before it will respond to a wheel at all.
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
      window.removeEventListener(GOTO_SECTION_EVENT, onGotoSection);
      window.removeEventListener(JUMP_COVERED_EVENT, onJumpCovered);
      window.removeEventListener(LOOP_REQUEST_EVENT, onLoopRequest);
      window.removeEventListener(LOOP_COVERED_EVENT, onLoopCovered);
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      window.clearTimeout(fallbackTimeout);
      window.clearTimeout(rearmTimer);
      window.clearTimeout(coveredJumpNet);
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
