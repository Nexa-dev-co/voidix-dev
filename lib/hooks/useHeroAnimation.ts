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
import { readArrivalSection } from "@/lib/arrivalSection";
import {
  BLACK_STAGE_EVENT,
  type BlackStageDetail,
} from "@/lib/blackStageEvent";
import { profileGauge } from "@/lib/frameProfiler";
import {
  REFRAME_SETTLE_EVENT,
  startViewportReframeWatch,
} from "@/lib/viewportReframe";
import {
  JUMP_ARRIVED_EVENT,
  JUMP_BEGIN_EVENT,
  JUMP_COVERED_EVENT,
  STOP_COMMIT_EVENT,
  type JumpBeginDetail,
  type StopCommitDetail,
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
  LOOP_ARRIVED_EVENT,
  LOOP_COVERED_EVENT,
  LOOP_PROGRESS_EVENT,
  LOOP_REQUEST_EVENT,
  LOOP_RESET_EVENT,
  LOOP_REVERSE_BEGIN_EVENT,
  LOOP_REVERSE_COVERED_EVENT,
  LOOP_REVERSE_REQUEST_EVENT,
  LOOP_SNAP_EVENT,
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
// Viewport-heights of scroll the square takes to fill.
//
// ⚠ Shorter on a phone, and the reason is the INPUT, not the screen. A wheel delivers scroll in a
// continuous stream you can keep feeding; a swipe delivers one finite arc of travel and then stops.
// 120vh is about 940px on a 780px phone — more than one comfortable swipe — so the hero was the one
// beat on the site that could not be got through in a single gesture, which is exactly the grammar
// every other span here is built on. Gated on the POINTER rather than the width: a narrow desktop
// window still scrolls with a wheel and wants the long authored version.
const FILL_SCROLL_VH = 120;
const FILL_SCROLL_VH_TOUCH = 80;
const STAGE_SCROLL_VH = 100; // ...and per carousel stop after it (a craft, or a project meteor)
/**
 * How far past the viewport the square is scaled at the end of the fill.
 *
 * ⚠ THE FILL IS A COVER, NOT A FIT. `.hero-sun-card` carries a 1px amber ring as a box-shadow, so a
 * square that lands even half a pixel short does not simply fail to cover — it DRAWS that shortfall,
 * as a lit hairline down the edge of the screen. The reference machine runs at `dpr 1.1`, where a
 * CSS pixel does not land on a device pixel and an exact ratio rounds whichever way it likes.
 *
 * Two percent on a growth of roughly 11× is invisible at every frame of the fill, and the end of the
 * span — where the square is a black backdrop the size of the window — cannot tell the difference at
 * all. ⚠ Scale only: the sun is anchored to the same `geometry` through its TRANSLATE, so this cannot
 * move the star off the square.
 */
const FILL_OVERSCAN = 1.02;
const SUN_SCROLL_SCALE = 1.1; // the sun grows to 1.1× as the square fills
const SUN_SCROLL_RISE = 200; // px the sun lifts above the square's centre and holds
/** One curve for the square AND the sun — they are anchored together. See the phase-1 tween. */
const FILL_EASE = "power1.out";

/**
 * Where in the fill the page BEHIND the hero stops being cream and becomes the page black.
 *
 * ⚠ This exists for a bug you cannot see on a desktop. `.hero-section` is `100svh` — the SMALL
 * viewport, i.e. the height with the browser's chrome showing — and that is deliberate and correct
 * (see the comment on the rule; `dvh` would reflow the pin mid-gesture). But it is a STATIC unit, so
 * the moment a phone browser minimises its own chrome the visible viewport becomes the LARGE one and
 * a strip of page shows beneath the pinned hero. Past the fill that strip is black under black and
 * nobody has ever seen it. On the cream hero it is the most visible thing on the screen — and it
 * grows exactly as the chrome animates, which is what makes the browser's furniture read as the SITE
 * failing to respond to the first scroll. See docs/mobile-polish-plan.md §1.
 *
 * So the strip is always the colour of whatever is covering the screen. That is cream for nearly the
 * whole fill: the square is scaled to cover the viewport at fill 1 and NOT before, so until then the
 * hero's own bottom edge — the pixels directly above the strip — is still cream. Hence a late, short
 * ramp rather than a lerp across the whole span, which would put a grey bar under a cream screen for
 * most of it.
 */
const BAND_BLACKEN_FILL_START = 0.9;

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
/**
 * How long `snapProgress` keeps answering with the reframe's own landing, after a resize.
 *
 * ── ⚠ THE PAGE USED TO SCROLL UP ON ITS OWN, AND THIS IS HALF OF WHY ────────────────────────────
 * A refresh does not merely re-measure — it RE-ARMS SNAPPING (`ScrollTrigger.js:1016`: it clears
 * `lastSnap` so the "already snapped here" guard cannot block, then restarts the delayed call). When
 * that call fires it derives its progress from the RESTORED SCROLL PIXELS against the pin's NEW
 * `start`/`change` — precisely the number the reframe exists to correct — and tweens the scrollbar
 * to whatever this function calls nearest. Idle pages sail through its `getVelocity() < 10` guard,
 * and with velocity 0 its duration expression divides by zero and clamps to SNAP_DURATION_MAX. So:
 * ~0.9 s after the window settles, a 2.2 s glide backwards that nobody asked for.
 *
 * ⚠ DERIVED FROM `SCROLL_SCRUB`, because GSAP's timing is too: the delay is
 * `snap.delay || scrubSmooth / 2`, and `scrubSmooth` IS the `scrub` value. Retune SCROLL_SCRUB and
 * that shot moves; this moves with it. The margin covers the frame the timer lands on.
 *
 * The hold is also dropped by the first real wheel or touch (see `releaseSnapHold`), so it can never
 * answer for a snap the visitor actually asked for.
 */
const REFRAME_SNAP_HOLD_MS = (SCROLL_SCRUB / 2) * 1000 + 300;
/**
 * How far off its target a re-anchored scroll may land before it is written a second time.
 *
 * Two pixels, because the only honest miss is a sub-pixel rounding one — anything larger means the
 * write was CLAMPED by a document that had not yet grown to its new spacer height, and the retry is
 * what fixes that. See the read-back in `reanchorToJourney`.
 */
const REFRAME_LANDING_EPSILON_PX = 2;
/**
 * Floor on a glide resumed after a reframe.
 *
 * The honest remainder can be a few milliseconds — a resize that lands as the crossing is already
 * arriving — and a tween that short is a jump. This is the shortest move that still reads as a move.
 */
const REFRAME_RESUME_MIN_SECONDS = 0.25;
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

// ── The loop, run backwards: hero → contact ──
// See docs/reverse-loop-plan.md. The reverse authors no animation of its own: it parks the scrollbar
// just inside the far end of the dive, under a cover, and then glides it back to contact — so what
// plays is the dive itself, scrubbed the other way.
/**
 * ⚠ HOW FAR "ZOOMED IN" THE RETURN ARRIVES, AND IT IS NO LONGER A POSITION ON THE SCROLLBAR.
 *
 * The reverse used to park the SCROLLBAR partway into the dive and then glide it back to contact. That
 * is why the site was visibly scrolling behind the cover, and it made every frame of the arrival depend
 * on a scrubbed pin reporting exactly what it had been told. It does neither now: the jump lands on the
 * contact stop — the settled state a covered nav jump produces — and the zoom-out is an ARRIVAL that
 * the pin drives itself, through the same channel the dive publishes on. Nothing scrolls.
 *
 * Chosen against the dive's own windows, for the shot rather than for a boundary:
 * · the camera distance is `lerp(1, DIVE_MIN_DISTANCE, d²)`, so 0.66 puts it at ~59 % of contact's —
 *   the hole arrives ~1.7× its resting size, which is what "as if we were zoomed in" looks like.
 * · just BELOW `DIVE_BLACKOUT`'s 0.68, so the shadow is at rest and the hole is fully visible the
 *   instant the iris opens rather than being swallowed by the blackout.
 * · the eased dive is ~0.72 here, so `DIVE_LENSING_STRENGTH` is near full — and its relaxation on the
 *   way down to 0 is the whole point of the return.
 * · well above `LOOP_CONTACT_UI_FADE`'s 0.2, so the copy is still hidden on arrival and comes back at
 *   the END, after the hole has settled. That ordering is free: `applyContactOpacity` reads this value.
 */
const REVERSE_ARRIVAL_DIVE = 0.66;
/**
 * How long the zoom-out takes.
 *
 * `power2.inOut`, deliberately: it lingers at the top, which holds the heavy lensing on screen long
 * enough to read as a shot rather than a flash, then releases and settles gently into the plain hole as
 * the contact copy fades up underneath it.
 */
const REVERSE_ARRIVAL_SECONDS = 5;
/**
 * The lensing SWELLS in before it relaxes, rather than being on at full strength the moment the cover
 * lifts.
 *
 * The first cut armed the dive at `REVERSE_ARRIVAL_DIVE` while the frame was still black, so the iris
 * opened onto a fully-formed lens — the strongest thing in the shot arrived as a pop, and everything
 * after it was a decrease. Ramping up across the reveal means the eye catches the distortion GROWING,
 * which is what reads as arriving somewhere rather than being placed there.
 *
 * `power2.out`: it rushes in and eases into the peak, so the swell is felt early and the top of the
 * curve is calm enough to hand over to the release without a corner.
 */
const REVERSE_SWELL_SECONDS = 1.1;
/**
 * ⚠ The swell starts HERE, not at 0, and the floor is not cosmetic: `LOOP_CONTACT_UI_FADE` ends at 0.2,
 * so a dive below it puts contact's copy back on screen. Starting at 0 would flash the whole section in
 * for a few frames at the top of the return — under a closing iris, but only just. From 0.22 the copy is
 * hidden from the first frame and the lensing still starts faint enough to be seen arriving.
 */
const REVERSE_SWELL_FROM = 0.22;
const REVERSE_WHEEL_THRESHOLD = 180;
/** The accumulator forgets after a quiet gap, so small nudges minutes apart never add up to a journey. */
const REVERSE_WHEEL_IDLE_MS = 500;
/** How close to the pin's own start counts as "at the top". A hair, not a zone. */
const REVERSE_TOP_EPSILON = 0.0015;
/**
 * How long the pin waits for the cover to say it has the screen before going ahead without it.
 *
 * Generous against `LoopVeil`'s ~1.15s flood, because it is a NET and not a schedule — lapsing means
 * the cover failed, and the only thing worse than an uncovered teleport is a page that has stopped
 * answering the wheel. See `beginReverse`.
 */
const REVERSE_COVER_NET_MS = 2600;

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

/**
 * How long the reveal waits for the LOADER to drive a deep-link arrival before driving it itself.
 *
 * On a healthy load this is mooted in the same tick it is armed — `IntroSequence` fires REVEAL_EVENT
 * and then immediately calls `requestSection`, both inside one timeline callback. What it is really
 * sized for is the load with no intro at all: `runReveal` also fires off `REVEAL_FALLBACK_NO_INTRO_MS`
 * on a page whose loader was bypassed or threw, and there nobody else is ever going to honour the URL.
 *
 * Short on purpose. It is not waiting for anything slow — it is only allowing for the handoff being a
 * few frames apart rather than one statement apart, and a visitor left staring at a hero they did not
 * ask for is the failure it exists to bound.
 */
const ARRIVAL_HANDOFF_NET_MS = 1200;

const SUN_LAYER_SELECTOR = ".hero-sun-layer";
const DECK_SELECTOR = ".services-deck";
const DECK_OVERLAY_SELECTOR = ".deck-overlay";
const WORKS_SELECTOR = ".works-field";
const WORKS_OVERLAY_SELECTOR = ".works-overlay";

/** The full-black scene currently on screen — "fill" plus one name per carousel section. */
type Stage = "fill" | "services" | "work" | "faq" | "contact" | "loop";

/**
 * Where the visitor was in the JOURNEY, captured the instant before a ScrollTrigger refresh.
 *
 * The pin's length is `totalScrollVh` × viewport height and GSAP restores the SCROLL POSITION across
 * a refresh, not the progress — so a window that changes height moves the visitor through the site by
 * the ratio of the change. This is what is put back afterwards. See `reanchorToJourney`.
 */
interface ReframeAnchor {
  /** The stop the carousel was committed to. */
  stop: number;
  /** The pin's own progress, which is only meaningful in the fill (see `inFill`). */
  progress: number;
  /** In the free-scrub span before the carousel, where there is no stop to land on. */
  inFill: boolean;
  /**
   * A committed glide was in flight — the visitor is mid-journey, not standing anywhere.
   *
   * ⚠ It changes which number is the truth. At rest the committed STOP is (the scrollbar can be moved
   * by things that are not the visitor); mid-glide the raw PROGRESS is, because that is the frame of
   * the cinematic they are watching and `stop` is only where it is heading.
   */
  gliding: boolean;
  /**
   * `end - start` in pixels, as it was BEFORE the refresh.
   *
   * ⚠ This is the whole test for "did anything actually move". A width-only resize, a late font, an
   * accordion opening on another route — all of these refresh the pin without changing the mapping
   * from pixels to progress, and re-anchoring on those would be a jump where there was no problem.
   * It is also `NaN` before the pin's own construction refresh (`start`/`end` do not exist yet),
   * which is exactly the refresh that must be skipped.
   */
  span: number;
}

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
    // ── The dive, and the TWO things that can drive it ──
    //
    // Forwards it is the SCROLL: the crossing between contact and the loop stop, scrubbed like every
    // other. Backwards there is no scroll at all — the jump lands on the contact stop and the zoom-out is
    // an ARRIVAL the pin tweens. Both end up here, and they are combined rather than allowed to take
    // turns writing, which is the same shape `combineChamberTarget` uses in the works field and for the
    // same reason: one published number, two contributors, an explicit rule for what wins.
    //
    // ⚠ `Math.max`, so the arrival can never be pulled down by the crossing sitting at its resting 0 —
    // which it does for the entire return — and a visitor who scrolls DOWN mid-arrival is handed straight
    // back to the scroll, because the crossing's rising value simply overtakes the decaying one.
    let diveFromCrossing = 0;
    let diveFromArrival = 0;
    /** What was last sent. Nothing downstream benefits from being told the same number twice. */
    let publishedDive = -1;
    const publishDive = () => {
      const progress = Math.max(diveFromCrossing, diveFromArrival);
      if (progress === publishedDive) return;
      publishedDive = progress;
      // Reported, never written — applyContactOpacity owns the property. See its note for what writing
      // it directly from here did.
      contactTakenProgress = progress;
      applyContactOpacity();
      window.dispatchEvent(
        new CustomEvent<LoopProgressDetail>(LOOP_PROGRESS_EVENT, {
          detail: { progress },
        }),
      );
    };

    const applyContactToHeroLoop = (progress: number) => {
      diveFromCrossing = progress;
      publishDive();
      // ⚠ Exactly 1, never a threshold, and read off the CROSSING rather than the published value — the
      // forward teleport may only ever be committed by a real scroll reaching the far edge, never by an
      // arrival that happens to be passing through a high number. This is the one irreversible action on
      // the site apart from the intro, so it must never fire because a value drifted to 0.9997.
      // CROSSING_SNAP_EPSILON guarantees the boundary is exact.
      if (progress >= 1 && !teleported) {
        // ⚠ AND NOT WHILE A RESIZE IS BEING ABSORBED. Reaching 1 is supposed to mean "a real scroll
        // arrived at the far edge of the dive"; a re-anchored or clamped scrollbar can produce the
        // same number without anyone having asked for anything. `reframeHoldProgress` covers the
        // ~1.2 s after a reframe and is dropped by the first genuine wheel or touch, so a visitor who
        // actually scrolls into the hole in that window still gets the loop on their own gesture.
        //
        // This is the site's one irreversible action. It gets a second lock.
        if (reframing || reframeHoldProgress !== null) return;
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

    // Latched, not live: the layout is derived once and every stop's progress hangs off it, so a
    // window dragged across a breakpoint must not re-space the whole journey underneath the visitor.
    // Same reasoning `deviceTier` records for latching its own answer.
    const isTouchInput = window.matchMedia("(pointer: coarse)").matches;

    const layout = computeCarouselLayout(carouselSections, {
      fillScrollVh: isTouchInput ? FILL_SCROLL_VH_TOUCH : FILL_SCROLL_VH,
      stageScrollVh: STAGE_SCROLL_VH,
      settleFraction: CAROUSEL_SETTLE_FRACTION,
    });
    const { fillFraction, carouselStart, stopProgressValues, totalStops } =
      layout;

    // ── Where the reverse loop lands ──
    // Resolved by SEARCH rather than by index arithmetic. Contact is the second-to-last section TODAY,
    // and writing that down would be a landmine for whoever adds a section: `carouselSections` is the one
    // place that is supposed to change.
    const contactSectionIndex = carouselSections.findIndex(
      (section) => section.key === "contact",
    );
    const contactStop =
      contactSectionIndex >= 0 ? layout.sections[contactSectionIndex].firstStop : 0;

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

    // ── The strip a minimised browser chrome uncovers below the pinned hero ──
    // See BAND_BLACKEN_FILL_START for what this is and why it is invisible on a desktop.
    //
    // Both colours are READ, never restated: the cream is `.hero-section`'s own background (a
    // non-token colour, deliberately — see CLAUDE.md) and the black is `body`'s `--bg`. Taking them
    // off the live computed style is what stops the band drifting if either is ever retuned.
    //
    // ⚠ It has to be `body` that gets painted, not `html`: body's box spans the whole document —
    // it contains the pin's spacer — so its own background paints over anything on `html` at exactly
    // the place the strip appears.
    const heroCream = getComputedStyle(heroSection).backgroundColor;
    const bodyBlack = getComputedStyle(document.body).backgroundColor;
    let lastBandColor = "";
    const applyChromeBand = (fill: number) => {
      // At 1 the inline style is dropped rather than set to the black: the stylesheet's own `--bg` is
      // where the ramp lands, so handing back is a no-op on screen and leaves nothing overriding body
      // for the rest of the journey.
      const bandColor =
        fill >= 1
          ? ""
          : gsap.utils.interpolate(
              heroCream,
              bodyBlack,
              gsap.utils.clamp(
                0,
                1,
                (fill - BAND_BLACKEN_FILL_START) / (1 - BAND_BLACKEN_FILL_START),
              ),
            );
      if (bandColor === lastBandColor) return;
      lastBandColor = bandColor;
      document.body.style.backgroundColor = bandColor;
    };
    // Primed here rather than left to the pin's first update, because the pin does not exist until
    // REVEAL and a visitor can reach the hero with the chrome ALREADY minimised — `/about` and
    // `/careers` are ordinary scrolling documents and the navbar's links to them are client-side
    // navigations, so nothing re-expands it on the way back. Safe this early: the intro's veil is
    // `position: fixed; inset: 0`, so it covers the strip whatever colour it is.
    applyChromeBand(0);

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
      const fill = gsap.utils.clamp(0, 1, progress / fillFraction);
      applyChromeBand(fill);
      window.dispatchEvent(
        new CustomEvent<HeroServicesProgressDetail>(HERO_SERVICES_PROGRESS_EVENT, {
          detail: {
            progress: transitionProgress,
            fill,
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
    /**
     * The glide currently animating the scrollbar, if any — its destination, the duration it was given
     * and when it started.
     *
     * Only `reanchorToJourney` reads it, to resume a crossing a resize interrupted with the time that
     * was actually left on it. Cleared wherever `committedGlide` is cleared outside the tween's own
     * `onComplete`, so a teleport can never leave a dead glide here for a later reframe to revive.
     */
    let activeGlide: {
      stop: number;
      durationSeconds: number;
      startedAt: number;
    } | null = null;
    let wasInFill = true;
    /** Set by the loop's teleport, cleared by the next genuine update — see the arrival branch below. */
    let justTeleported = false;

    // ── ⚠ SURVIVING A RESIZED WINDOW ───────────────────────────────────────────────────────────
    // The pin ends at `+=${totalScrollVh}%`, and GSAP parses that percentage against the VIEWPORT
    // HEIGHT — so the pin's length in pixels is a linear function of the window's height. A refresh
    // then records and restores the scroll position in PIXELS (`_recordScrollPositions` →
    // `obj(obj.rec)`), which means the scrollbar is kept and the journey is not: maximise a 720px
    // window to 960 and every progress value drops by a quarter. Standing on project 01, that lands
    // you four percent into the services→works crossing, with nothing to snap you out of it.
    //
    // Worse in the other direction. The pin's spacer IS the document height (everything after
    // `<Hero/>` in page.tsx is `position: fixed` and contributes none), so shortening the window
    // shortens the document and the browser clamps any scroll past the new maximum — and the maximum
    // is progress 1, which is `applyContactToHeroLoop(1)`, which is the teleport. Un-maximising past
    // roughly three quarters of the site fired the loop.
    //
    // See docs/viewport-reframe-plan.md.
    /**
     * A refresh is in flight, so the pin's numbers describe neither the old layout nor the new one.
     *
     * ⚠ It exists because `_refreshAll` runs a FORCED `_updateAll(2)` before any refresh handler can
     * intervene — one update, at the restored pixels against the new geometry, i.e. at exactly the
     * wrong progress. That single update is what could reach `commitTeleport()` off a clamp, and what
     * hijacked the fill-exit arrival branch. Everything it skips is re-driven by hand, on the correct
     * progress, on the same frame.
     */
    let reframing = false;
    let reframeAnchor: ReframeAnchor | null = null;
    /**
     * A net, armed when the anchor is captured. ⚠ It is not belt-and-braces, it closes a real hole.
     *
     * A capture is paired with the global "refresh" dispatch only for a refresh that went through
     * `_refreshAll`. An INDIVIDUAL `trigger.refresh()` also fires `onRefreshInit` (ScrollTrigger.js:830)
     * and dispatches nothing globally, so nothing would ever lower the flag — and a raised flag is a
     * pin whose `onUpdate` has stopped doing anything, i.e. a page that has silently stopped working.
     * Nothing in this file takes that path today; `setPositions` does, and so does anyone who adds a
     * second trigger tomorrow.
     *
     * A frame is the right length because the whole of `_refreshAll` is synchronous: on the normal
     * path this has already been cancelled before a rAF could run.
     */
    let reframeNet = 0;
    /** See REFRAME_SNAP_HOLD_MS. `null` when no reframe is being protected. */
    let reframeHoldProgress: number | null = null;
    let reframeHoldTimer = 0;
    /** The one-frame-later check that the landing actually stuck — see the tail of `reanchorToJourney`. */
    let reframeVerifyFrame = 0;
    /** A loop has been completed at least once, so the way back is armed. Latched for the session. */
    let hasLooped = false;
    /**
     * A reverse is under way and the cover is not up yet.
     *
     * Its only job is to own the gesture for that window — once the teleport has happened,
     * `committedGlide` does it, which is why this is cleared the moment the glide starts rather than
     * timed against anything.
     */
    let reverseActive = false;
    let reverseWheelAccum = 0;
    let reverseWheelIdleTimer = 0;
    /** Armed while waiting for the cover to answer — see beginReverse for why it must exist. */
    let reverseNet = 0;
    /** The return's two beats — the lensing swelling in, then relaxing out. See REVERSE_ARRIVAL_DIVE. */
    let reverseArrival: gsap.core.Timeline | null = null;
    const reverseArrivalProxy = { dive: 0 };
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
      // ⚠ AFTER the scene has been told, so a listener that measures anything measures the stop that
      // is now on its way in. The guard above means this only ever speaks on a real change.
      window.dispatchEvent(
        new CustomEvent<StopCommitDetail>(STOP_COMMIT_EVENT, {
          detail: { key: carouselSections[sectionIndex].key, index: localIndex },
        }),
      );
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
      // ⚠ RECORDED SO A REFRAME CAN RESUME IT AT ITS OWN PACE. Every caller picks a duration that
      // means something — a crossing's authored `stepDurationSeconds`, a distance-scaled nav jump, the
      // carousel's arrival — and none of that is recoverable from the layout afterwards. The first
      // attempt at resuming re-derived a duration from progress across the WHOLE pin, which for a
      // crossing spanning ~0.12 of it came out around a third of the authored length: the flight
      // resumed at triple speed. Carry the real number instead of estimating it.
      activeGlide = { stop, durationSeconds, startedAt: performance.now() };
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
          activeGlide = null;
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
      alreadyCovered = false,
    ) => {
      coveredJump = { targetStop, durationSeconds };
      coveredJumpGliding = false;
      // The pin does not move yet — that waits on JUMP_COVERED_EVENT.
      window.dispatchEvent(
        new CustomEvent<JumpBeginDetail>(JUMP_BEGIN_EVENT, {
          detail: { key, origin, alreadyCovered },
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
      // ⚠ A REFRESH RE-ARMS SNAPPING AND IT FIRES ~0.9 s LATER, off a progress it derived from the
      // restored scroll PIXELS. We have already re-anchored by then, so the honest answer is the
      // reframe's landing — not "whatever is nearest to the number that survived the resize". Without
      // this the page glides backwards on its own for up to SNAP_DURATION_MAX, with no input at all.
      // See REFRAME_SNAP_HOLD_MS for the whole mechanism.
      if (reframeHoldProgress !== null) return reframeHoldProgress;
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

    /**
     * The pin's update, as a function of a progress value rather than of the scrollbar.
     *
     * ── ⚠ WHY THIS IS A FUNCTION AND NOT JUST THE BODY OF `onUpdate` ────────────────────────────
     * Because the reframe has to be able to drive it at the progress it CHOSE, and GSAP's scroll
     * getter cannot be trusted for one frame after a re-anchor. The setter caches the value you
     * ASK for and never reads back what the browser did:
     *
     *     value = cachingFunc.v = Math.round(value);   // cached
     *     f(value);                                    // ...then written  (Observer.js:41-44)
     *
     * So a scroll write the browser CLAMPS — a document that is momentarily shorter than the
     * position being asked for — is invisible to GSAP until the next real `scroll` event bumps
     * `_scrollers.cache`. At that point the pin abruptly reports the clamped progress, and at the
     * document maximum that value is exactly 1, which is `applyContactToHeroLoop(1)`, which is the
     * teleport. That is how a devtools window being closed landed a visitor on the hero with the FAQ
     * panel still hanging on screen. Driving this by hand means the frame never depends on the answer.
     *
     * @param progress               what to drive the crossings with.
     * @param progressAfterCrossings re-read AFTER them, and never captured before them, because
     *   `applyCrossings` can TELEPORT. The dive's far edge throws the scrollbar to the top from inside
     *   the loop crossing's `apply` (see commitTeleport), so by the time it returns the pin is at the
     *   TOP of the page while a value captured above would still say the bottom. Running the rest of
     *   this against that stale 1 re-applies the whole ending at the hero, three ways at once:
     *   `applyHeroServicesProgress` publishes `fill = 1` and the star is told to be fully cracked — you
     *   loop back onto the SERVICES sun; every section's navbar meter fills; and the carousel commits
     *   itself to the loop stop it just left. Everything below is idempotent, so re-reading is also all
     *   this needs — it is correct whether or not the teleport's own nested update has already run.
     */
    const applyPinProgress = (
      progressBeforeCrossings: number,
      progressAfterCrossings: () => number,
    ) => {
      // Scrub every crossing in every stage, so even a jump from the top of the page to the
      // last project passes through (and lands in) the right state.
      applyCrossings(progressBeforeCrossings);
      const progress = progressAfterCrossings();
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
        // ⚠ CLEARED HERE TOO, AND ITS ABSENCE WAS A BUG. `justTeleported` is meant to suppress the
        // arrival glide for ONE update after the loop's teleport; it was only ever cleared below
        // this early return, and after a teleport every update is a fill update. So the flag
        // stayed raised for as long as the visitor stood on the hero, and the first scroll past
        // the fill spent it instead of gliding onto craft 01 — which is the glide that absorbs the
        // flick's momentum, so the second lap of the site landed on craft 02.
        //
        // The guard's real job survives: a STALE update carries the pre-teleport progress (≈1),
        // which is past the fill, so it cannot reach this branch and is still caught below.
        justTeleported = false;
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
    };

    // Where the square + sun must travel/scale to fill the viewport. Measured from the square's
    // *untransformed* layout and recomputed on every ScrollTrigger refresh — see invalidateOnRefresh
    // / onRefreshInit below. This keeps the sun locked to the square on resize.
    const computeGeometry = () => {
      const rect = measureUntransformedRect(heroCardElement);
      const sectionRect = heroSection.getBoundingClientRect();
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight;

      // ── ⚠ A FRACTION OF THE SECTION, RESOLVED AGAINST THE LIVE VIEWPORT ────────────────────────
      //
      // This used to be `viewportWidth / 2 - cardCentreInViewportPixels`, and mixing those two terms
      // is what put a stray vertical line down the middle of the fleet after every resize.
      //
      // The two halves come from DIFFERENT MOMENTS. This runs from `onRefreshInit`, which
      // `_refreshAll` dispatches BEFORE it reverts and re-applies the pin — and a pinned element
      // carries an explicit PIXEL width, still sized to the window as it was. So `viewportWidth` is
      // already the new number while the measured centre is still the old one, and the difference goes
      // straight into the translate: a 1919 px window whose hero was still laid out at 1483 solved a
      // 218 px offset for a square that should not move at all. It is flex-centred; the answer is zero.
      //
      // Measured as a FRACTION of the section and resolved against the live viewport, the stale width
      // cancels out of both terms: a centred card is 0.5 whatever box it was measured in, and 0.5 maps
      // to 0. The card only has to keep its fractional position across the refresh, which flex
      // centring guarantees and pixel arithmetic never did.
      const cardFractionX =
        sectionRect.width > 0
          ? (rect.left + rect.width / 2 - sectionRect.left) / sectionRect.width
          : 0.5;
      const cardFractionY =
        sectionRect.height > 0
          ? (rect.top + rect.height / 2 - sectionRect.top) / sectionRect.height
          : 0.5;

      return {
        translateX: viewportWidth * (0.5 - cardFractionX),
        translateY: viewportHeight * (0.5 - cardFractionY),
        // ⚠ COVER, NOT FIT — see FILL_OVERSCAN. An exact ratio has no tolerance for the sub-pixel
        // rounding a fractional device pixel ratio produces, and this element's own box-shadow ring
        // draws any shortfall as a hairline down the edge of the screen.
        scaleX: (viewportWidth * FILL_OVERSCAN) / rect.width,
        scaleY: (viewportHeight * FILL_OVERSCAN) / rect.height,
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
            // ⚠ THE ONLY MOMENT THE OLD JOURNEY POSITION STILL EXISTS.
            //
            // A per-trigger `onRefreshInit` is also registered as a GLOBAL "refreshInit" listener
            // (ScrollTrigger.js:1191) — that is the path a window resize takes, and it is why this
            // runs at all on one. `_refreshAll` dispatches it AFTER recording the scroll positions
            // and BEFORE reverting anything, so `progress` here is still the pre-resize truth.
            //
            // ⚠ It must keep returning `undefined`: `_refreshAll` calls `.render(-1)` on whatever an
            // onRefreshInit hands back, so returning the anchor object would be a silent trap.
            captureReframeAnchor();
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
            // ⚠ THE REFRESH'S OWN UPDATE IS A LIE AND MUST NOT BE ACTED ON.
            //
            // `_refreshAll` forces one update (`_updateAll(2)`) before any refresh handler runs, at
            // the restored scroll pixels against the newly-measured geometry. Acting on it commits
            // the wrong stop, publishes the wrong fill, and — when a shortened window has clamped the
            // scroll to the document's new maximum — reaches `applyContactToHeroLoop(1)` and fires the
            // teleport. `reanchorToJourney` drives the whole update itself, on the progress it chose,
            // before this frame ends. See the reframe block above.
            if (reframing) return;
            applyPinProgress(self.progress, () => self.progress);
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
      //
      // ⚠ `power1.out`, and it was `power1.inOut` until the mobile pass. An ease-IN on a SCRUBBED
      // tween is a dead zone: the ease's whole job is to accelerate away from rest, but a scrub has
      // no rest to accelerate from — the visitor's own gesture already carries the acceleration, and
      // all the curve does is attenuate their input at the one moment they are asking whether the
      // page is listening. The arithmetic is brutal. `power1.inOut` is `2t²` in its first half, so a
      // tenth of the way through the fill the square had moved TWO per cent of its journey — about
      // 30px of growth on a phone, arriving up to SCROLL_SCRUB seconds late. That is the "nothing is
      // happening, the browser chrome is what's moving" the mobile pass was chasing; the chrome
      // eating the head of the gesture only made a dead zone that was already there impossible to
      // miss. `power1.out` is `1-(1-t)²` — the same tenth is now 19% of the way — and it keeps the
      // authored soft landing, which was always the half of `inOut` that was earning its place.
      //
      // ⚠ The sun's tween below MUST carry the identical ease. It is anchored to the square through
      // the same `geometry`, and two different curves over the same span is how the star comes off it.
      scrollTimeline.to(
        heroCardElement,
        {
          x: () => geometry.translateX,
          y: () => geometry.translateY,
          scaleX: () => geometry.scaleX,
          scaleY: () => geometry.scaleY,
          ease: FILL_EASE,
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
            ease: FILL_EASE, // ⚠ the square's ease, never a second opinion — see the tween above
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

    /**
     * The hero's FINISHED pose, placed rather than played.
     *
     * Reduced motion has always wanted this. So does a deep-link arrival: the visitor asked for
     * another section and the whole handoff happens under a cover, so playing the entrance would
     * spend it where nobody can see it. But it cannot simply be SKIPPED either — the hero is still
     * there, one scroll up from wherever they land, and a hero that never had its entrance is a
     * headline sitting under its masks with an empty square, permanently. (The loop replays the
     * entrance on its way back; scrolling up by hand does not.)
     */
    const settleHeroEntrance = () => {
      gsap.set(textInners, { yPercent: 0 });
      if (subline) gsap.set(subline, { autoAlpha: 1, y: 0 });
      if (squareFill) gsap.set(squareFill, { clipPath: FULL_CLIP });
      heroEntrancePlaying = false;
    };

    const playHeroEntrance = () => {
      if (prefersReducedMotion()) {
        settleHeroEntrance();
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

    // ── Arriving from another route with a section in the URL ──
    // `/about` and `/careers` render the same navbar, and off the homepage its items fall through to
    // their real `/#work` hrefs. Something has to be listening on this side or those four links are
    // links that appear to do nothing — which is what they did until the site had a second route to
    // click them from.
    //
    // ⚠ THE PIN NO LONGER DRIVES THIS ITSELF, AND THE REVERSAL IS THE WHOLE FIX. It used to call
    // `requestSection` right here, at the end of the reveal — which is AFTER the intro has lifted its
    // veil, flown the star into the square and started the hero's entrance. So a visitor who asked for
    // Work got: the hero, then a second full-screen cover closing over it, then the journey. Two
    // curtains with the wrong section shown in the gap between them.
    //
    // The loader is the cover now. `IntroSequence` holds its veil, calls `requestSection` itself with
    // `alreadyCovered`, and unmounts once the transit cover reports it has the screen — so there is one
    // curtain and the hero is never on it. See `readArrivalSection` and IntroSequence's finale.
    //
    // What is left here is the NET. The intro is not guaranteed to exist: `runReveal` also fires off
    // `REVEAL_FALLBACK_NO_INTRO_MS` on a page whose loader was bypassed or threw, and there the old
    // behaviour is exactly right — travel, uncovered, because nothing is covering anything.
    const arrivalSection = readArrivalSection();
    /** True once anything has taken the visitor somewhere — the net must not fire on top of it. */
    let hasHonouredArrival = false;
    let arrivalNet = 0;
    const armArrivalNet = () => {
      if (!arrivalSection) return;
      arrivalNet = window.setTimeout(() => {
        if (hasHonouredArrival) return;
        requestSection(arrivalSection);
      }, ARRIVAL_HANDOFF_NET_MS);
    };

    // 3. Reveal — fired once, when the intro lands the sun in the square. This is also the moment the
    //    pin is allowed to come online (Contract 2).
    let hasRevealed = false;
    const runReveal = () => {
      if (hasRevealed) return;
      hasRevealed = true;
      createTransition();
      // An arrival is going somewhere else and does it under a cover, so the entrance would be spent
      // unwatched. Placed rather than played — see `settleHeroEntrance` for why not simply skipped.
      if (arrivalSection) settleHeroEntrance();
      else playHeroEntrance();
      armArrivalNet();
    };

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
      activeGlide = null;
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
      // The way back exists from here on. Latched for the session: having once been through the hole,
      // the visitor knows what is at the other end of it. See LOOP_ARRIVED_EVENT.
      hasLooped = true;
      // ⚠ A return's zoom-out may not survive into a fall. Nothing normally runs both — the reverse
      // locks the stepper for its whole length — but the two write the same published value, so the one
      // that is leaving retires its contribution rather than leaving it to be maxed against.
      reverseArrival?.kill();
      reverseArrival = null;
      diveFromArrival = 0;
      // Staged, NOT played. The screen is black and the cream has not closed yet — the hero holds this
      // pose until the veil says it has the screen (LOOP_COVERED_EVENT below), so the entrance is
      // actually watched rather than spent under the cover.
      stageHeroEntrance();
    };

    // ── The teleport, run backwards ──
    // Also runs with the screen covered, so this too is about what must be TRUE by the next frame.
    //
    // ⚠ It is NOT the mirror of `commitTeleport` in one respect, and that difference is the whole reason
    // LOOP_SNAP_EVENT exists: the forward jump can tell every scene to be at ZERO, because it knows the
    // destination is the top. This one lands somewhere the scenes have to be told about, so it drives
    // the crossings to the new position ITSELF and only then asks them to stop easing. Fire the snap
    // first and every scene lands on the state it is leaving.
    const commitReverseTeleport = () => {
      const trigger = scrollTimeline?.scrollTrigger;
      if (!trigger) return;

      // ⚠ THE CONTACT STOP, FULL STOP — not a position partway into the dive.
      //
      // The first build parked the scrollbar inside the dive and then glided it back, so that the return
      // WAS the crossing scrubbed the other way. It is a lovely idea and it cost three separate defects:
      // the site was visibly scrolling behind the cover, every frame of the arrival depended on a
      // scrubbed pin landing exactly where it was told, and the one destination the pin could not be
      // trusted to report was the one it had just been thrown to.
      //
      // Landing on a STOP removes all three at once. It is the state a covered nav jump to contact
      // produces, which has worked since the navbar was wired; the pin then sits perfectly still for the
      // whole arrival; and a stale report during the scrub's settle clamps to the crossing's resting 0,
      // which `applyCrossings` skips as unchanged. The zoom-out is authored instead — see the tween in
      // `onLoopReverseCovered`, and `publishDive` for how the two contributors combine.
      const targetProgress = stopProgressValues[contactStop];
      const targetScroll =
        trigger.start + targetProgress * (trigger.end - trigger.start);

      // Whatever the visitor was doing with the scrollbar, we own it now.
      gsap.killTweensOf(window);

      // ⚠ EVERY PIECE OF BOOKKEEPING `onUpdate` READS IS SET *BEFORE* THE SCROLLBAR MOVES, AND THE
      // ORDER IS THE WHOLE FIX.
      //
      // `trigger.update()` below drives the pin's `onUpdate` SYNCHRONOUSLY. This jump lands PAST the
      // fill, so that update reaches the fill-exit arrival branch — and with `wasInFill` still true it
      // fires `goToStop(0)`, gliding the visitor onto CRAFT 01. The return ended in Services.
      //
      // The forward teleport never had to think about this: its destination is progress 0, inside the
      // fill, so its update takes the early return and the branch is unreachable. Nothing about that
      // safety transfers to a jump that lands anywhere else — and the branch's own header records it
      // having hijacked a navbar jump and the forward loop the same way. This is the third.
      //
      // `justTeleported` is belt to the reordering's braces: it exists to suppress exactly this branch
      // for one update after a teleport, and a reverse is a teleport.
      committedGlide = false;
      activeGlide = null;
      currentStop = contactStop;
      wasInFill = false;
      justTeleported = true;
      lastCommittedIndex.fill(-1);
      lastCrossingProgress.fill(-1);

      window.scrollTo(0, targetScroll);
      trigger.scroll(targetScroll);
      // Same pair as the forward teleport, and for the same reason: this pin is SCRUBBED, so moving the
      // scrollbar only moves the target. Without the flush the pin would spend ~1.8s easing down the
      // whole page — forwards, this time, playing every crossing on the way.
      trigger.update();
      trigger.getTween()?.progress(1);

      // ⚠ DRIVEN BY HAND, and the order matters. `trigger.update()` makes the progress true "on the next
      // frame" (the forward teleport's own note says so), which is one frame too late for a snap that has
      // to read the new targets. Both of these are pure functions of the progress they are handed, so
      // this is not a duplicate of the pin's work — it IS the pin's work, done now instead of next frame.
      applyCrossings(targetProgress);
      applyHeroServicesProgress(targetProgress);
      window.dispatchEvent(new Event(LOOP_SNAP_EVENT));
    };

    // ── The teleport nobody asked for: a resized window ──
    //
    // Third member of the family above, and it reads as one because it IS one — the pin is moved
    // outright to a stop and every scene is told to be there. The difference is only in who asked:
    // the loop is a cinematic the visitor committed to, this is the window manager, and the whole job
    // is to make it look like nothing happened at all.
    //
    // See the reframe block near `justTeleported` for what goes wrong without it.
    /**
     * Where the page is scrolled to, read the way GSAP reads it.
     *
     * ⚠ NOT `window.scrollY`, AND THE DIFFERENCE IS NOT THEORETICAL. Under Chrome's device emulation
     * `pageYOffset` reports 0 while `documentElement.scrollTop` carries the real position — caught in a
     * console trace showing `scrollY = 0` on the same frame the pin resolved its progress to 0.7615.
     * The fallback chain below is exactly the one ScrollTrigger's own scroller function uses
     * (`Observer.js:56`), which is the strongest available evidence that the first term cannot be
     * trusted on its own. The same shape shows up with the visual viewport on mobile.
     *
     * Every read-back in the reframe goes through this. A re-anchor that verifies itself against a
     * number the platform is lying about is worse than one that does not verify at all.
     */
    const readScrollTop = () =>
      window.pageYOffset ||
      document.documentElement.scrollTop ||
      document.body.scrollTop ||
      0;

    const releaseReframe = () => {
      reframing = false;
      reframeAnchor = null;
    };

    const captureReframeAnchor = () => {
      const trigger = scrollTimeline?.scrollTrigger;
      if (!trigger) return;
      // ── ⚠ INSIDE THE REFRAME WINDOW, WE OUTRANK THE SCROLLBAR ────────────────────────────────
      //
      // A resize is a BURST, and closing a docked devtools panel is several of them seconds apart —
      // so more than one refresh can arrive, each capturing a fresh anchor. Between any two of them
      // the browser may have moved the scroll on its own (a re-clamp, scroll anchoring, a window
      // manager still settling). Read the pin then and the capture faithfully records the page's
      // mistake as the visitor's position — and the next re-anchor obediently lands there. That is a
      // resize burst laundering a stray scroll into the site's own idea of where you are, and it ends
      // on the hero because 0 is where a confused scrollbar goes.
      //
      // `reframeHoldProgress` is the last place WE put the visitor, and it is only up for ~1.2 s and
      // is dropped by the first genuine wheel or touch. While it stands, it is the better answer.
      const held = reframeHoldProgress;
      const progress = held ?? trigger.progress;
      // ── ⚠ WHEN THE PROGRESS AND THE COMMITTED STOP DISAGREE, THE STOP WINS ───────────────────
      //
      // They are not two readings of one thing. `currentStop` only ever changes through a deliberate
      // commitment — a step, a jump, a resolved landing — whereas the progress is whatever the
      // scrollbar happens to say, and the scrollbar is a shared resource that browsers, extensions and
      // devtools all write to. Observed: entering Chrome's device emulation resets the page to the top,
      // so the anchor read `progress=0, stop=8` — a visitor standing in the FAQ, described as standing
      // on the hero — and the re-anchor faithfully preserved the reset instead of the visitor.
      //
      // The fill is the only span with no stop of its own, and leaving it downward walks `currentStop`
      // back to 0 on the way (see `commitStop` in `applyPinProgress`), so `stop === 0` is a true
      // statement about being there rather than a leftover.
      const inFill = currentStop === 0 && progress < fillFraction;
      reframeAnchor = {
        stop: currentStop,
        progress,
        inFill,
        gliding: committedGlide,
        span: trigger.end - trigger.start,
      };
      reframing = true;
      cancelAnimationFrame(reframeNet);
      reframeNet = requestAnimationFrame(releaseReframe);
    };

    const releaseSnapHold = () => {
      if (reframeHoldProgress === null) return;
      reframeHoldProgress = null;
      window.clearTimeout(reframeHoldTimer);
      reframeHoldTimer = 0;
    };

    const reanchorToJourney = (anchor: ReframeAnchor) => {
      const trigger = scrollTimeline?.scrollTrigger;
      if (!trigger) return;

      // ⚠ NEVER THE LOOP STOP, AND THIS IS THE MOST IMPORTANT LINE IN THE BLOCK. That stop is a
      // landing pad whose arrival teleports (see `applyContactToHeroLoop`), so re-anchoring onto it
      // would commit the site's one irreversible action off a window resize. A visitor caught inside
      // the dive comes back to contact, which is where the reverse loop puts them too.
      const targetStop = Math.min(anchor.stop, contactStop);
      // ── ⚠ WHERE THE VISITOR WAS, WHICH IS NOT ALWAYS A STOP ──────────────────────────────────
      //
      // Three cases, and the middle one was wrong for a while:
      //
      //  · MID-JOURNEY (a glide is committed). The raw progress, so the visitor keeps their place
      //    inside the crossing and it plays on. Landing them on `currentStop` instead completed the
      //    cinematic instantly — the resize SKIPPED the animation, which is a worse failure than the
      //    one this whole system exists to fix. A resize should be invisible, not a fast-forward.
      //  · AT REST past the fill. The committed stop, NOT the raw progress — see the note in
      //    `captureReframeAnchor` about a scrollbar that something else has moved under us.
      //  · IN THE FILL. The fraction, because that is what the square's coverage is a function of and
      //    there is no stop there to land on.
      const targetProgress =
        anchor.gliding || anchor.inFill
          ? anchor.progress
          : stopProgressValues[targetStop];
      // ⚠ Rounded the way ScrollTrigger rounds its own snap destination
      // (`Math.round(start + endValue * change)`), so the re-armed snap computes the pixel we are
      // already standing on and its `endScroll !== scroll` guard is false outright. Braces to
      // REFRAME_SNAP_HOLD_MS's belt: either alone stops the self-scroll, and float drift is exactly
      // the kind of thing that makes "either alone" stop being true.
      //
      // ⚠ AND CLAMPED TO WHAT THE DOCUMENT CAN ACTUALLY HOLD. Asking for a position past the end of
      // the page does not fail, it LANDS ON THE END — which on this page is progress 1, which is the
      // teleport. See `applyPinProgress` for why that clamp is invisible until a frame later.
      const maxScroll = ScrollTrigger.maxScroll(window);
      const targetScroll = Math.min(
        maxScroll,
        Math.round(trigger.start + targetProgress * (trigger.end - trigger.start)),
      );

      // Whatever was moving the scrollbar, its target is in stale pixels. A committed glide's
      // DESTINATION is `currentStop`, which is what we are landing on — so killing the tween finishes
      // the journey rather than abandoning it.
      gsap.killTweensOf(window);

      // ⚠ Set BEFORE the scrollbar moves, for the reason `commitReverseTeleport` spells out at
      // length: the pin's update runs against these, and a landing past the fill with `wasInFill`
      // still true fires `goToStop(0)` and glides the visitor onto craft 01.
      // ⚠ HELD TRUE ACROSS A MID-JOURNEY REFRAME. `applyPinProgress` resolves the nearest stop and
      // commits it whenever nothing owns the scroll — and the nearest stop to a progress halfway
      // through a crossing is not where the visitor is going. Leaving the glide committed keeps
      // `currentStop` as the DESTINATION, which is what the scene is already staged for.
      committedGlide = anchor.gliding;
      currentStop = anchor.inFill ? 0 : targetStop;
      wasInFill = anchor.inFill;
      justTeleported = true;
      // ⚠ `lastCommittedIndex` and `lastCrossingProgress` are deliberately NOT reset, which is the one
      // place this parts company with the two teleports. They clear those because they are changing
      // section and want a fresh commit; we are landing on the stop the scenes are ALREADY showing, so
      // clearing them would re-fire `setActiveStop` and replay a craft swap that has no reason to play.

      window.scrollTo(0, targetScroll);
      // ⚠ WRITE, READ BACK, WRITE AGAIN IF IT MISSED — and the read is what makes the retry work.
      // A scroll write is clamped to the document's CURRENT height, and at this instant the pin's
      // spacer has just been given a new pixel height whose layout may not have flushed. Reading
      // `scrollY` forces that flush, so a second write lands where the first could not. One retry,
      // not a loop: if it still misses, the page genuinely cannot hold the position and the hand-driven
      // update below is what keeps the site correct anyway.
      if (Math.abs(readScrollTop() - targetScroll) > REFRAME_LANDING_EPSILON_PX) {
        window.scrollTo(0, targetScroll);
      }
      // ⚠ THE SCROLLBAR IS READ BACK, NOT ASSUMED. `trigger.scroll(v)` writes `v` straight into GSAP's
      // cache and never checks what the browser did with it, so handing it our REQUEST would plant a
      // number that disagrees with the page — and the disagreement surfaces a frame later, when a
      // `scroll` event clears the cache and the pin abruptly reports the truth. Feed it the truth now.
      trigger.scroll(readScrollTop());
      trigger.update();
      // Same pair as the two teleports: moving a SCRUBBED pin only moves its target, so without the
      // flush it spends ~1.8 s easing there, playing every crossing on the way.
      trigger.getTween()?.progress(1);

      // ⚠ DRIVEN BY HAND, AT THE PROGRESS WE CHOSE — and `reframing` is still raised, so the
      // `trigger.update()` above changed nothing. That is the whole point of `applyPinProgress` taking
      // a number: this frame does not depend on the scroll cache being honest, on layout having
      // flushed, or on the document already being tall enough. Whatever the scrollbar ended up saying,
      // the site is put into the state the anchor asked for — and no crossing can reach 1 on the way.
      // ⚠ ARMED BEFORE ANYTHING IS DRIVEN, not after. It is the second lock on the teleport as well as
      // the answer the re-armed snap gets (see REFRAME_SNAP_HOLD_MS), and `reframing` comes down a few
      // lines below — so raising it afterwards would leave a gap between the two with neither in force.
      reframeHoldProgress = targetProgress;
      window.clearTimeout(reframeHoldTimer);
      reframeHoldTimer = window.setTimeout(releaseSnapHold, REFRAME_SNAP_HOLD_MS);

      applyPinProgress(targetProgress, () => targetProgress);
      reframing = false;
      window.dispatchEvent(new Event(LOOP_SNAP_EVENT));

      // ── ⚠ AND THE JOURNEY IS RESUMED, NOT ABANDONED ─────────────────────────────────────────
      //
      // `gsap.killTweensOf(window)` above stopped the glide, and it had to: its target is a PIXEL
      // figure solved against the old pin length, so letting it run would land the visitor at a
      // progress nobody asked for. But killing it is only half — without this the crossing simply
      // stops wherever the resize caught it and waits for a gesture.
      //
      // ⚠ WITH THE TIME THAT WAS ACTUALLY LEFT ON IT, taken from `activeGlide` rather than re-derived.
      // The first cut solved a duration from progress across the whole pin — and a crossing spans
      // about a tenth of that, so the flight resumed at roughly triple speed. Every caller of
      // `goToStop` already picked a duration that means something; the only honest answer is that
      // number minus however much of it has been spent.
      const resume = activeGlide;
      if (anchor.gliding && resume) {
        const spentSeconds = (performance.now() - resume.startedAt) / 1000;
        goToStop(
          resume.stop,
          Math.max(
            REFRAME_RESUME_MIN_SECONDS,
            resume.durationSeconds - spentSeconds,
          ),
        );
      }

      // ⚠ A cover that never lifts is worse than any transition. If the glide was NOT resumed above,
      // its arrival check may never run, so the jump is landed by hand — `finishCoveredJump`
      // early-returns when there is no jump, so this costs nothing the rest of the time. When it WAS
      // resumed the cover must stay down: the journey is still travelling under it, and the ordinary
      // arrival check in `applyPinProgress` will open it on landing, with `coveredJumpNet` behind that.
      if (coveredJumpGliding && !anchor.gliding) finishCoveredJump();

      // ── ⚠ AND CHECK, ONE FRAME LATER, THAT WE ARE STILL THERE ────────────────────────────────
      //
      // Everything above runs SYNCHRONOUSLY inside a resize handler, and several things that move a
      // scrollbar do not: the browser re-clamps after it finishes reflowing, scroll anchoring runs
      // after layout, and a window manager animating a panel closed can report its size in stages.
      // Any of them lands after the last line of this function and silently undoes it — which is
      // exactly what "I closed devtools and ended up on the hero" was, with the site's own state
      // correctly at the FAQ and the scrollbar somewhere else entirely until the next scroll event
      // resolved the disagreement in the scrollbar's favour.
      //
      // A frame later all of that has happened. So: look, and if the page moved, put it back and
      // re-drive. Once, not in a loop — a second miss means something owns the scroll that we should
      // not be fighting, and the site is still in the state the anchor asked for.
      cancelAnimationFrame(reframeVerifyFrame);
      reframeVerifyFrame = requestAnimationFrame(() => {
        const settled = scrollTimeline?.scrollTrigger;
        if (!settled) return;
        const settledSpan = settled.end - settled.start;
        if (!(settledSpan > 0)) return;
        const expected = Math.min(
          ScrollTrigger.maxScroll(window),
          Math.round(settled.start + targetProgress * settledSpan),
        );
        if (Math.abs(readScrollTop() - expected) <= REFRAME_LANDING_EPSILON_PX) return;
        reframing = true;
        window.scrollTo(0, expected);
        settled.scroll(readScrollTop());
        settled.update();
        settled.getTween()?.progress(1);
        applyPinProgress(targetProgress, () => targetProgress);
        reframing = false;
      });
    };

    // ⚠ THE GLOBAL "refresh" EVENT, NOT THE TRIGGER'S OWN `onRefresh`.
    //
    // Two reasons. The trigger's own callback runs while `_refreshingAll === 2`, i.e. while GSAP is
    // still in the middle of restoring the scroll-position cache it is about to hand back — moving the
    // scrollbar there fights it. The global dispatch is the first line after `_refreshingAll = false`.
    // And this way the re-anchor is tied to the thing that actually breaks the pin — a REFRESH,
    // whatever caused it — rather than to a resize heuristic that a late font would slip past.
    const onScrollTriggerRefresh = () => {
      const anchor = reframeAnchor;
      reframeAnchor = null;
      cancelAnimationFrame(reframeNet);
      // ⚠ `reframing` is lowered HERE on every path that does not re-anchor, and by
      // `reanchorToJourney` itself on the one that does — it has to stay raised across the whole of
      // that function, because the pin's own `update()` in the middle of it must not be acted on.
      if (!anchor) {
        reframing = false;
        return;
      }
      const trigger = scrollTimeline?.scrollTrigger;
      if (!trigger) {
        reframing = false;
        return;
      }
      // `NaN` on the pin's own construction refresh, and equal on any refresh that did not change the
      // pixels-to-progress mapping — a width-only resize, a font landing, an observer firing. Both are
      // refreshes with nothing to correct, and re-anchoring on them would be a jump where there was no
      // problem. See ReframeAnchor.span.
      // ── ⚠ A SKIPPED RE-ANCHOR STILL OWES THE PIN AN UPDATE ──────────────────────────────────
      //
      // `reframing` suppressed the forced `_updateAll(2)` that `_refreshAll` runs, on the promise that
      // the update would be re-driven on a better number. Returning here breaks that promise, and the
      // frame is simply LOST — so if the refresh moved the scroll for any reason of its own, the pin's
      // published state stays where it was and the site shows one section while the pin is at another.
      //
      // Measured, not theorised: Chrome's device emulation resets the page scroll when you enter it.
      // The pin went to progress 0 with `currentStop` still 8, this branch swallowed the update that
      // would have said so, and the site sat there rendering the FAQ over a hero it had already
      // returned to — until an unrelated resize ran an update and the truth arrived all at once.
      //
      // So: skip the RE-ANCHOR, never the update.
      const resumeWithoutReanchor = () => {
        reframing = false;
        applyPinProgress(trigger.progress, () => trigger.progress);
      };

      // The pin's own construction refresh — there is no previous mapping to preserve.
      if (!(anchor.span > 0)) {
        resumeWithoutReanchor();
        return;
      }
      // Nothing about the pixels-to-progress mapping moved, so there is nothing to correct.
      if (anchor.span === trigger.end - trigger.start) {
        resumeWithoutReanchor();
        return;
      }
      reanchorToJourney(anchor);
    };
    ScrollTrigger.addEventListener("refresh", onScrollTriggerRefresh);

    // ── ⚠ AND THE REFRESH ITSELF HAS TO BE FORCED, BECAUSE GSAP'S OWN ONE GETS DEFERRED FOREVER ──
    //
    // `_resizeDelay` calls `_refreshAll` with no `force`, and the first thing `_refreshAll` does with
    // that is put itself off:
    //
    //     if (_lastScrollTime && !force && !_isReverted) {
    //         _addListener(ScrollTrigger, "scrollEnd", _softRefresh);
    //         return;
    //     }
    //
    // It waits for `scrollEnd`, which `_updateAll` only dispatches after 200 ms with no scrolling at
    // all. That is a sound default for a document and close to unreachable HERE: this pin is scrubbed,
    // the carousel moves the scrollbar with `scrollTo` tweens, and the re-anchor above writes it too —
    // so something is nearly always setting `_lastScrollTime` and the resize refresh keeps being
    // postponed.
    //
    // ⚠ WHAT THAT COSTS IS NOT SUBTLE, AND IT IS NOT THE PIN'S POSITION. ScrollTrigger writes the
    // pin-spacer's width in PIXELS, and only inside `_swapPinIn`, behind `if (!pin._gsap.swappedIn)`
    // (ScrollTrigger.js:373) — so that width is only ever as fresh as the last refresh. Miss the
    // refresh and the spacer keeps the old number; `.hero-section` is `width: 100%` of it, every
    // overlay inside is `inset: 0`, and the whole site renders into a box short by exactly the amount
    // the window grew, with the page's black background filling the rest. Measured in a console trace:
    // `window 1745 · spacer 1211 · section 1211 · box 1211`, unchanged for four seconds.
    //
    // So the settle asks for a FORCED refresh — `ScrollTrigger.refresh()` is `_refreshAll(true)`, which
    // skips the deferral. It is the pin's owner asking for the pin to re-measure, which is why it lives
    // here rather than in the reframe module (which reports and does not act) or in `HeroSun` (which
    // used to own a private copy of this on its own timer, racing GSAP's — see its header).
    const onReframeSettle = () => ScrollTrigger.refresh();
    const stopReframeWatch = startViewportReframeWatch();
    window.addEventListener(REFRAME_SETTLE_EVENT, onReframeSettle);

    // ── The cream has the screen; build the hero underneath it ──
    // The entrance and the star's re-gather both start here, so they play THROUGH the cream clearing
    // rather than behind it: the headline rises and the shards close as the colour drains away, which is
    // the arrival reading as the page assembling itself out of the flood.
    const onLoopCovered = () => {
      window.dispatchEvent(new Event(SUN_REGATHER_EVENT));
      playHeroEntrance();
      // The hero's return control renders on this and not before — see LOOP_ARRIVED_EVENT. Announced
      // here rather than at the teleport so it arrives WITH the rest of the hero, as part of the page
      // assembling itself out of the flood, instead of appearing on a black screen a second earlier.
      window.dispatchEvent(new Event(LOOP_ARRIVED_EVENT));
    };
    window.addEventListener(LOOP_COVERED_EVENT, onLoopCovered);

    // ── The loop, run backwards ──
    // Two ways in (the hero's control, and the wheel pushed up at the top) and ONE commit path, for the
    // reason the forward loop gives: a control that moved the scrollbar itself would be a second route
    // through one cinematic, and the two would drift the first time its length changed.
    const canReverse = () =>
      hasRevealed &&
      hasLooped &&
      !reverseActive &&
      !coveredJump &&
      // The hero is still assembling out of the cream. Leaving through a door that is still being built
      // is the one moment this must refuse — and it is also the window a visitor is most likely to
      // flick through, having just watched the page move on its own.
      !heroEntrancePlaying &&
      !!scrollTimeline?.scrollTrigger &&
      scrollTimeline.scrollTrigger.progress <= REVERSE_TOP_EPSILON &&
      window.scrollY <= 0;

    const beginReverse = () => {
      if (!canReverse()) return;
      reverseActive = true;
      reverseWheelAccum = 0;
      window.clearTimeout(reverseWheelIdleTimer);
      // ⚠ THE NET, AND IT IS NOT OPTIONAL. Between here and the cover answering, `reverseActive` makes
      // this hook swallow every wheel and every touch (see swallowDuringGlide) — so if the answer never
      // comes, the page is not merely stuck on the hero, it is UNSCROLLABLE. `LoopVeil` is mounted in
      // page.tsx and will normally answer in about a second, but "normally" is not a guarantee: an
      // effect that has not run yet, a throw inside it, a future refactor that moves the component.
      //
      // It PROCEEDS rather than aborting, which is the same call `armCoveredJumpNet` makes for the same
      // situation: a transition the visitor can see is a blemish, a page that ignores the wheel is a
      // bug report. Worst case the reverse simply plays in the open.
      window.clearTimeout(reverseNet);
      reverseNet = window.setTimeout(onLoopReverseCovered, REVERSE_COVER_NET_MS);
      // Ask for the cover. Nothing moves until it answers — see LOOP_REVERSE_COVERED_EVENT.
      window.dispatchEvent(new Event(LOOP_REVERSE_BEGIN_EVENT));
    };

    const onLoopReverseRequest = () => beginReverse();
    window.addEventListener(LOOP_REVERSE_REQUEST_EVENT, onLoopReverseRequest);

    // The cover has the screen. Everything below happens unwatched, and the pin is moved SYNCHRONOUSLY
    // inside this dispatch — the veil relies on that, because the frame it paints next assumes the dive
    // is already parked at its far end.
    function onLoopReverseCovered() {
      // Also the guard against the net and the veil both arriving — whichever is second is a no-op.
      if (!reverseActive) return;
      window.clearTimeout(reverseNet);

      // ⚠ ARMED BEFORE THE JUMP, not after. `commitReverseTeleport` applies the crossings, and the dive
      // crossing at the contact stop is 0 — so if the arrival were armed afterwards the very first frame
      // out from under the cover would publish contact's RESTING state: no lensing, no zoom, and the copy
      // already on screen. The whole return would be over before the iris finished opening.
      reverseArrivalProxy.dive = REVERSE_SWELL_FROM;
      diveFromArrival = REVERSE_SWELL_FROM;

      commitReverseTeleport();

      // ⚠ Set the stage explicitly rather than waiting for the pin to resolve it. We came from `fill`,
      // so nothing has added `.is-services` — and the cover would lift on a cream page with the hero's
      // headline still on it. `setStage` no-ops when the pin agrees a frame later.
      setStage("contact");

      // ── The zoom-out ──
      // The only authored animation in the whole feature, and it is an ARRIVAL rather than a crossing:
      // the pin is standing still at the contact stop and this walks the dive down from "zoomed in" to
      // "here". Everything it drives — the camera's distance, the lensing's strength and liquid, the
      // horizon's shadow, the contact copy's fade — is already a pure function of that one number, so
      // there is nothing else to write.
      const publishArrival = () => {
        diveFromArrival = reverseArrivalProxy.dive;
        publishDive();
      };
      reverseArrival?.kill();
      reverseArrival = gsap.timeline({
        onComplete: () => {
          reverseArrival = null;
          // Exactly 0, not 0.0001: from here the crossing owns the dive again and the two must agree.
          diveFromArrival = 0;
          publishDive();
        },
      });
      // 1 · The swell — the distortion growing as the iris uncovers it. See REVERSE_SWELL_SECONDS.
      reverseArrival.to(reverseArrivalProxy, {
        dive: REVERSE_ARRIVAL_DIVE,
        duration: reduceMotion ? 0 : REVERSE_SWELL_SECONDS,
        ease: "power2.out",
        onUpdate: publishArrival,
      });
      // 2 · …and the release: the zoom-out, the lensing relaxing into a plain hole, the copy returning.
      reverseArrival.to(reverseArrivalProxy, {
        dive: 0,
        duration: reduceMotion ? 0 : REVERSE_ARRIVAL_SECONDS,
        ease: "power2.inOut",
        onUpdate: publishArrival,
      });

      lockStepping(
        reduceMotion
          ? 0
          : (REVERSE_SWELL_SECONDS + REVERSE_ARRIVAL_SECONDS) * 1000 +
              LOOP_SETTLE_MS,
      );
      // Nothing is left to cover: the pin does not move again, and the arrival owns the stepper's lock.
      reverseActive = false;
    }
    window.addEventListener(LOOP_REVERSE_COVERED_EVENT, onLoopReverseCovered);

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
      // Whatever asked, the visitor is being taken somewhere — so the arrival net has nothing left to
      // catch. Set for ANY accepted request, not only one carrying the arrival key: the net's job is
      // "did anything happen", and a hero left standing is the only outcome it exists to prevent.
      hasHonouredArrival = true;
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
      // ⚠ A request that arrives ALREADY COVERED has no plain path available to it. The loader is
      // holding an opaque screen that only `JUMP_ARRIVED_EVENT` will open, so both of the escape
      // hatches below — reduced motion, and the distance rule — would strand the visitor on black
      // with nothing coming. It is not "prefer the covered path" here, it is the only one that ends.
      //
      // (Neither would fire in practice: an arrival starts at the hero, and every section is at least
      // `JUMP_SECTION_DISTANCE` from it. The point is that the guarantee must not rest on that.)
      //
      // `trigger` is required, not incidental: with no pin yet (a click during the intro, before
      // REVEAL_EVENT built it) `goToStop` no-ops, so no update would ever report arrival and the cover
      // would sit on a black screen until its net lapsed. Fall through to the plain path, which
      // degrades to setting the index and nothing else. An already-covered request is the exception
      // even to that — `JUMP_ARRIVE_GRACE_MS` opening on the hero is a worse arrival than the one
      // asked for, but it is an arrival; the plain path there would simply never uncover.
      if (
        request.alreadyCovered ||
        (!reduceMotion &&
          trigger &&
          Math.abs(sectionIndex - currentSectionIndex) >= JUMP_SECTION_DISTANCE)
      ) {
        beginCoveredJump(
          request.key,
          request.origin,
          targetStop,
          durationSeconds,
          request.alreadyCovered,
        );
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
    // ⚠ `reverseActive` is on this list for exactly the reason `coveredJump` is. A reverse begins at the
    // HERO, where `inCarouselRegion` is false and the pin has not moved yet, so for the second or so the
    // cream takes to close, every gesture would fall through to native scroll and drag the page around
    // underneath the cover. It stops being needed the instant the teleport lands, which is when
    // `committedGlide` takes over — see `onLoopReverseCovered`.
    const swallowDuringGlide = (event: Event) => {
      if (
        !coveredJump &&
        !reverseActive &&
        !(committedGlide && inCarouselRegion())
      ) {
        return false;
      }
      event.preventDefault();
      scheduleRearm();
      return true;
    };

    // ── Scrolling up at the top asks for the reverse ──
    // Wheel only, and the omission is deliberate: on a phone the equivalent gesture is a pull-down at
    // the top of the page, which is the platform's pull-to-refresh. Claiming it would mean breaking
    // refresh for anyone who had completed a loop, to save them a tap on a control that is right there.
    const tryReverseWheel = (deltaY: number): boolean => {
      if (deltaY >= 0) {
        // Any downward intent abandons the attempt outright. This must never fire off the tail of a
        // gesture that was trying to go INTO the site and overshot the top.
        reverseWheelAccum = 0;
        return false;
      }
      if (!canReverse()) return false;
      reverseWheelAccum -= deltaY;
      window.clearTimeout(reverseWheelIdleTimer);
      reverseWheelIdleTimer = window.setTimeout(() => {
        reverseWheelAccum = 0;
      }, REVERSE_WHEEL_IDLE_MS);
      if (reverseWheelAccum < REVERSE_WHEEL_THRESHOLD) return false;
      beginReverse();
      return true;
    };

    const handleWheel = (event: WheelEvent) => {
      // The visitor is driving again, so the reframe's protected answer retires — from here on the
      // only snap that can fire is one they asked for, and it must get the honest nearest stop.
      releaseSnapHold();
      // ⚠ This handler is bound `{ passive: false }` and `preventDefault`s every gesture in the
      // carousel region, so it cancels the scrolling of ANYTHING layered over the page as readily as
      // the page's own. Nothing on the site scrolls independently today; if something ever does, it
      // needs an exemption here before it will respond to a wheel at all.
      if (swallowDuringGlide(event)) return;
      // Above the carousel check, because at the top of the page `carouselDirection` returns 0 and this
      // would never be reached. `preventDefault` only once it has actually committed: while the wheel is
      // still accumulating, an upward scroll at scroll 0 does nothing anyway, and swallowing it early
      // would cost the platform's own overscroll feel for no gain.
      if (tryReverseWheel(event.deltaY)) {
        event.preventDefault();
        return;
      }
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
      releaseSnapHold(); // see handleWheel
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
      window.removeEventListener(LOOP_REVERSE_REQUEST_EVENT, onLoopReverseRequest);
      window.removeEventListener(LOOP_REVERSE_COVERED_EVENT, onLoopReverseCovered);
      window.clearTimeout(reverseWheelIdleTimer);
      window.clearTimeout(reverseNet);
      reverseArrival?.kill();
      window.removeEventListener("wheel", handleWheel);
      window.removeEventListener("touchstart", handleTouchStart);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleTouchEnd);
      ScrollTrigger.removeEventListener("refresh", onScrollTriggerRefresh);
      window.removeEventListener(REFRAME_SETTLE_EVENT, onReframeSettle);
      stopReframeWatch();
      cancelAnimationFrame(reframeNet);
      cancelAnimationFrame(reframeVerifyFrame);
      window.clearTimeout(reframeHoldTimer);
      window.clearTimeout(fallbackTimeout);
      window.clearTimeout(rearmTimer);
      window.clearTimeout(coveredJumpNet);
      window.clearTimeout(arrivalNet);
      // Hand `body` back to the stylesheet — this hook is the only writer of that inline style, and
      // leaving a cream one behind would outlive the homepage on a client-side route change.
      document.body.style.backgroundColor = "";
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
