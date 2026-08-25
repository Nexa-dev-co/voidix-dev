import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { LENSING_SHADER } from '@/lib/lensingShader';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { HANDOFF_PROGRESS_EVENT, readHandoffProgress } from '@/lib/handoffEvents';
import { computeFlightPose, createFlightPose, METEOR_SHARED_POSITION } from '@/lib/handoffFlightPath';
import { flightPullbackScale, portraitPullbackScale } from '@/lib/portraitPullback';
import { createStoneMaterial } from '../meteorMaterial';
import { getWorksTuning } from '../worksTuning';
import type { WorksProject } from '../worksProjects';
import { MARK_CHANGE_SECONDS } from '../worksTransition';
import { prepareMarks } from '../prepareMarks';
import { createAccretionMark } from '../transitions/accretionTransition';
import type { MarkTransitionStrategy } from '../transitions/markTransition';
import { createSpacePresentMaterial } from '@/lib/spacePresentMaterial';
import { CHAMBER_PROGRESS_EVENT, readChamberProgress } from '@/lib/chamberEvents';
import { CONTACT_PROGRESS_EVENT, readContactProgress } from '@/lib/contactEvents';
import {
  LOOP_PROGRESS_EVENT,
  LOOP_RESET_EVENT,
  LOOP_SNAP_EVENT,
  readLoopProgress,
} from '@/lib/loopEvents';
// The chamber belongs to its own section, but it is drawn by THIS renderer — a GPU texture cannot
// cross a WebGL context, and the space it displays is rendered here. So the works field hosts it.
import {
  createChamberScene,
  type ChamberScene,
} from '@/components/sections/Chamber/chamberScene';
// Hosted here for the same reason the chamber is: it has to be drawn by THIS renderer. The chamber
// because a GPU texture cannot cross a context; the star because lensing can only bend what is already
// in this framebuffer. See docs/contact-singularity-plan.md §3.
import {
  createSingularityScene,
  CONTACT_BLOOM_STRENGTH,
  type SingularityScene,
} from '@/components/sections/Contact/singularityScene';
import { createFrameTimer } from '@/lib/frameTimer';
import { hideHologram } from '@/lib/hologramPose';
import {
  MAX_DEFERRED_STRETCH,
  isViewportSettled,
  startViewportReframeWatch,
} from '@/lib/viewportReframe';
import { publishSunParallaxPose, clearSunParallaxPose } from '@/lib/sunParallaxPose';
import { createWorksHud } from '../worksHud';
import {
  reportAssetProgress,
  reportSourceActivity,
  reportWarmupDone,
  areEntrySourcesReady,
  onAssetProgress,
  isStageQuiet,
  ASSETS_WARMUP_EVENT,
} from '@/lib/assetLoadProgress';
import {
  getControllerFps,
  getPixelRatio,
  getStarFrameCost,
  getSunPixelRatio,
  hasEarnedExtraQuality,
  noteRatioApplied,
  RATIO_APPLY_GRACE_SECONDS,
  reportBurnIn,
  reportProbedFrameCost,
  reportSectionCosts,
  sampleFrame,
} from '@/lib/adaptivePixelRatio';
import {
  profileGauge,
  profileMeasure,
  profileNow,
  profileSpan,
} from '@/lib/frameProfiler';
import { measureGpuFrameCost } from '@/lib/gpuProbe';
import { detectKtx2Support } from '@/lib/modelLoading';
import { getDeviceTier, isLowPowerDevice, type DeviceTier } from '@/lib/deviceTier';
import { telemetryEnabled } from '@/lib/telemetryEnabled';
import { warmSceneMaterials } from '@/lib/warmScene';
import {
  BURN_IN_DONE_EVENT,
  BURN_IN_EVENT,
  INTRO_MARKER_SELECTOR,
  SUN_DRAW_PERMIT_EVENT,
  SUN_MEASURE_BEGIN_EVENT,
  SUN_MEASURE_END_EVENT,
} from '@/components/effects/IntroSequence/introEvents';
import { SLATE_200, SLATE_400, SLATE_800 } from '@/lib/coolPalette';

// ── Textures ────────────────────────────────────────────────────────────
// The DEBRIS texture: dark basalt shot through with glowing lava veins, worn as plain rock by the
// ambient shards. It used to clothe the section's body too, as both albedo and emissive map — the
// mark loads its own pair instead (cold black stone, opening onto geode druse), because that look is
// a pairing chosen together rather than one image doing two jobs. See accretionTransition.ts.
// Built from textures-src by `npm run optimize:textures` — never edit the file in public/ directly.
const TEXTURE_SURFACE = '/textures/meteor/basalt-magma.webp';

// ── Camera / framing ────────────────────────────────────────────────────
// The fallback field of view. Every authored key carries its own (see worksTuning), so this is only
// what the camera starts at before the path has been sampled.
const CAMERA_FOV = 38;
// How finely the camera path is measured for even pacing. The path is short and smooth, so this is
// plenty — it only has to beat the eye's ability to notice a speed change.
const PATH_ARC_SAMPLES = 128;

// ── Warp travel — the "punch between planets" feeling ────────────────────
// The trip is time-based (not a constant lerp) so it launches, cruises, then arrives: the eased
// progress means the camera accelerates out of one planet and decelerates into the next. That speed
// curve then drives the star-streaks and an FOV kick, so the three read as one warp.
// Paced to read as a real trip between planets rather than a cut: with the scroll now stepping one
// project per gesture, this warp IS the transition the user sees, so it gets room to breathe. The
// hero pin holds its input lock (STAGE_STEP_HOLD_MS) across roughly this long.
// How long a hop takes is authored (`travelSeconds` in worksTuning); this is only its shape.
const TRAVEL_EASE = 'power3.inOut'; // accelerate → cruise → decelerate (the launch/arrive arc)
// Camera speed (world units/second) that maps to a full-intensity warp. Kept in step with the hop
// duration: a slower hop means a lower peak camera speed, so raising this leaves the streaks and the
// FOV kick barely registering.
const WARP_REFERENCE_SPEED = 12;
const WARP_SMOOTHING = 0.22;        // ease the measured speed so streaks/FOV don't flicker frame to frame
const FOV_KICK = 8;                 // degrees the FOV widens at peak warp (38 → 46), punching the launch
// Star-streaks: at peak warp each star stretches into a light-line this long (view-space units) and
// the streak layer fades up to this opacity. Restrained-cinematic, not a game hyperdrive.
const STREAK_MAX_LENGTH = 7;
const STREAK_MAX_OPACITY = 0.8;

// ── Drag-to-look (orbit the camera a clamped amount to peek at neighbours) ──
const DRAG_YAW_SENSITIVITY   = 0.005; // radians of orbit per pixel
const DRAG_PITCH_SENSITIVITY = 0.004;
const DRAG_YAW_CLAMP   = 0.6;
const DRAG_PITCH_CLAMP = 0.4;
const VIEW_RETURN_EASE = 0.06; // spring the look-offset back to centre on release

// ── The one body ─────────────────────────────────────────────────────────
// There used to be four rocks and the camera flew between them; then one carved rock that re-morphed.
// Now it is the project's MARK, cut into interlocking stones and grown out of a core — and the camera
// moves around it, so a project is a camera POSE rather than a place (see worksTuning.ts).
//
// It does not spin. The camera path is what goes around, and a body that also turned would fight it.
// The float below is all the motion it has of its own, so a parked mark still breathes.
const FLOAT_AMPLITUDE = 0.12; // gentle vertical bob
const FLOAT_SPEED     = 0.9;

// ── The services → works flight (the CAMERA flies in; the body + debris stay put) ──
// During the handoff the field camera rides the SAME shared path as the deck ship (see
// lib/handoffFlightPath.ts), offset so the field's origin — where meteor 01 sits — lands on the
// shared meteor spot. So the debris reads ahead → surrounding as we fly in, and the two canvases
// composite as one continuous space. Eased at the same rate as the deck so the cameras stay locked
// together (any drift between them would make the ship shimmer against the field).
const FLIGHT_CAMERA_SMOOTHING = 0.09;

// Below this handoff progress the field is still fully transparent — useHeroAnimation fades
// .works-field in over [0.33, 0.55] — so there's nothing on screen to draw. Kept a touch under 0.33
// for margin so the first visible frame is never clipped. (Only gates the DRAW; the loop keeps
// easing every frame so the field camera stays locked to the deck ship through the handoff.)
const WORKS_RENDER_THRESHOLD = 0.28;

// ── The works → chamber reveal ───────────────────────────────────────────────────────────────────
// The camera backs up and the space turns out to be a display in a room. The room is its own scene,
// drawn by THIS renderer (a texture can't cross a WebGL context), swapped into the screen pipeline's
// RenderPass in place of the full-bleed quad. At progress 0 the display exactly fills the frustum, so
// the swap is invisible — see components/sections/Chamber/chamberScene.ts.
const CHAMBER_ENGAGE_EPSILON = 0.001;
/**
 * Below this, a crossing's progress counts as "not running" — so a resolution change may take its
 * frame-long stall here without a moving camera to jump behind it. Same value the flight's own
 * `handoffActive` uses.
 */
const CROSSING_IDLE_EPSILON = 0.001;

// ── The loader's burn-in ───────────────────────────────────────────────────────────────────────────
/**
 * Frames drawn and thrown away before timing begins. The resize just above may have reallocated both
 * composers, and that frame is the cost of switching resolutions rather than the cost of holding one.
 */
const BURN_IN_DISCARD_FRAMES = 3;
/** Enough samples for a median to mean something, PER PHASE. A 30 fps machine reaches this in ~0.3 s. */
const BURN_IN_TARGET_SAMPLES = 9;
/** Below this the phase is thrown away and the runtime calibration handles it instead. */
const BURN_IN_MIN_SAMPLES = 5;

/**
 * Above this, a frame carried a long task and is not evidence about rendering.
 *
 * ⚠ THIS IS HALF THE FIX FOR A BURN-IN THAT REFUSED ON EVERY WARM LOAD. Measured on a dpr 2.5 laptop:
 * `burn-in REFUSED — only 0 usable frames in 2545 ms`, and on another load `0 usable frames in
 * 15786 ms`. Nothing was wrong with the sampler; the loader simply had 15 long tasks totalling 4.7 s
 * running through it, so individual frames were 850 ms and in one case ~5 s. Counting those as frame
 * times would have reported a 0.2 fps machine — which is why they were never counted — but throwing
 * the WHOLE reading away because of them is how the measurement came to never happen at all.
 *
 * Rejecting the individual frame and carrying on is what a median wants anyway.
 */
const BURN_IN_SANE_FRAME_MS = 120;
/**
 * The same judgement on a device whose ordinary frame is already near the strict cap.
 *
 * ── ⚠ MEASURED ON AN iPhone, 2026-08-13, AND IT IS HALF OF WHY THE BURN-IN NEVER RAN THERE ───────
 * `docs/sun-mobile-quality-plan.md` §3.1 has the capture. Phase B on that device:
 *
 *     phase "B · field + star"   1 sample @ ratio 1.00: 84
 *     burn-in REFUSED  not enough usable frames in 3376 ms (needs 5 per phase)
 *
 * The field alone ran ~34 ms/frame; the field WITH the star ran ~150. So at 120 the filter was not
 * rejecting long tasks in phase B — **it was rejecting the frame the visitor actually gets**, on the
 * one device where that frame is the whole subject. One sample slipped under the cap, and a phase that
 * cannot reach `BURN_IN_MIN_SAMPLES` refuses, which refuses the entire burn-in and leaves the quality
 * allocator inert for the session.
 *
 * ⚠ The discriminator "is this frame evidence, or is it a stall" cannot be one number across a 5×
 * range of device speed. On a machine whose honest frame is 150 ms, 120 does not mean "unusually slow",
 * it means "typical".
 *
 * ⚠ IT DOES NOT LOOSEN THE SETTLE LOOP, which keeps the strict value deliberately — see
 * `waitForQuietMainThread`. That loop asks a different question ("has the main thread gone quiet"),
 * and it asks it while only the FIELD is drawing, at ~34 ms on this same phone. Raising its threshold
 * would make it declare calm on frames that are not.
 */
const BURN_IN_SANE_FRAME_LOW_POWER_MS = 260;
/**
 * How long to wait for the main thread to go quiet before sampling starts.
 *
 * The stage is cued when both SCENES report *warm*, and warm means "compiled", not "the page has
 * finished loading". So this waits for the machine to actually be doing nothing before it starts
 * asking how fast it is.
 *
 * ── ⚠ 800 → 4000, BECAUSE 800 WAS LOOKING IN THE WRONG PLACE ────────────────────────────────────
 * Measured on a dpr 2.5 laptop, second attempt at this fix:
 *
 *     8.6s   table.glb lands
 *     8.7s   black_hole.glb lands — 1.99 MB, then a Draco decode
 *     8.8s   the burn-in starts                    ← inside the decode
 *    10.0s   REFUSED, 1164 ms, no usable frames    ← the [frame] report covering this window
 *                                                    reports 6 long tasks totalling 3361 ms
 *    14.4s   `long tasks: none`, 38 fps            ← the quiet window, four seconds later
 *    16.1s   load complete
 *
 * The chamber's table and the contact black hole are not part of the gate that cues this stage, so the
 * measurement was being taken inside their decode every single time. The settle gate was right and its
 * budget was wrong: it failed honestly in 1164 ms instead of silently in 15786 ms, but it cannot
 * manufacture quiet that does not exist inside its window.
 *
 * ⚠ This costs the LOADER nothing on a normal load. The reveal already waits for every asset source
 * (see IntroSequence, "What the reveal actually waits for: EVERY source") — so this is not new waiting,
 * it is the same waiting with the measurement moved to the part of it that is quiet.
 */
const BURN_IN_SETTLE_MAX_MS = 4000;
/**
 * The same budget on a device that cannot spend it well.
 *
 * ⚠ The settle loop DRAWS while it waits (deliberately — it has to reach the state the measurement is
 * taken in). On a machine whose works frame is already near `BURN_IN_SANE_FRAME_MS` that is close to
 * self-defeating: the drawing helps keep the frames long, quiet never arrives, and the full budget is
 * spent before sampling starts anyway. Such a machine's reading is going to be floored whatever it
 * says, so the four seconds buy nothing and cost a phone four seconds of loader.
 */
const BURN_IN_SETTLE_MAX_LOW_POWER_MS = 1200;
/** Consecutive sane frames that count as "the main thread has gone quiet". */
const BURN_IN_CALM_FRAMES = 3;
/**
 * Per-phase sampling deadline.
 *
 * ⚠ Sized so SETTLE + two PHASES fit inside `BURN_IN_WAIT_MAX_MS` in IntroSequence, past which the
 * loader stops waiting and the finale plays over a burn-in still rendering works frames — the exact
 * thing the finale is given a quiet GPU to avoid. 4000 + 600 + 600 = 5200; that constant is 5500.
 * **Move either and you must move the other.**
 */
const BURN_IN_PHASE_MAX_MS = 600;
/**
 * The same deadline on a slow device — LONGER, which is the opposite of how the settle budget scales.
 *
 * ── ⚠ THE OTHER HALF OF THE iPhone REFUSAL ───────────────────────────────────────────────────────
 * A phase needs `BURN_IN_DISCARD_FRAMES + BURN_IN_MIN_SAMPLES` = 8 frames before it can answer at all.
 * At 600 ms that is a demand for **≤ 75 ms per frame** — which phase A meets and phase B, by
 * construction, cannot: phase B is the same phase plus the most expensive object on the page.
 *
 *     phase A   field alone     ~34 ms/frame   →  12 frames in ~410 ms  →  9 samples  ✓
 *     phase B   field + star   ~150 ms/frame   →   4 frames in  600 ms  →  1 sample   ✗
 *
 * A deadline one phase can meet and the other structurally cannot is not a deadline, it is a
 * guaranteed refusal. The settle budget shrinks on a slow device because drawing while it waits is
 * self-defeating there; this must GROW, because a slow device needs more wall clock to reach the same
 * sample count. Same reasoning, opposite sign.
 *
 * ⚠ THE SERIAL BUDGET STILL FITS, and this is the constraint that sizes the number:
 *
 *     settle (low power)  1200        BURN_IN_SETTLE_MAX_LOW_POWER_MS
 *     phase A             1800        here
 *     phase B             1800        here
 *     ───────────────────────────
 *                         4800   <  5500   BURN_IN_WAIT_MAX_MS   ✓
 *     SUN_PERMIT_FALLBACK_MS 4800  >=  settle + ONE phase (3000) ✓
 *
 * **Move this and you must re-check both of those**, exactly as the strict value's note says.
 *
 * ⚠ It buys a device up to ~2.4 s more loader. Deliberate, and the same trade the settle budget
 * already makes: the loader is holding regardless, and the alternative is a whole session rendered at
 * an unmeasured resolution.
 *
 * ⚠ It does not rescue EVERY device, and the limit is worth naming: 8 frames inside 1800 ms is
 * ~225 ms/frame. Slower than that and the phase still refuses — correctly, since the runtime
 * calibration is then the better instrument anyway. `BURN_IN_MIN_SAMPLES` is deliberately NOT lowered
 * to chase it; five is already thin for a median, and buying time is the honest fix.
 */
const BURN_IN_PHASE_MAX_LOW_POWER_MS = 1800;
/**
 * The smallest star cost worth believing, in ms.
 *
 * Two medians taken a few hundred milliseconds apart differ by a couple of tenths on a quiet machine.
 * Below this floor the difference between the phases is jitter, and handing it to the allocator as
 * "what the star costs" would divide by very nearly nothing and hand the star its ceiling.
 */
const MIN_CREDIBLE_STAR_MS = 0.6;
/**
 * The largest share of the frame the star may claim before the split is disbelieved.
 *
 * The star is genuinely the most expensive surface per pixel on this page, so a large share is not by
 * itself suspicious — but a phase A that got lucky (or a phase B that caught a stall the sane-frame
 * filter let through at 119 ms) can put it near 1, and the field would then be allocated almost
 * nothing. This is a bound on the failure, not a claim about the star.
 */
const MAX_CREDIBLE_STAR_SHARE = 0.8;
/**
 * How long the burn-in will wait for the star to time itself before giving up and using phase B.
 *
 * ⚠ A BOUND, NOT A HANDSHAKE. The star answers from its own rAF loop and is entitled to refuse the
 * pose outright — before its model has landed, under reduced motion, or once the assembly has been
 * cued. A refusal must cost the fallback below, never a loader wedged behind `BURN_IN_WAIT_MAX_MS`.
 *
 * Generous, because on the normal path the wait is short: the star needs one posed frame before it may
 * measure (see `posedFramesDrawn`) and then three drained draws. Eight frames covers that even on a
 * device rendering at 150 ms, and any device slower still has a refusal waiting for it anyway.
 */
const STAR_SELF_MEASURE_MAX_FRAMES = 8;
/**
 * ⚠ A HARD CEILING IN TIME, and it is not decoration. This stage is capped by `BURN_IN_WAIT_MAX_MS`
 * (2.5 s) in IntroSequence, and past that the gate stops waiting and moves on regardless. A burn-in
 * bounded only by a frame count would, on a 5 fps machine, still be rendering works frames while the
 * loader's finale played — which is the exact thing the finale is given a quiet GPU to avoid.
 *
 * (An earlier version of this comment cited `WARMUP_WAIT_MAX_MS` at 3.5 s. That constant is 5000 and
 * it caps the stage BEFORE this one — the burn-in got its own cap when it became its own stage.)
 */
const BURN_IN_MAX_MS = 1500;
/** Belt and braces on the loop itself, so a pathological rAF cadence cannot spin it. */
const BURN_IN_MAX_FRAMES = 48;
const CHAMBER_SCRUB_END = 0.999; // past this you're standing in the room → let adaptive resolution resume
const CHAMBER_SMOOTHING = 0.09; // per-frame ease toward the scrubbed target, as the crossings all do

// ── The room draws at full rate; its display's FEED does not ──
/**
 * How many frames stage 1 may skip between draws once the camera is standing in the room.
 *
 * Deep in the chamber this renderer is drawing a full-screen space scene — starfield, debris, bloom
 * pyramid, the whole stage — onto a panel that occupies a small fraction of the frame and is seen at
 * an angle, while the thing the visitor is actually looking at is a ROOM. Stage 2 keeps painting at
 * full rate; stage 1 updates every Nth frame and stage 2 re-paints whatever `spaceComposer.readBuffer`
 * last held, which is exactly what it does on a frame where nothing in space moved anyway.
 *
 * Nothing in that scene moves fast here. The mark has been removed, drag-to-look is refused in the
 * room, and what is left is a starfield and slow debris.
 *
 * ⚠ Derived per frame from the room's own progress: no flag, no timer, no threshold on an eased
 * value. Rule 2 of the scroll spine — it reverses for free and cannot be outrun.
 *
 * ⚠ The CONTACT return is excluded outright rather than left to fall out of the progress, and the
 * distinction is the justification above read carefully. As the return runs, the fall streaks open,
 * the star fades back in and the singularity arrives — things in space start moving again. The
 * progress does walk this back toward 1 on its own, but `chamberState.current` EASES, so a hard flick
 * out of the room leaves the room's value lagging its target by ~180 ms while the finale is already
 * under way. Excluding the return states the real condition instead of relying on a race.
 */
const CHAMBER_SPACE_STRIDE_MAX = 2;
/**
 * The window is keyed to the PULL-BACK, not chosen by taste.
 *
 * `TOUR_START` (0.55, in chamberScene) is where the camera finishes backing off the display's normal.
 * Below it the picture is still growing back toward filling the frustum, and a two-frame-old camera
 * inside a near-full-bleed picture is plainly visible. So the ramp is placed to be back at stride 1
 * before the pull-back does any of its work, and only reaches its maximum well inside the tour.
 *
 * It also clears the instrument frame, which rides in stage 1 as a composer pass: `HUD_FADE_WINDOW`
 * ends at 0.16 and `HUD_EXPOSURE_RECOVER` — the −5.6 EV climbing back to nominal, the one thing on it
 * that visibly animates — ends at 0.42. Both are finished before this opens.
 */
const CHAMBER_SPACE_STRIDE_WINDOW: readonly [number, number] = [0.5, 0.72];

// ── The camera feed's instrument frame (worksHud.ts) ──
//
// ⚠ It appears ONLY as the reveal starts — as the display's edges come into frame — and never during
// works itself. This is the whole point and it is easy to get backwards (it was, first time).
//
// The room is a plot twist. Nobody is supposed to see it coming. A camera HUD standing over the works
// section for its entire length ANNOUNCES the twist several minutes before it lands: the visitor reads
// "FEED 02/04" and knows they are looking at a screen, so backing out of one is a confirmation rather
// than a surprise. Held back until the edges show, the same readouts do the opposite job — they arrive
// with the realisation and explain it retroactively, which is what makes the pull-back land.
//
// Keyed to the REVEAL's progress, not the field's. Starts a hair off zero, where the display still
// exactly fills the frustum and there is nothing yet to give away.
const HUD_FADE_WINDOW: readonly [number, number] = [0.02, 0.16];
/**
 * How far the feed stops down, as a bump rather than a ramp.
 *
 * A remote camera swinging near a star protects its sensor, then reopens once it is clear — so this
 * rises with the turn away (over the window the star actually leaves in, OPAQUE_WINDOW /
 * REVEAL_SUN_FADE) and RECOVERS to nominal across the tour.
 *
 * The recovery is the part that earns its place. The frame only fades up at 0.02–0.16, by which time
 * the star has already gone, so a readout that merely sat pinned at its floor would explain nothing
 * and never move. Arriving mid-recovery, it is caught in the act: the visitor sees −5.6 EV climbing
 * back to 0.0 and understands, without being told, what happened to the light.
 */
const HUD_EXPOSURE_MAX_STOPS = 5.6;
const HUD_EXPOSURE_STOP_DOWN: readonly [number, number] = [0.0, 0.12];
const HUD_EXPOSURE_RECOVER: readonly [number, number] = [0.18, 0.42];

// ── Contact: the fall toward the black hole ──
// Ramped across the back half of the return, so the tails open up as the display grows back to fill the
// frame rather than while you are still watching a small rectangle across a room.
const CONTACT_FALL_WINDOW: readonly [number, number] = [0.35, 1];
/**
 * How hard the fall streaks, against the travel warp's full punch.
 *
 * Well under 1 on purpose. The warp's maximum is a hop between two projects — a violent, half-second
 * event. This is a steady fall that the visitor sits inside while reading a contact form, and at the
 * warp's intensity the starfield turns into a tunnel of lines nobody can read over.
 */
const CONTACT_FALL_STREAK_SCALE = 0.42;
/**
 * When the star fades back into the space, across the return.
 *
 * Early, and well ahead of the fall above. The finale's premise is that you WATCH the star die, and that
 * only lands if you have seen it alive first — so it arrives while the camera is still swinging off the
 * room, and is simply already there when the frame comes round onto it.
 *
 * These are the numbers `RETURN_SUN_RESTORE` used to carry in `useHeroAnimation`, where they drove the
 * HERO sun's opacity. They moved here with the star; the two must never both exist.
 */
const CONTACT_STAR_PRESENCE: readonly [number, number] = [0.18, 0.42];

// ── Contact → hero: the dive ──
/**
 * How close the camera gets to the hole, as a fraction of its authored distance.
 *
 * Not zero, and it cannot be: at distance 0 the perspective projection degenerates and `lookAt` has no
 * direction left to resolve from. 0.06 puts the lens inside the disc with the horizon filling the frame,
 * which is as far as anyone needs to see — by then the shadow has taken the screen anyway.
 */
const DIVE_MIN_DISTANCE = 0.06;
/**
 * The starfield's tails at full fall.
 *
 * Past the contact section's own steady `CONTACT_FALL_STREAK_SCALE`, because this is the one moment the
 * warp's full violence is the correct read — you are not drifting toward the hole any more, you are
 * going in.
 */
const DIVE_STREAK_SCALE = 1;
/**
 * How far the camera ROLLS on the way in, in degrees.
 *
 * The single cheapest thing that turns a dolly into a fall. Moving toward a stationary object is
 * geometrically a fall but reads as a zoom, because nothing in the frame tells you the camera has an
 * orientation — rolling it does, and a spiral is what infalling matter actually does. Applied after
 * `lookAt`, which resets the quaternion every frame, so it can never accumulate.
 */
const DIVE_ROLL_DEGREES = 240;
/**
 * Extra field of view at full dive, on top of whatever the key authored.
 *
 * Widening the lens as you accelerate is the warp cue the travel between projects already uses
 * (`FOV_KICK`); this is the same trick held open for the whole fall. It also drags the starfield past
 * the edges faster than the camera is really moving, which is most of the "crossing a galaxy" read.
 */
const DIVE_FOV_PUNCH = 26;

// ── The reveal pan: the camera turns away from the star ──
//
// The star cannot be in the picture at the moment the picture becomes a screen — a full-brightness sun
// pinned mid-frame while the display shrinks reads as a sticker stuck on the room. It used to simply be
// faded out, which worked and was a cheat. This turns the camera away from it instead, which is what a
// remote camera would actually do, and the sun leaves the frame because the sun is now placed against
// the shot rather than against the viewport (`publishSunParallax`). Nothing else has to know.
//
// ⚠ The sign is the whole behaviour. Do not "tidy" it to a positive.
//
// This is the same channel drag-to-look uses, so it inherits that sign convention: dragging UP makes
// `clientY − startY` negative, so a drag up is a NEGATIVE pitch. Negative therefore lifts the camera
// and tilts it back down onto the mark, carrying a distant star UP and out through the top of frame —
// the move you get by dragging the scene upward yourself. Positive is the mirror image: the camera
// drops, looks up, and the star exits the bottom. Both lose the star. Only one is the shot.
//
// The MAGNITUDE is deliberately well past the minimum. Clearing the star's glow takes about 21°, and
// that figure barely moves across viewport heights — a taller frame pushes the top edge further away,
// but also makes the sun's fixed 200px rise a smaller angular offset, and the two nearly cancel:
//   700px tall → 20.0°     1000px → 20.8°     1400px → 21.2°
// At double that the star is long gone before the turn is finished, and the extra travel is not buying
// coverage — it is buying the MOVE. A big deliberate swing off the subject reads as a decision; the
// smallest angle that technically works reads as a flinch.
// Not bound by DRAG_PITCH_CLAMP: that clamps what the visitor may do, and this is the reveal's own.
//
// ⚠ The mark goes with it, and at this angle leaves frame entirely. That is the intent — the reveal's
// subject stops being the mark the moment the camera turns off it.
/**
 * The head of the reveal's span spent LOOKING DOWN, before the room begins at all.
 *
 * The turn away from the star and the pull-back out of the display used to run together, both starting
 * at 0. That reads as one confused motion — the camera tilting while the picture it is tilting inside
 * simultaneously shrinks — and it gave the turn about 0.7s, which is not enough for a deliberate move.
 *
 * Splitting them makes it a sequence: the camera looks down, and THEN the room arrives. Two beats, in
 * the order they would actually happen — an operator turns the lens off the star first, and only then
 * do you get to see where you have been standing.
 *
 * Implemented by remapping the progress the CHAMBER sees (see `roomProgressFrom`), not by delaying
 * anything: through the lead-in the room is handed a flat 0, which is the pose where the display fills
 * the frustum exactly and the canvas is indistinguishable from the live space. So the beat is free —
 * the room is not drawn at all until the camera has finished turning.
 */
const REVEAL_LEADIN_END = 0.18;

const REVEAL_PAN_DEGREES = -42;
// The turn owns the lead-in exactly: it is the beat, and it is finished before the room starts.
//
// ⚠ The window is NOT a free choice. The sun is a DOM billboard BEHIND this canvas, and the room seals
// the canvas opaque over `OPAQUE_WINDOW` — so once the room begins the star cannot be seen at all,
// whatever the camera is doing. Before the lead-in existed this capped the turn at 0.12 of the whole
// span; now the lead-in holds the room off, which is what buys the turn its own time. Keep the two
// equal: a pan running past the lead-in would still be swinging the mark after the pull-back had begun.
const REVEAL_PAN_WINDOW: readonly [number, number] = [0.0, REVEAL_LEADIN_END];

// ── Placing the sun against the shot (see `publishSunParallax`) ──
/** Floor on the projected depth, so a deviation approaching 90° slides off-frame instead of diverging. */
const SUN_PARALLAX_MIN_DEPTH = 0.05;
/** Cap on the published offset, as a multiple of the viewport. Far past off-screen; purely a safety rail. */
const SUN_PARALLAX_MAX_OFFSET_RATIO = 2;

// ── The body's arrival — it flies in from the far dark as the flight completes ──
// The field's meteors stay hidden through most of the flight (only debris + streaking stars show).
// The arrival is driven straight off the handoff progress, so it can never be skipped or desync from
// the scroll. Every meteor travels in from far behind ITS OWN spot over the window below (a long, slow
// approach), and is fully landed by progress 1 — the focused one gaining its fire as it lands. It is
// fully REVERSIBLE: scroll back and the rocks recede to the far dark exactly as the ship flies back
// onto the pad, so the whole handoff cleanly undoes. Perspective grows each rock as it nears (NOT
// scaled up from a speck, so it never reads as spawning). They stay far/small until the ship has
// cleared frame-centre (see EXIT_PROGRESS_* in useServicesDeck), so ship and rocks never clash.
//
// ⚠ That last sentence was ASPIRATIONAL until 2026-08-11. This sat at 0.80 while the ship only began
// its exit whoosh at EXIT_PROGRESS_START = 0.88, so the mark started its approach a third of a second
// BEFORE the craft began to clear and the two shared the frame — the thing the comment promises does
// not happen. It is now pinned to that same 0.88, and HANDOFF_STEP_DURATION went 4 s → 5 s in the same
// change so the approach still has room to read after it (0.12 of a 5 s glide, ~0.6 s).
// ⚠ Keep this and EXIT_PROGRESS_START equal. They are two constants in two scenes describing one
// baton pass, and nothing enforces it.
const METEOR_ARRIVE_PROGRESS_START = 0.88; // handoff progress where the rock begins its approach
const METEOR_ARRIVE_OFFSET = new THREE.Vector3(0, 0.5, -42); // how far behind its spot it starts
const METEOR_APPEAR_FRACTION = 0.12; // gentle fade-up from the far dark as it emerges
const METEOR_VISIBLE_EPSILON = 0.001; // below this the rock is hidden (during the flight)

// ── Shards — irregular ambient debris (NOT projects) ─────────────────────
const SHARD_COUNT       = 260;
const SHARD_COUNT_LOW   = 90;
const SHARD_FIELD       = new THREE.Vector3(13, 6.5, 14); // half-extents the debris fills (z biased back)
const SHARD_Z_CENTER    = -16; // pushed BEHIND the body (which sits at the origin) so debris never occludes it
const SHARD_MIN_SCALE   = 0.05;
const SHARD_MAX_SCALE   = 0.28; // capped so a chunk never reads as a giant boulder
const SHARD_DRIFT_SPEED = 0.012; // rad/s slow yaw drift on the whole debris field
const SHARD_TINT        = SLATE_200; // darker than the body so the mark reads as the subject
// Debris keeps clear of a sphere around every pose the camera can hold, so a chunk never spawns right
// on top of the lens and blows up huge in perspective when you arrive at a stop.
const SHARD_CAMERA_KEEPOUT  = 5;
const SHARD_PLACEMENT_TRIES = 8; // retries to find a spot clear of the keep-out before accepting one
// Silhouette: start from a subdivided icosphere, then carve it with layered directional lobes so
// each rock reads as a lumpy, cratered chunk — big bulges + medium dents + fine chips — rather than
// the faceted ball a low-detail icosahedron gives. flatShading (set on the material) then keeps the
// facets crisp so it stays "rock", not "blob".
const SHARD_GEOMETRY_DETAIL     = 2; // icosphere subdivisions (more facets → the noise reads as surface, not a gem)
const SHARD_GEOMETRY_DETAIL_LOW = 1;
const SHARD_LOBE_LARGE  = { frequency: 2.1, amplitude: 0.36 }; // the big bulges that break the round outline
const SHARD_LOBE_MEDIUM = { frequency: 4.7, amplitude: 0.17 }; // craters / dents
const SHARD_LOBE_FINE   = { frequency: 9.3, amplitude: 0.07 }; // fine surface chipping
const SHARD_MIN_RADIUS  = 0.45; // clamp so a deep crater never punches through / inverts the surface
const SHARD_STRETCH_MIN = 0.68; // per-axis elongation → oblong chunks (never a uniform sphere)
const SHARD_STRETCH_MAX = 1.42;

// ── Starfield ────────────────────────────────────────────────────────────
const STAR_COUNT        = 1400;
const STAR_INNER_RADIUS = 22;
const STAR_OUTER_RADIUS = 70;
const STAR_SIZE         = 0.16;
const STAR_OPACITY      = 0.85;
const STAR_DRIFT        = 0.008;

// ── Lighting ─────────────────────────────────────────────────────────────
const KEY_LIGHT_COLOR      = SLATE_800; // the coldest key on the site, so the stone reads blue-grey,
                                        // not warm — this is what makes the mark's amber geode read
                                        // as heat rather than as paint
const KEY_LIGHT_INTENSITY  = 2.1;
const FILL_LIGHT_COLOR     = SLATE_400;
const FILL_LIGHT_INTENSITY = 0.6;
const AMBIENT_INTENSITY    = 0.18;
const TONE_MAPPING_EXPOSURE = 1.15;

// ── Bloom (only the fire blooms) ─────────────────────────────────────────
// Lowered from 0.9 (and 0.55 on the low tier) because the mark's geode was blooming into a haze that
// ate its own facets. This is the HALO only — every material's `emissiveIntensity` is untouched, so the
// crystal and the open cavities burn exactly as hot as they were authored; there is just less bleed
// around them. Threshold and radius are deliberately left alone: raising the threshold would change
// WHICH surfaces bloom, which is a different edit from how far the glow spreads.
//
// These four were authored against a comparison rig that mirrored this scene exactly. The rig is gone,
// so this is now the only place they exist — and `accretionTransition`'s glow values were all chosen
// against this threshold, so moving it re-grades the mark.
const BLOOM_STRENGTH     = 0.48;
const BLOOM_STRENGTH_LOW = 0.3;
const BLOOM_RADIUS       = 0.55;
const BLOOM_THRESHOLD    = 0.6;
/**
 * MSAA on the SPACE stage, by device tier.
 *
 * Unlike the deck's composer, this one has no SMAA behind it: stage 2's `SMAAPass` is enabled only
 * while the chamber is on screen, so for the whole of works this is the only antialiasing the marks,
 * the debris and the starfield get. That is why even the weakest tier here is not automatically 0 —
 * and why 4 has to be earned rather than assumed.
 *
 * `EffectComposer` clones the target it is handed and `RenderTarget.copy` carries `samples` across, so
 * every sample is paid TWICE. On a 1512×982 panel at ratio 1:
 *
 *     samples 4   11.9 resolved + 47.5 colour + 23.8 depth  =  83 MB  × 2 targets  = 166 MB
 *     samples 2   11.9 resolved + 23.8 colour + 11.9 depth  =  48 MB  × 2 targets  =  95 MB
 *     samples 0   11.9 resolved                             =  12 MB  × 2 targets  =  24 MB
 *
 * The step from 0 to 2 does most of the perceptual work; 2 to 4 refines edges that already have two
 * samples.
 *
 * ⚠ Samples are also per-frame bandwidth, not just memory. An MSAA resolve reads every sample and
 * writes one, and integrated graphics have 30–50 GB/s of TOTAL bandwidth
 * (`docs/lag-and-freeze-diagnosis.md` §1).
 *
 * ── ⚠ THIS IS A FLOOR. 4× IS NOT ON IT, AND THAT IS THE POINT ────────────────────────────────────
 * `deviceTier` is a classification from `navigator` hints — a guess, taken before anything has been
 * measured. An earlier cut of this had `high: 4` here, which meant a machine that *looked* strong
 * allocated ~166 MB of multisampled targets and then, when the probe found it slow, paid for that
 * guess by dropping its RESOLUTION to compensate. That is the trade backwards: it sacrifices the
 * thing that softens the entire frame to protect the thing that only touches silhouettes.
 *
 * It is also the exact mistake `adaptivePixelRatio`'s own header records having been rewritten to
 * stop making — *"the claw-back only happens after the composers have already been reallocated at the
 * larger size, on precisely the machine that could not afford it"*. So the tier sets the floor, and
 * 4 is EARNED from a real measurement — see `earnedMsaaSamples` in the warm-up.
 */
/**
 * ── ⚠ ALL ZERO SINCE 2026-08-06, AND THIS OVERRIDES A RULE IN CLAUDE.md ──────────────────────────
 *
 * That rule read: *"works · space can never be 0 above `potato` — stage 2's SMAA is gated to the
 * chamber, so this is the only AA the marks, debris and starfield get."* It was true and it has been
 * traded away deliberately, to buy a 15 % resolution increase (`MAX_COMPOSITE_UPSCALE`, 2.5 → 2.17).
 *
 * The same file states the priority that decides it: *"RESOLUTION IS THE PRIORITY; SAMPLES ARE THE
 * LEFTOVER... Nothing may trade resolution away to keep samples."* Spending samples to BUY resolution
 * is that rule read forwards. Resolution softens every pixel in the frame — type, textures, every
 * edge; MSAA only touches geometric silhouettes, and a 15 % finer pixel shrinks the stair-stepping it
 * was hiding anyway.
 *
 * On the machine this was measured against (dpr 2.5, tier `mid`, 1536×704) it returns 52 MB of
 * multisample buffers at the old ratio, 22 MB at the new one, plus ~26 MB per frame of resolve
 * bandwidth on a GPU with 30–50 GB/s of total budget.
 *
 * ⚠ What this costs, plainly: through the works BROWSING span the marks, debris and starfield now
 * have no geometric antialiasing at all. The chamber still has its `SMAAPass`. If the marks' silhouettes
 * read as harsh, the honest fix is to un-gate `smaaPass` for the browsing span too (~12 MB of lookup
 * textures, no per-sample bandwidth) rather than to put these samples back.
 *
 * 4× is still reachable and is still EARNED, not granted — see `raiseMsaaIfEarned`, which the burn-in
 * now calls during the loader. A machine with measured surplus gets it before the first visible frame.
 */
const BLOOM_MSAA_SAMPLES_BY_TIER: Record<DeviceTier, number> = {
  potato: 0,
  low: 0,
  mid: 0,
  high: 0,
};

/** What a machine that has demonstrated the headroom gets instead. */
const BLOOM_MSAA_SAMPLES_EARNED = 4;

/**
 * ── When 4× is switched on: SUSTAINED 50 fps AT FULL RESOLUTION, and never before ────────────────
 *
 * `hasEarnedExtraQuality()` is the gate — see its definition in `adaptivePixelRatio`. It requires the
 * site to have actually held 50 fps at its own ceiling for four seconds, on the real page.
 *
 * ⚠ This replaced two attempts to buy MSAA with the probe, and both failed the same way: they spent
 * headroom the resolution had already taken. The first compared against the raw affordable ratio,
 * which `reportProbedFrameCost` lands on the instant it is computed. The second compared against
 * `affordable ÷ ceiling` — which looked like leftover but was exactly what the memory cap was
 * withholding, so a 4K laptop was granted 4×, hit 20 fps and gave its resolution back to pay for it.
 *
 * The probe measures one pipeline on a quiet stage and its spread on one machine was ninefold. It is
 * fit to set a CAP. It is not fit to authorise spending.
 */
/**
 * A hard ceiling on what the space composer's two buffers may cost, in bytes.
 *
 * ⚠ SPARE CAPACITY ALONE IS NOT ENOUGH, and the reason is subtle enough that it shipped broken. On a
 * dpr-2.5 laptop the probe measured `affordable 3.87`, the pixel ratio was capped at 2.0 by
 * `MAX_PIXEL_RATIO`, and `3.87 ÷ 2.0 = 1.94` looked like healthy leftover — so 4× MSAA was granted.
 * But that cap is a MEMORY cap. The "spare" was exactly the amount it was withholding, and spending it
 * on samples handed back what the cap had just protected:
 *
 *     at ratio 2.0, 5.26 Mpx      resolved 42 MB + MSAA colour 168 MB + MSAA depth 84 MB
 *                                 = 294 MB, doubled by the composer's clone   = 588 MB
 *                                 …for ONE composer, before the screen stage or the deck.
 *
 * The laptop went to 20 fps and the controller spent the next several seconds walking the resolution
 * back down — the exact "allocate first, claw back after" failure this whole system exists to avoid,
 * reached by a different road.
 *
 * A ratio cannot express this, because the same ratio costs wildly different amounts on different
 * panels. Bytes can. 256 MB is roughly what the space stage costs at ratio 1.5 with 4× samples on a
 * 1512×982 panel — comfortable on a discrete GPU, and the point past which an integrated one starts
 * evicting.
 */
const SPACE_COMPOSER_MEMORY_BUDGET_BYTES = 256 * 1024 * 1024;

/** Bytes for both of a composer's ping-pong buffers at a given size and sample count. */
function estimateComposerBytes(
  widthPixels: number,
  heightPixels: number,
  samples: number,
): number {
  const HALF_FLOAT_RGBA_BYTES = 8;
  const DEPTH_BYTES = 4;
  const COMPOSER_BUFFERS = 2; // EffectComposer clones the target it is handed.
  const pixels = widthPixels * heightPixels;
  const resolved = pixels * HALF_FLOAT_RGBA_BYTES;
  const multisampled = samples > 0 ? pixels * (HALF_FLOAT_RGBA_BYTES + DEPTH_BYTES) * samples : 0;
  return (resolved + multisampled) * COMPOSER_BUFFERS;
}

const MAX_FRAME_SECONDS = 0.05; // clamp dt so a tab-restore doesn't fling the animation

/** Labels each run of the effect in the development trace. See `effectRun` in the hook. */
let effectRunCounter = 0;

export interface FieldStatus {
  isLoading: boolean;
  /** 0–100 while the textures stream in, 100 when the field is built. */
  percent: number;
}

interface FieldOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** The focused project — read live from the render loop / handlers via a ref. */
  activeIndex: number;
  /**
   * The resolved projects, marks and all.
   *
   * ⚠ READ ONCE, AT SETUP, and deliberately not in the effect's dependencies. It decides the camera
   * path's shape and cuts one body per entry, so reacting to it would mean tearing down and
   * rebuilding the whole scene. It cannot change within a session in any case: it is resolved on the
   * server and arrives as a prop, so the array the effect reads at mount is the array for the life
   * of the page.
   */
  projects: WorksProject[];
  onStatus: (status: FieldStatus) => void;
}

/**
 * The one body: the mark, grown out of stone.
 *
 * The strategy owns its own meshes, materials and geometry — everything under `strategy.object`. This
 * rig owns only where that object sits and how it is faded in, which is the same division the meteor
 * had between its `group` and its mesh.
 *
 * `materials` is collected once at build for the arrival fade. Safe to cache because the strategy only
 * reallocates its layers inside `applyTuning`, and the section never calls it — the tuning is handed
 * over whole at `create` and never moves. If that ever changes, this cache goes stale silently.
 */
interface MarkRig {
  group: THREE.Group;
  basePosition: THREE.Vector3;
  strategy: MarkTransitionStrategy;
  materials: THREE.MeshStandardMaterial[];
}

// The live uniforms the render loop drives on the streak layer as the camera warps.
interface StreakUniforms {
  uStreakDir:    { value: THREE.Vector3 }; // world-space camera travel direction
  uStreakLength: { value: number };        // view-space tail length (0 at rest → STREAK_MAX_LENGTH at peak)
  uOpacity:      { value: number };        // streak layer fade (0 at rest → STREAK_MAX_OPACITY)
}

interface StarSystem {
  group: THREE.Group;
  streakUniforms: StreakUniforms;
  dispose: () => void;
}

// Stretch a star's tail vertex along the camera's travel direction, in VIEW space so the group's
// slow drift rotation never skews the streak. At rest uStreakLength is 0, so the tail sits on the
// head and the line is invisible — the dots carry the resting look; the streaks only appear mid-warp.
const STAR_STREAK_VERTEX = /* glsl */ `
  uniform vec3  uStreakDir;
  uniform float uStreakLength;
  attribute float aTail;      // 0 = head (at the star), 1 = tail (pushed back along travel)
  varying float vTail;

  void main() {
    vTail = aTail;
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    // Travel direction rotated into view space; the tail trails opposite to it.
    vec3 travelView = normalize((viewMatrix * vec4(uStreakDir, 0.0)).xyz);
    viewPosition.xyz -= travelView * aTail * uStreakLength;
    gl_Position = projectionMatrix * viewPosition;
  }
`;
const STAR_STREAK_FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform float uOpacity;
  varying float vTail;
  void main() {
    // Bright at the head, fading down the tail — a comet-streak rather than a solid bar.
    gl_FragColor = vec4(vec3(1.0), uOpacity * (1.0 - vTail));
  }
`;

// A spherical shell of stars wrapping the field: faint additive dots at rest, plus a streak layer
// (built from the same star positions) that elongates them into light-lines while the camera warps.
function createStarSystem(): StarSystem {
  const positions = new Float32Array(STAR_COUNT * 3);
  for (let starIndex = 0; starIndex < STAR_COUNT; starIndex += 1) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = STAR_INNER_RADIUS + Math.random() * (STAR_OUTER_RADIUS - STAR_INNER_RADIUS);
    positions[starIndex * 3]     = radius * Math.sin(phi) * Math.cos(theta);
    positions[starIndex * 3 + 1] = radius * Math.cos(phi);
    positions[starIndex * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }

  // Resting dots.
  const dotGeometry = new THREE.BufferGeometry();
  dotGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const dotMaterial = new THREE.PointsMaterial({
    color: 0xffffff,
    size: STAR_SIZE,
    sizeAttenuation: true,
    transparent: true,
    opacity: STAR_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const dots = new THREE.Points(dotGeometry, dotMaterial);

  // Streak layer — two vertices per star (head + tail), both at the star position; the tail is
  // pushed back in the shader by uStreakLength. Drawn as line segments (pairs 0-1, 2-3, …).
  const streakPositions = new Float32Array(STAR_COUNT * 2 * 3);
  const streakTail = new Float32Array(STAR_COUNT * 2);
  for (let starIndex = 0; starIndex < STAR_COUNT; starIndex += 1) {
    const headOffset = starIndex * 6;
    const starOffset = starIndex * 3;
    for (let vertex = 0; vertex < 2; vertex += 1) {
      streakPositions[headOffset + vertex * 3]     = positions[starOffset];
      streakPositions[headOffset + vertex * 3 + 1] = positions[starOffset + 1];
      streakPositions[headOffset + vertex * 3 + 2] = positions[starOffset + 2];
    }
    streakTail[starIndex * 2]     = 0; // head
    streakTail[starIndex * 2 + 1] = 1; // tail
  }
  const streakGeometry = new THREE.BufferGeometry();
  streakGeometry.setAttribute('position', new THREE.BufferAttribute(streakPositions, 3));
  streakGeometry.setAttribute('aTail', new THREE.BufferAttribute(streakTail, 1));

  const streakUniforms: StreakUniforms = {
    uStreakDir:    { value: new THREE.Vector3(0, 0, 1) },
    uStreakLength: { value: 0 },
    uOpacity:      { value: 0 },
  };
  const streakMaterial = new THREE.ShaderMaterial({
    vertexShader:   STAR_STREAK_VERTEX,
    fragmentShader: STAR_STREAK_FRAGMENT,
    uniforms:       streakUniforms as unknown as { [uniform: string]: THREE.IUniform },
    transparent:    true,
    depthWrite:     false,
    blending:       THREE.AdditiveBlending,
  });
  const streaks = new THREE.LineSegments(streakGeometry, streakMaterial);
  // The tail can reach beyond the star shell; keep it drawing even when its bounds leave the frustum.
  streaks.frustumCulled = false;

  const group = new THREE.Group();
  group.add(dots, streaks);

  return {
    group,
    streakUniforms,
    dispose: () => {
      dotGeometry.dispose();
      dotMaterial.dispose();
      streakGeometry.dispose();
      streakMaterial.dispose();
    },
  };
}

// An irregular asteroid chunk: a subdivided icosphere carved by layered directional lobes (big
// bulges + craters + fine chips) and then squashed on each axis, so it reads as real space rock —
// lumpy and oblong — not the "perfect" gem shape the meteors are. Built once per seed, then
// instanced with random pose/scale. `detail` trades facet density for cost (lower on weak devices).
function createShardGeometry(seed: number, detail: number): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  const vertex = new THREE.Vector3();
  const direction = new THREE.Vector3();

  // A stable 0..1 value from the seed (+ salt) — gives each base shard its own elongation so the
  // two families don't share a silhouette.
  const seededUnit = (salt: number) => {
    const raw = Math.sin(seed * salt) * 43758.5453;
    return raw - Math.floor(raw);
  };
  const stretch = new THREE.Vector3(
    THREE.MathUtils.lerp(SHARD_STRETCH_MIN, SHARD_STRETCH_MAX, seededUnit(12.9898)),
    THREE.MathUtils.lerp(SHARD_STRETCH_MIN, SHARD_STRETCH_MAX, seededUnit(78.233)),
    THREE.MathUtils.lerp(SHARD_STRETCH_MIN, SHARD_STRETCH_MAX, seededUnit(37.719)),
  );

  // One directional lobe: a product of sines over the vertex direction, so the displacement swells
  // and dips around the surface instead of applying a uniform per-vertex jitter (which just stays
  // spherical). Different frequencies/phases stack into an organic, cratered profile.
  const lobe = (unitDirection: THREE.Vector3, frequency: number, phase: number) =>
    Math.sin(unitDirection.x * frequency + phase) *
    Math.sin(unitDirection.y * frequency * 1.3 - phase * 1.7) *
    Math.sin(unitDirection.z * frequency * 0.9 + phase * 0.5);

  for (let vertexIndex = 0; vertexIndex < position.count; vertexIndex += 1) {
    vertex.fromBufferAttribute(position, vertexIndex);
    direction.copy(vertex).normalize();
    const displacedRadius =
      1 +
      SHARD_LOBE_LARGE.amplitude  * lobe(direction, SHARD_LOBE_LARGE.frequency,  seed) +
      SHARD_LOBE_MEDIUM.amplitude * lobe(direction, SHARD_LOBE_MEDIUM.frequency, seed * 2.1) +
      SHARD_LOBE_FINE.amplitude   * lobe(direction, SHARD_LOBE_FINE.frequency,   seed * 3.7);
    vertex
      .copy(direction)
      .multiplyScalar(Math.max(displacedRadius, SHARD_MIN_RADIUS))
      .multiply(stretch);
    position.setXYZ(vertexIndex, vertex.x, vertex.y, vertex.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function useWorksField({ canvasRef, activeIndex, projects, onStatus }: FieldOptions) {
  // The render loop + handlers read the freshest focus through a ref, so the persistent setup
  // effect never re-runs when the active project changes.
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  // Same trick, different reason: the projects cannot change within a session, but reading them
  // through a ref keeps them out of the effect's closure-freshness question entirely and documents
  // that the setup below takes a snapshot rather than subscribing.
  const projectsRef = useRef(projects);
  projectsRef.current = projects;

  // Set up inside the persistent effect; called from the selection effect below so a focus change
  // re-stages the existing scene instead of rebuilding it.
  const setFocusRef = useRef<(index: number) => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduceMotion = prefersReducedMotion();
    // One authority for both, decided once — see lib/deviceTier.ts for why this stopped being an
    // inline viewport test copied into two scene hooks.
    const deviceTier = getDeviceTier();
    const lowPower = isLowPowerDevice();

    // ── Renderer ──
    // ⚠ `antialias: false` is deliberate and is NOT a quality cut — see the same note on the fleet's
    // renderer. Every pixel here reaches the canvas through `screenComposer`, whose last pass is a
    // fullscreen quad, so a multisampled default framebuffer would be resolving a rectangle. The AA
    // that matters is `samples` on the two composer targets and the SMAAPass below.
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    // Which compressed texture formats this GPU accepts. Must happen before any KTX2 model loads, and
    // it covers the two scenes hosted in this renderer as well as this one: `chamberScene` and
    // `singularityScene` load models but are never handed a renderer, deliberately — see
    // lib/modelLoading.ts. They are constructed further down this same effect, so by the time either
    // can ask for the transcoder this has already run.
    detectKtx2Support(renderer);
    // Shared adaptive resolution (drops under load, climbs back when smooth) — see applyRendererSize.
    renderer.setPixelRatio(getPixelRatio());
    // Manual, so the per-frame gauge can total every pass instead of only the last one.
    if (telemetryEnabled) renderer.info.autoReset = false;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 200);

    // Cool image-based lighting so the crystal meteors catch real reflections without an HDR.
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();
    scene.environment = pmremGenerator.fromScene(roomEnvironment, 0.04).texture;

    const keyLight = new THREE.DirectionalLight(KEY_LIGHT_COLOR, KEY_LIGHT_INTENSITY);
    keyLight.position.set(5, 8, 6);
    const fillLight = new THREE.DirectionalLight(FILL_LIGHT_COLOR, FILL_LIGHT_INTENSITY);
    fillLight.position.set(-6, -2, 3);
    scene.add(keyLight, fillLight, new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY));

    // ── Two-stage pipeline: the space renders into a TEXTURE, then that texture is presented ──
    //
    // The works→chamber reveal needs the space scene as something it can paint onto a screen inside a
    // room (see docs/works-to-chamber-reveal.md), so the space no longer draws straight to the canvas.
    // It renders into a texture; a second, screen-facing pipeline then draws that texture back out
    // — full-bleed while you browse projects, and onto the chamber's screen once the camera pulls back.
    // Same texture, same material, both times. That's what makes the reveal seamless: the image never
    // changes, only the geometry it's painted on.
    //
    // WHERE the split goes is the load-bearing decision. It is placed BEFORE tone mapping: everything
    // up to that texture stays linear HDR, and there is exactly ONE OutputPass, at the very end of the
    // screen pipeline. Tone-map the space on the way into the texture and the screen pipeline would
    // tone-map it again on the way out — double-applying the curve and visibly shifting the whole image
    // the moment the reveal engaged. Split before it, and the pixels that reach the canvas are the same
    // pixels as before the split existed.

    // Stage 1 — the space, in linear HDR. Bloom belongs here (it must bleed on the HDR values, before
    // the tone curve compresses them), and nothing else does.
    //
    // CAREFUL — the composer's buffer roles are the opposite of what they look like. EffectComposer
    // takes the target you hand it as its WRITE buffer and CLONES a second one to be its READ buffer.
    // RenderPass and UnrealBloomPass both draw into the READ buffer, and neither of them swaps. So the
    // finished space image ends up in the clone — `spaceComposer.readBuffer` — and NOT in the target
    // constructed here. Sampling this target instead gives you a texture nothing ever wrote to: fully
    // transparent, so the field renders as an empty void. Always read the output back off the composer.
    const spaceBuffer = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: BLOOM_MSAA_SAMPLES_BY_TIER[deviceTier],
    });
    const spaceComposer = new EffectComposer(renderer, spaceBuffer);
    spaceComposer.renderToScreen = false;
    spaceComposer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      lowPower ? BLOOM_STRENGTH_LOW : BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    );
    spaceComposer.addPass(bloomPass);
    // ── Gravitational lensing, for the contact finale ──
    // Here rather than in the star's own scene because it is a SCREEN-SPACE pass: it bends whatever is
    // already in the framebuffer, and what makes the effect worth having is that the starfield and the
    // debris are in this one. It was the whole reason the star moved into this renderer.
    //
    // After the bloom (a bend belongs on the graded HDR image) but BEFORE the HUD, which composites last
    // precisely so its hairlines and type are the colours it authored rather than smeared by a pass.
    //
    // Disabled by default and for almost the whole session: a pass-through ShaderPass still costs a
    // full-screen blit, and this one is wanted for about a second at the very bottom of the page.
    const lensingPass = new ShaderPass(LENSING_SHADER);
    lensingPass.enabled = false;
    spaceComposer.addPass(lensingPass);
    // The camera feed's instrument frame, composited AFTER the bloom so its hairlines and type are
    // exactly the colours authored rather than smeared by a pass they'd all be over the threshold of.
    // In the SPACE stage, not the screen one, because it has to ride onto the chamber's display with
    // the picture it belongs to. See worksHud.ts.
    const hud = createWorksHud();
    spaceComposer.addPass(hud.pass);
    /** Whatever the space pipeline last produced. Re-read every frame rather than cached, so no
     *  assumption about which of the composer's two buffers it landed in can rot. */
    const spaceTexture = () => spaceComposer.readBuffer.texture;

    // The surface the space gets painted onto. At rest it's a full-bleed, pixel-aligned quad, so the
    // canvas shows exactly what stage 1 produced; during the reveal this same material is moved onto
    // the chamber's screen. See spacePresentMaterial.ts for why it's a raw shader and not a
    // MeshBasicMaterial (short version: MeshBasicMaterial forces alpha to 1 and would paint the pinned
    // sun out of the site).
    const presentScene = new THREE.Scene();
    const presentCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const { material: presentMaterial, uniforms: presentUniforms } =
      createSpacePresentMaterial(spaceTexture());
    const presentGeometry = new THREE.PlaneGeometry(2, 2);
    presentScene.add(new THREE.Mesh(presentGeometry, presentMaterial));

    // Stage 2 — the screen. Tone mapping happens here, once, on whatever is being shown.
    //
    // ⚠ NO MSAA, and that is not a quality cut — it is the removal of one. For the whole works section
    // this stage draws exactly ONE pixel-aligned fullscreen quad carrying the space texture, which
    // stage 1 has already resolved. There is not a single interior edge in it for multisampling to
    // find, so `samples: 4` here was allocating two more full-resolution multisampled HalfFloat
    // buffers (EffectComposer CLONES the target it is handed, and `RenderTarget.copy` carries `samples`
    // across — so every composer pays for its samples twice) and resolving them every frame to
    // antialias a rectangle. On a 1512×982 panel at ratio 1 that is ~166 MB of render target and
    // ~95 MB/frame of resolve traffic, for nothing. Stage 1 keeps its MSAA, where the geometry is.
    const screenTarget = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    const screenComposer = new EffectComposer(renderer, screenTarget);
    // The scene this draws is swapped for the chamber once the reveal engages; until then it is the
    // full-bleed quad.
    const screenRenderPass = new RenderPass(presentScene, presentCamera);
    screenComposer.addPass(screenRenderPass);
    screenComposer.addPass(new OutputPass());
    // Geometry AA for the ROOM, and only for the room — see `smaaPass.enabled` in the render loop.
    // The chamber is the one thing this stage ever draws that has edges of its own (the display's
    // rectangle, seen at an angle, is the shot the whole reveal is built on). Over the works quad the
    // same pass was re-detecting edges in an already-resolved 1:1 copy and softening them again, which
    // is three fullscreen passes spent making the picture very slightly worse.
    const smaaPass = new SMAAPass();
    smaaPass.enabled = false;
    screenComposer.addPass(smaaPass);

    // ── Starfield (dots + warp streaks) ──
    const starSystem = createStarSystem();
    scene.add(starSystem.group);

    // ── The camera path ──
    // A project is a POSE now, not a place. Every entry in PROJECT_VIEW_KEYS is a camera pose; the ones
    // tagged with a `stop` are where a project parks, and the untagged ones are pass-through bends the
    // camera splines on its way. One Catmull-Rom over the whole list, parameterised by `pathU` in
    // [0, keys.length - 1], means a journey and its arrival are the same curve — so the camera never
    // brakes to a halt at an intermediate key the way a chain of per-leg tweens would.
    // ⚠ Snapshotted here, at setup, and used for the rest of this effect. The camera path's shape,
    // the number of bodies cut and the HUD's total all come from this one array, so they cannot
    // disagree about how many projects there are.
    const fieldProjects = projectsRef.current;
    // The path is built for however many projects the panel published — see `buildProjectViewKeys`.
    const tuning = getWorksTuning(fieldProjects.length);
    const viewKeys = tuning.keys;
    // Where each project's stop sits in the key list, by project index. Rebuilt with the path.
    let stopKeyIndex: number[] = [];

    let viewYaw = 0, viewPitch = 0, viewYawTarget = 0, viewPitchTarget = 0;
    // On portrait/narrow aspect the camera pulls back so the rock stays framed instead of clipping.
    let distanceScale = 1;

    // Standard Catmull-Rom (tension 0.5), clamped at the ends so the curve can't fly off past the
    // first and last keys.
    const splineAt = (values: number[], u: number) => {
      const lastIndex = values.length - 1;
      if (lastIndex <= 0) return values[0] ?? 0;
      const clamped = THREE.MathUtils.clamp(u, 0, lastIndex);
      const segment = Math.min(Math.floor(clamped), lastIndex - 1);
      const t = clamped - segment;
      const at = (index: number) => values[THREE.MathUtils.clamp(index, 0, lastIndex)];
      const p0 = at(segment - 1), p1 = at(segment), p2 = at(segment + 1), p3 = at(segment + 2);
      const m1 = 0.5 * (p2 - p0);
      const m2 = 0.5 * (p3 - p1);
      const t2 = t * t;
      const t3 = t2 * t;
      return (2 * p1 - 2 * p2 + m1 + m2) * t3 + (-3 * p1 + 3 * p2 - 2 * m1 - m2) * t2 + m1 * t + p1;
    };
    // Split into per-channel arrays, so the spline isn't re-reading objects every frame. Rebuilt only
    // when the keys actually change, which is once, at setup.
    const channelOf = (pick: (key: (typeof viewKeys)[number]) => number) => viewKeys.map(pick);
    let keyX: number[] = [];
    let keyY: number[] = [];
    let keyZ: number[] = [];
    let keyTx: number[] = [];
    let keyTy: number[] = [];
    let keyTz: number[] = [];
    let keyFov: number[] = [];

    const pathPosition = new THREE.Vector3();
    const pathTarget = new THREE.Vector3();
    const pathOffset = new THREE.Vector3();
    const ORBIT_UP = new THREE.Vector3(0, 1, 0);
    const ORBIT_RIGHT = new THREE.Vector3(1, 0, 0);
    // ── Where the camera would be looking if the visitor weren't dragging ──
    // Captured by `updateCamera` before it applies the drag orbit, and used to place the sun (see
    // `publishSunParallax`). `restPoseValid` is false whenever something OTHER than the authored path
    // owns the camera — the handoff flight — because then there is no "rest" to deviate from and the
    // sun must simply stay where the pin put it.
    const restForward = new THREE.Vector3();
    let restPoseValid = false;

    // ── How far into the works→chamber reveal we are ──
    // The pin scrubs the raw target and the loop eases toward it, exactly as the handoff does. The room
    // is only DRAWN once it has both models — until then the screen pipeline keeps painting the
    // full-bleed quad, which is what it would be showing at progress 0 anyway.
    //
    // Declared up HERE, far above the chamber it belongs to, because `updateCamera` reads it for the
    // reveal pan and is itself called during setup — with this next to `ensureChamber` that call landed
    // in the temporal dead zone.
    // `reveal` and `contact` are the two crossings' RAW scrubbed values; `target` is what the room
    // actually chases, combined from both (see combineChamberTarget). Kept apart rather than collapsed
    // on arrival because the things that must NOT unwind — the camera's turn, the sun's fade — read the
    // reveal's own value, and folding them together would lose it.
    const chamberState = {
      /** The reveal crossing's raw scrubbed value. */
      reveal: 0,
      /** The return crossing's raw scrubbed value. */
      contact: 0,
      /**
       * The reveal, eased on its own.
       *
       * Everything that must NOT unwind on the way back out reads this: the camera's turn away from the
       * star, and the instrument frame. Eased rather than taken raw because they are camera-rate
       * visuals — driving them from the scrubbed value directly makes them track the scrollbar while
       * the room they belong to eases, which is precisely the desync this codebase keeps re-learning.
       */
      revealEased: 0,
      /** The two combined — what the ROOM chases. See combineChamberTarget. */
      target: 0,
      current: 0,
      engaged: false,
    };

    /**
     * The room's target: the reveal's progress, undone by the return's.
     *
     *     effectiveChamber = reveal × (1 − contact)
     *
     * At the end of the reveal this is 1 (standing at the podium). As the return scrubs 0→1 it walks
     * back down to 0, which is the pose where the display fills the frustum exactly — so diving back
     * into the screen is the pull-back run backwards, with no second camera path to author.
     *
     * ⚠ `chamberState.reveal` is kept as its own field beside this because the two say different things,
     * and one consumer needs each. The ROOM reads the combined value, so the pull-back unwinds. The HERO
     * sun's fade reads the raw one, which stays pinned at 1 for the whole return — so that star, once
     * retired into the room, never comes back.
     *
     * (An earlier revision of this comment also claimed `revealPanRadians` keys off the raw value and
     * that "the star stays dead". Both are wrong now: the pan reads the combined value and unwinds, and
     * a star does come back — a different one, in this scene. See CONTACT_STAR_PRESENCE.)
     */
    const combineChamberTarget = () => {
      chamberState.target = chamberState.reveal * (1 - chamberState.contact);
    };

    // ── The mark belongs to works, and to nothing else ──
    //
    // Contact lands you back in the same space, and the whole point of that ending is what is MISSING
    // from it. So the mark does not get hidden here, it gets taken out: `scene.remove` on the group, so
    // it is not in the graph at all, plus the per-frame work below is skipped.
    //
    // ⚠ Removing it from the scene is the smaller half of this, and on its own it would not have done
    // the job. What the mark actually costs every frame is `strategy.setTransition` + `strategy.update`
    // — the geode morph's shader driver — and that is called from a list, not from the scene graph, so
    // it keeps running on an object nobody can see. `markPresent` gates both.
    //
    // NOT disposed, deliberately. The build is asynchronous (outlines, a typeface, two surfaces) and is
    // the section's one real build cost, so tearing it down would mean rebuilding it — and scrolling
    // back from contact to works would arrive at an empty space and pop the mark in whenever it
    // finished. Removed is free to undo; disposed is not.
    let markPresent = true;
    const setMarkPresent = (present: boolean) => {
      if (present === markPresent) return;
      markPresent = present;
      markRigs.forEach((rig) => {
        if (present) scene.add(rig.group);
        else scene.remove(rig.group);
      });
    };

    /**
     * How far into the return the mark is taken away.
     *
     * Early, and the reason is that its disappearance should never be WATCHED. At this point the
     * display is still a small rectangle across the room and the camera is walking back from the
     * podium, so a mark leaving it is barely perceptible — and by the time the display has grown back
     * to fill the frame, it has been gone for a while. The ending is an absence you discover, not a
     * vanishing you see happen.
     */
    const CONTACT_MARK_REMOVED_AT = 0.05;

    // ── The finale IS here, and this is the reasoning that put it here ──
    //
    // This comment used to say the opposite: that the star and its black hole belonged to
    // `SunModelCanvas`, because a sun in one WebGL context becoming a hole in another is a
    // cross-context cross-fade — the exact thing that failed once already (`sunBackdrop.ts`, deleted).
    //
    // That objection was answered rather than ignored, and the answer is worth keeping. The finale needs
    // LENSING, which bends whatever is already in the framebuffer; the starfield and debris are in THIS
    // renderer, so a lensing pass over on the sun's own transparent canvas would have nothing behind it
    // to bend. And the two stars are mutually exclusive BY CONSTRUCTION — the hero sun's opacity is a
    // function of REVEAL progress and is 0 past 0.18, while this one's presence is a function of RETURN
    // progress, which cannot leave 0 until reveal is pinned at 1. No timing arbitrates between them.
    // That is precisely what the reverted attempt got wrong: it used a threshold on eased progress, and
    // both suns ended up on screen at once.
    //
    // See `components/sections/Contact/singularityScene.ts` and docs/contact-singularity-plan.md §2.

    /**
     * The ROOM's own 0..1, with the look-down lead-in taken off the front.
     *
     * Everything that belongs to the room reads this rather than the raw progress — the pull-back, the
     * tour, the display's seal, the instrument frame. The raw value is only for the things that happen
     * BEFORE the room: the camera's turn away from the star, and the freeze on adaptive resolution that
     * has to cover it.
     *
     * A plain linear remap on purpose. The chamber already eases its own pull-back internally
     * (`easeReveal`), so curving it here as well would compound two eases into a shape neither end
     * authored.
     */
    const roomProgressFrom = (revealProgress: number) =>
      THREE.MathUtils.clamp(
        (revealProgress - REVEAL_LEADIN_END) / (1 - REVEAL_LEADIN_END),
        0,
        1,
      );

    /**
     * How far the reveal has turned the camera off the star, in radians.
     *
     * Signed like the drag channel it rides on: NEGATIVE is the drag-up direction, which lifts the
     * camera and carries the star up out of frame — see REVEAL_PAN_DEGREES. Smoothstepped so the turn
     * eases in and out of its window instead of starting and stopping abruptly against the pull-back.
     */
    /**
     * The FOV the current key authors, widened by the dive.
     *
     * Shared because TWO places set `camera.fov` — here and the warp kick in the render loop — and a
     * dive punch applied in only one of them would be cancelled the moment the other ran.
     */
    const authoredFov = () =>
      splineAt(keyFov, pathU) + DIVE_FOV_PUNCH * diveProgress * diveProgress;

    const revealPanRadians = () => {
      if (!chamberState.engaged) return 0;
      // The COMBINED value, so the turn unwinds on the way back in. That is the finale's opening move:
      // the camera swings back onto the star it looked away from, and finds it still there — which is
      // what makes watching it die land, rather than arriving to a black hole that was always there.
      const panProgress = THREE.MathUtils.smoothstep(
        chamberState.current,
        REVEAL_PAN_WINDOW[0],
        REVEAL_PAN_WINDOW[1],
      );
      return THREE.MathUtils.degToRad(REVEAL_PAN_DEGREES) * panProgress;
    };
    const samplePath = (u: number) => {
      pathPosition.set(splineAt(keyX, u), splineAt(keyY, u), splineAt(keyZ, u));
      pathTarget.set(splineAt(keyTx, u), splineAt(keyTy, u), splineAt(keyTz, u));
    };

    // ── Even pacing ──
    // A uniform walk along the spline spends one flat slice of time per SEGMENT, so a leg carrying two
    // transit keys crawls while a leg carrying none races. Measuring real travelled distance and moving
    // at a constant rate through it is what fixes that.
    const arcDistances: number[] = new Array(PATH_ARC_SAMPLES).fill(0);
    const arcScratch = new THREE.Vector3();
    let lastKeyIndex = Math.max(viewKeys.length - 1, 1);
    const buildArcTable = () => {
      let travelled = 0;
      for (let sample = 0; sample < PATH_ARC_SAMPLES; sample += 1) {
        samplePath((sample / (PATH_ARC_SAMPLES - 1)) * lastKeyIndex);
        if (sample > 0) travelled += pathPosition.distanceTo(arcScratch);
        arcScratch.copy(pathPosition);
        arcDistances[sample] = travelled;
      }
    };
    /**
     * Re-derive everything the path is made of from the key list. Called once at setup, and again by the
     * the section resizes. The key list itself is a constant, so nothing else can change it.
     */
    const rebuildPath = () => {
      stopKeyIndex = [];
      viewKeys.forEach((key, keyIndex) => {
        if (key.stop !== null) stopKeyIndex[key.stop] = keyIndex;
      });
      // Say so loudly if the stops don't form a complete run 0..n−1. A gap fails SILENTLY otherwise —
      // the missing stop resolves to key 0, so that project quietly shows you the first project's shot
      // and nothing looks broken enough to investigate. This is the mistake authoring will actually make.
      const stopCount = viewKeys.filter((key) => key.stop !== null).length;
      for (let stop = 0; stop < stopCount; stop += 1) {
        if (stopKeyIndex[stop] === undefined) {
          console.warn(
            `[works] camera path has ${stopCount} stops but none tagged stop:${stop} — that project will fall back to the first key.`,
          );
        }
      }
      keyX = channelOf((key) => key.x);
      keyY = channelOf((key) => key.y);
      keyZ = channelOf((key) => key.z);
      keyTx = channelOf((key) => key.tx);
      keyTy = channelOf((key) => key.ty);
      keyTz = channelOf((key) => key.tz);
      keyFov = channelOf((key) => key.fov);
      lastKeyIndex = Math.max(viewKeys.length - 1, 1);
      buildArcTable();
    };
    rebuildPath();

    /** Distance travelled along the path by parameter `u`. */
    const arcAt = (u: number) => {
      const position =
        (THREE.MathUtils.clamp(u, 0, lastKeyIndex) / lastKeyIndex) * (PATH_ARC_SAMPLES - 1);
      const low = Math.min(Math.floor(position), PATH_ARC_SAMPLES - 2);
      return THREE.MathUtils.lerp(arcDistances[low], arcDistances[low + 1], position - low);
    };
    /** ...and its inverse, so a constant rate of distance maps back to a parameter. */
    const uAtArc = (distance: number) => {
      const total = arcDistances[PATH_ARC_SAMPLES - 1];
      if (total <= 1e-6) return 0;
      const target = THREE.MathUtils.clamp(distance, 0, total);
      let low = 0;
      let high = PATH_ARC_SAMPLES - 1;
      while (low < high) {
        const mid = (low + high) >> 1;
        if (arcDistances[mid] < target) low = mid + 1;
        else high = mid;
      }
      if (low === 0) return 0;
      const spanStart = arcDistances[low - 1];
      const spanEnd = arcDistances[low];
      const withinSpan = spanEnd > spanStart ? (target - spanStart) / (spanEnd - spanStart) : 0;
      return ((low - 1 + withinSpan) / (PATH_ARC_SAMPLES - 1)) * lastKeyIndex;
    };

    // Where the camera is on the path, and the hop that moves it.
    let pathU = stopKeyIndex[activeIndexRef.current] ?? 0;
    const travel = { value: 1 }; // 1 = arrived / idle
    let travelFromU = pathU;
    let travelToU = pathU;
    let travelActive = false;

    const startTravel = (toU: number) => {
      travelFromU = pathU;
      travelToU = toU;
      travel.value = 0;
      travelActive = true;
      gsap.killTweensOf(travel);
      gsap.to(travel, {
        value: 1,
        duration: tuning.travelSeconds,
        ease: TRAVEL_EASE,
        onComplete: () => { travelActive = false; },
      });
    };

    const updateCamera = (instant: boolean) => {
      if (instant || reduceMotion) {
        pathU = travelToU;
        travelActive = false;
      } else if (travelActive) {
        pathU = tuning.evenPacing
          // Move at an even rate through DISTANCE rather than through parameter, so every leg travels
          // at the same speed regardless of how many keys it happens to contain.
          ? uAtArc(THREE.MathUtils.lerp(arcAt(travelFromU), arcAt(travelToU), travel.value))
          : THREE.MathUtils.lerp(travelFromU, travelToU, travel.value);
      }

      viewYaw   += (viewYawTarget   - viewYaw)   * VIEW_RETURN_EASE;
      viewPitch += (viewPitchTarget - viewPitch) * VIEW_RETURN_EASE;

      samplePath(pathU);
      // Drag-to-look ORBITS the authored pose about whatever it aims at, rather than replacing it — so a
      // peek around the rock always springs back onto the shot the key describes.
      // The dive collapses the camera's distance from its aim point, and the aim point is the origin —
      // which is where the black hole is. So falling in needs no new path: the authored pose simply
      // closes on the thing it was already looking at. Eased on a cubed curve so the last of the fall
      // accelerates, the same gravity read the star's own collapse uses.
      //
      // Floored rather than taken to zero: at distance 0 the projection degenerates and `lookAt` has no
      // direction left to resolve.
      // Squared rather than cubed: the star's own collapse is cubed because it should barely move and
      // then vanish, but a fall the visitor is INSIDE has to be visibly under way early or the first
      // half of the span is dead air. Still accelerating, just legible sooner.
      const dive = diveProgress * diveProgress;
      pathOffset
        .copy(pathPosition)
        .sub(pathTarget)
        .multiplyScalar(distanceScale * THREE.MathUtils.lerp(1, DIVE_MIN_DISTANCE, dive));
      // Read the un-orbited aim BEFORE the drag is applied — this is the shot the key describes, and the
      // sun is composed against it rather than against the viewport (see `publishSunParallax`).
      restForward.copy(pathOffset).negate().normalize();
      restPoseValid = true;
      pathOffset.applyAxisAngle(ORBIT_UP, viewYaw);
      pathOffset.applyAxisAngle(ORBIT_RIGHT, viewPitch);
      // The reveal's own turn away from the star, on top of whatever the visitor is doing. Read
      // straight off the reveal's eased progress rather than tweened, so it is a pure function of the
      // scroll: it can't be outrun, it reverses exactly, and a resize re-derives it.
      pathOffset.applyAxisAngle(ORBIT_RIGHT, revealPanRadians());
      camera.position.copy(pathTarget).add(pathOffset);
      camera.lookAt(pathTarget);
      // The spiral. Rolls about the view axis on the same accelerating curve as the fall, so the frame
      // starts to turn only once you are genuinely going in. Safe to apply unconditionally: `lookAt`
      // above rewrites the quaternion every frame, so this cannot accumulate.
      if (dive > 0) camera.rotateZ(THREE.MathUtils.degToRad(DIVE_ROLL_DEGREES) * dive);

      // FOV is authored per key, so a stop can be a tight portrait or a wide establishing shot. The
      // warp kick in the render loop rides on top of whatever this resolves to.
      const fov = authoredFov();
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    };

    // ── Tell the sun where a distant object would have gone ──
    //
    // The sun is DOM, behind this canvas, and cannot be in this scene (see lib/sunParallaxPose.ts). So
    // rather than move it into the render, the render says where it belongs and the DOM follows.
    //
    // The trick is that the sun is composed against the SHOT, not against the viewport. Its resting
    // place on screen is whatever the hero pin chose, and that stays true at every stop — what this
    // publishes is only the DEVIATION: how far the visitor has dragged the camera away from the pose the
    // key authored. So travelling between projects moves nothing (the camera is on its path, deviation
    // zero) and the composition each stop was framed for is preserved, while a drag pushes the star
    // across the screen exactly as it pushes the starfield.
    //
    // ⚠ Deliberately NOT full world anchoring. The path orbits ±35° at a ~40° lens, so a sun fixed in the
    // world would swing about two screen widths across the four stops and be off-frame at projects 02
    // and 03 — which are compositions that were authored with the star in them.
    //
    // The maths, per frame:
    //   1. `restForward` is where the authored shot aims, in world space.
    //   2. Rotate it into the ACTUAL camera's view space. With no drag the two are the same rotation, so
    //      this returns (0, 0, -1) and every step below yields exactly zero — the identity is exact, not
    //      approximate, which is what guarantees this can never disturb the resting sun.
    //   3. Perspective-divide to NDC through the current lens, then scale to CSS pixels.
    const restForwardView = new THREE.Vector3();
    const inverseCameraRotation = new THREE.Quaternion();
    const publishSunParallax = () => {
      if (!worksShouldRender || !restPoseValid) {
        clearSunParallaxPose();
        return;
      }
      inverseCameraRotation.copy(camera.quaternion).invert();
      restForwardView.copy(restForward).applyQuaternion(inverseCameraRotation);
      // Depth toward the lens is -z. Clamped rather than bailed out on: past ~90° of deviation the
      // projection diverges, and a clamp lets the star keep sliding off-frame instead of snapping back
      // to centre. The drag clamps keep us far from this, but a future wider clamp shouldn't break it.
      const depth = Math.max(-restForwardView.z, SUN_PARALLAX_MIN_DEPTH);
      const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      const ndcX = restForwardView.x / depth / (tanHalfFov * camera.aspect);
      const ndcY = restForwardView.y / depth / tanHalfFov;
      // Bounded so a degenerate projection can never hand the DOM a transform of millions of pixels,
      // which browsers turn into an enormous compositor layer.
      const limitX = viewportWidth * SUN_PARALLAX_MAX_OFFSET_RATIO;
      const limitY = viewportHeight * SUN_PARALLAX_MAX_OFFSET_RATIO;
      publishSunParallaxPose(
        THREE.MathUtils.clamp((ndcX * viewportWidth) / 2, -limitX, limitX),
        THREE.MathUtils.clamp((-ndcY * viewportHeight) / 2, -limitY, limitY),
      );
    };

    // ── Load textures, then build the mark + shards ──
    // Declared up here rather than beside the warm-up that used to own it: the mark's build is
    // asynchronous (outlines, typeface, two surfaces), so it has to be able to check whether the
    // section was torn down while it was awaiting — otherwise a fast unmount leaves an orphaned
    // strategy holding GPU buffers with nothing to dispose it.
    let disposed = false;
    // Which run of this effect we are. StrictMode double-invokes in development, and the two runs are
    // indistinguishable in a log without this — which is exactly the question the trace below has to
    // answer: did the SECOND one ever arm its loader, or is the discarded first one all there was?
    effectRunCounter += 1;
    const effectRun = effectRunCounter;
    const markRigs: MarkRig[] = [];
    let shardMeshes: THREE.InstancedMesh[] = [];
    const shardGeometries: THREE.BufferGeometry[] = [];
    const shardMaterials: THREE.MeshStandardMaterial[] = [];
    const disposableTextures: THREE.Texture[] = [];

    const loadingManager = new THREE.LoadingManager();
    const textureLoader = new THREE.TextureLoader(loadingManager);

    // One surface for everything in the field. It tiles, because the rock is far larger than the image
    // and a single stretched copy would smear across it.
    const surfaceMap = textureLoader.load(TEXTURE_SURFACE);
    surfaceMap.colorSpace = THREE.SRGBColorSpace;
    surfaceMap.wrapS = THREE.RepeatWrapping;
    surfaceMap.wrapT = THREE.RepeatWrapping;
    disposableTextures.push(surfaceMap);

    // ── Which mark each project shows ──
    // ⚠ The identity, and it took a rewrite to be allowed to be. `prepareMarks` used to resolve a
    // shared REGISTRY and drop any mark whose file failed, so a project had to find its own by id —
    // matching by position would have shifted every later project onto its neighbour's logo. A
    // project now carries its own mark and can always produce one (its initial, at worst), so
    // `prepareMarks` returns exactly one entry per project, in order, and there is nothing left to
    // look up. Kept as an array rather than inlined because the transition state indexes MARKS, and
    // conflating the two names is how that stops being true the next time something changes.
    const markIndexOfProject: number[] = fieldProjects.map((_project, index) => index);

    // ── The transition, as ONE piece of state ──
    // `setTransition(from, to, progress)` is a pure function by contract — no timers, no "arrived"
    // flags — so the whole change is these three numbers and a tween that moves the third. That is
    // also why interrupting is free: the old vertex morph needed `settleMorph`/`bakeMorphTarget` to
    // fold an in-flight shape back into the geometry before a new morph could be armed, and a pure
    // function has no such residue to clear.
    // Indices into the PREPARED MARKS, not into the projects — the two only coincide by accident.
    // Seeded at 0 rather than at the active project because `markIndexOfProject` cannot be resolved
    // until the outlines have loaded; `buildMark` sets the real starting mark once it can.
    const markState = { from: 0, to: 0, progress: 0 };
    let markTween: gsap.core.Tween | null = null;
    /**
     * True while `markTween` is running the change BACKWARDS (see `runMarkTo`).
     *
     * `markState` alone cannot tell you this: `from`/`to` keep their meaning in both directions, so a
     * reversing tween looks exactly like a forward one caught at the same progress. Which way it is
     * headed is what decides whether a step onto `to` is a no-op or a second turnaround.
     */
    let markReversing = false;

    // ── What 'works' progress actually covers ──
    // The manager only knows about the debris texture. The MARK then fetches its outlines, a typeface
    // and two more surfaces — including the 3.4 MB geode druse — inside `buildField`, which runs after
    // the manager has already called itself done. Reporting the manager's fraction straight through
    // would race to 99% and then sit there for the whole of the largest download in this source, which
    // is precisely the dishonesty `assetLoadProgress` exists to prevent.
    //
    // So the source's 0..1 is split into stages and the manager owns only the first of them.
    const WORKS_TEXTURE_SHARE = 0.45; // the debris texture, via the manager
    const WORKS_OUTLINES_DONE = 0.55; // + logo outlines and the typeface
    // …and the strategy's own surfaces plus the cut take it the rest of the way to 1.
    loadingManager.onProgress = (_url, loaded, total) => {
      const fraction = loaded / Math.max(total, 1);
      reportAssetProgress('works', fraction * WORKS_TEXTURE_SHARE);
      onStatus({ isLoading: true, percent: Math.round(fraction * 100) });
    };
    // If the texture fails, onLoad never fires, so buildField never runs — don't let that trap the
    // intro's loader gate waiting on a source that will never be ready. Report the field "ready" so the
    // reveal proceeds; the section degrades gracefully (it shows its own empty/loader state).
    loadingManager.onError = (url) => {
      console.error(`Works field asset failed to load: ${url}`);
      reportAssetProgress('works', 1);
      // Arm the warm-up too, or a failed texture would leave this source reporting ready for the
      // download but never warm — and the gate waits on BOTH, so it would sit out its full cap.
      assetsIn = true;
      warmWhenBothReady();
    };

    /**
     * Build the mark — the section's one body.
     *
     * Async, and it is the only asynchronous thing in the build: the outlines are fetched, the
     * typeface is parsed, and the strategy loads its own two surfaces. `buildField` therefore awaits
     * it before reporting the section ready, or the intro's counter would reach 100% while the body
     * was still being cut.
     *
     * The mark's ~60 authored numbers live in `ACCRETION_TUNING` in `accretionTransition.ts`, next to
     * the code that reads them. They used to arrive from a comparison lab through a knob schema; that
     * is gone, so the values are simply constants now and there is nothing to pass.
     */
    const buildMark = async () => {
      traceBuild('prepareMarks: start');
      // No network in here for a panel-published mark: `lib/cms/markSource.ts` dereferenced it on
      // the server, so this is parsing text the page already had. Only the repo's own fallback
      // projects still fetch, and only from our own origin.
      const marks = await prepareMarks(fieldProjects);
      traceBuild(`prepareMarks: done (${marks.length} marks)`);
      if (disposed || marks.length === 0) {
        traceBuild(`buildMark: bailing (disposed=${disposed}, marks=${marks.length})`);
        return;
      }
      reportAssetProgress('works', WORKS_OUTLINES_DONE);

      traceBuild('createAccretionMark: start (loads 2 textures, then cuts every mark)');
      const strategy = await createAccretionMark(marks, {
        targetSize: tuning.markTargetSize,
        depth: tuning.markDepth,
        performanceTier: lowPower ? 'low' : 'high',
      });
      traceBuild('createAccretionMark: done');
      if (disposed) {
        strategy.dispose();
        return;
      }

      // ── What the mark actually cost, in development ──
      // `ACCRETION_TUNING.capEdgeFraction` sits at 0.008 — the floor of the slider it was authored on —
      // with `capSubdivisions: 2`, and each subdivision QUADRUPLES the triangle count. Its own comment
      // says to watch the rig's triangle and build-time readouts before carrying it into the section,
      // and the rig was deleted before anyone did. The strategy has measured itself since the day it was
      // written and nothing has ever read the result.
      //
      // These two numbers answer the only open performance question left on this site: whether cutting
      // four marks at this density is a rounding error or the longest block on the loader. Under ~60 ms
      // total there is nothing here to chase; if it is hundreds, `capSubdivisions: 1` is a 4× cut and
      // may well be invisible.
      if (telemetryEnabled) {
        const { buildMilliseconds, bufferBytes, perMarkBytes } = strategy.metrics;
        console.log(
          `[voidix] mark build: ${buildMilliseconds.toFixed(0)} ms for ${marks.length} marks, ` +
            `${(bufferBytes / 1e6).toFixed(1)} MB of buffers ` +
            `(${(perMarkBytes / 1e6).toFixed(1)} MB each)`,
        );
      }


      // Every material under the strategy, for the arrival fade. `transparent` is set ONCE, here —
      // toggling it per frame invalidates the program and recompiles the shader, which is a stutter at
      // exactly the moment the section is trying to look expensive.
      const materials: THREE.MeshStandardMaterial[] = [];
      strategy.object.traverse((child) => {
        const material = (child as THREE.Mesh).material;
        if (!material) return;
        (Array.isArray(material) ? material : [material]).forEach((entry) => {
          const standard = entry as THREE.MeshStandardMaterial;
          standard.transparent = true;
          standard.opacity = 1;
          materials.push(standard);
        });
      });

      const group = new THREE.Group();
      group.position.set(tuning.markX, tuning.markY, tuning.markZ);
      group.add(strategy.object);
      // Only if the mark is supposed to be here at all. The build is asynchronous, so a visitor who
      // jumps straight to the end of the page can have contact already remove a mark that has not
      // finished building — and this line would then add it to the scene anyway, moments later.
      if (markPresent) scene.add(group);

      markRigs.push({
        group,
        basePosition: group.position.clone(),
        strategy,
        materials,
      });

      // Park on the active project. `from === to` is the strategy's "sit still on this mark".
      const startMark = markIndexOfProject[activeIndexRef.current] ?? 0;
      markState.from = startMark;
      markState.to = startMark;
      markState.progress = 0;
    };

    // Nothing on this site changes the mark's geometry at runtime, so there is no rebuild path here —
    // the mark is cut once, from `ACCRETION_TUNING`, and lives until the section is disposed.

    /**
     * Where the field's build got to — development only.
     *
     * "Charting the field · 100%" is shown by `FieldCanvas` for as long as `status.isLoading` holds,
     * and the percentage comes from the LoadingManager, which only ever tracked the one debris
     * texture. So it reaches 100 the moment that texture lands and then sits there for the whole
     * asynchronous build behind it — the outlines, the typeface, two more surfaces and the cutting of
     * every mark. A build that stops anywhere in there looks exactly like a build that finished.
     * These lines are what tell the two apart.
     */
    const traceBuild = (stage: string) => {
      if (process.env.NODE_ENV !== 'development') return;
      console.log(`%c[works #${effectRun}] ${stage}`, 'color:#8ab4ff;font-weight:600');
    };
    traceBuild('effect: setup');

    const buildField = async () => {
      traceBuild('buildField: start');
      await buildMark();
      if (disposed) {
        // Ordinary under StrictMode's double-mount: this is the discarded first pass, and the second
        // one owns the overlay. Logged because if it ever happens to the SURVIVING mount the section
        // stays behind its loading label forever, and that is otherwise invisible.
        traceBuild('buildField: bailing after buildMark (disposed)');
        return;
      }

      // Ambient shard debris — two irregular base shapes, each instanced across the field.
      const totalShards = lowPower ? SHARD_COUNT_LOW : SHARD_COUNT;
      const shardMatrix = new THREE.Matrix4();
      const shardQuaternion = new THREE.Quaternion();
      const shardEuler = new THREE.Euler();
      const shardScale = new THREE.Vector3();
      const shardPosition = new THREE.Vector3();

      // Every pose the camera ever holds — debris keeps clear of a sphere around each of them, so a
      // chunk never spawns right on the lens and blows up huge as you arrive at a stop.
      const cameraAnchors = viewKeys.map(
        (key) => new THREE.Vector3(key.x, key.y, key.z),
      );
      const isClearOfCameras = (position: THREE.Vector3) =>
        cameraAnchors.every((anchor) => anchor.distanceTo(position) >= SHARD_CAMERA_KEEPOUT);

      for (let baseIndex = 0; baseIndex < 2; baseIndex += 1) {
        const geometry = createShardGeometry(
          baseIndex + 1,
          lowPower ? SHARD_GEOMETRY_DETAIL_LOW : SHARD_GEOMETRY_DETAIL,
        );
        const material = createStoneMaterial(surfaceMap, {
          tint: SHARD_TINT,
          flatShading: true,
        });
        material.transparent = false; // shards never cross-fade, so keep them cheap/opaque
        const countForBase = Math.floor(totalShards / 2);
        const instanced = new THREE.InstancedMesh(geometry, material, countForBase);
        instanced.instanceMatrix.setUsage(THREE.StaticDrawUsage);

        for (let instanceIndex = 0; instanceIndex < countForBase; instanceIndex += 1) {
          // Place it, keeping clear of the camera keep-out spheres — retry a few times, then accept
          // whatever the last try gave (the field is already behind the meteors, so a stray one is fine).
          for (let attempt = 0; attempt < SHARD_PLACEMENT_TRIES; attempt += 1) {
            shardPosition.set(
              (Math.random() * 2 - 1) * SHARD_FIELD.x,
              (Math.random() * 2 - 1) * SHARD_FIELD.y,
              SHARD_Z_CENTER + (Math.random() * 2 - 1) * SHARD_FIELD.z,
            );
            if (isClearOfCameras(shardPosition)) break;
          }
          shardEuler.set(Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2);
          shardQuaternion.setFromEuler(shardEuler);
          shardScale.setScalar(SHARD_MIN_SCALE + Math.random() * (SHARD_MAX_SCALE - SHARD_MIN_SCALE));
          shardMatrix.compose(shardPosition, shardQuaternion, shardScale);
          instanced.setMatrixAt(instanceIndex, shardMatrix);
        }
        instanced.instanceMatrix.needsUpdate = true;
        scene.add(instanced);
        shardMeshes.push(instanced);
        shardGeometries.push(geometry);
        shardMaterials.push(material);
      }

      // Land on the focused project immediately (no transition on first build).
      applyFocus(activeIndexRef.current, true);
      traceBuild('buildField: done — clearing the loading label');
      onStatus({ isLoading: false, percent: 100 });
      // Fully built → mark the field ready for the intro's loader gate…
      reportAssetProgress('works', 1);
      // …and arm the warm-up, which runs once the loader's stage is also quiet. Safe to reach forward
      // to a const declared further down the effect: everything on this path is async, so the effect
      // body has long since finished running.
      assetsIn = true;
      warmWhenBothReady();
    };

    // The debris texture is what the manager is waiting on; the mark then fetches its own outlines,
    // typeface and surfaces inside `buildField`, which is why that is async.
    //
    // The catch is not optional. `onLoad` discards the promise, so without it a failure anywhere in
    // the mark build — an unreachable SVG, a font parse — would be an unhandled rejection AND would
    // leave `reportAssetProgress('works', …)` capped at 0.99 forever, which hangs the intro on a
    // loader that never reaches 100%. Report ready and let the section degrade instead.
    loadingManager.onLoad = () => {
      traceBuild('loadingManager.onLoad — the debris texture is in, starting the build');
      buildField().catch((cause: unknown) => {
        console.error('Works field failed to build:', cause);
        onStatus({ isLoading: false, percent: 100 });
        reportAssetProgress('works', 1);
        assetsIn = true;
        warmWhenBothReady();
      });
    };

    // ── Focus a project ──
    // Nothing ignites and nothing cools any more — there is one rock, and a project is a place to stand
    // and look at it from. So focusing a project is simply travelling to its stop on the path.
    let stagedIndex = activeIndexRef.current;

    // ── The change: one mark grows out of the other ──
    // There is no wind-up and nothing to hide behind any more. The old body spun to 1150 deg/s so a
    // hard cut could happen inside a blur; the accretion strategy makes the change itself the thing
    // you watch, so a blur would only obscure it (see worksTransition.ts).
    //
    // All this does is move `markState.progress` between 0 and 1. Every curve — when a stone lets go,
    // how it travels, when the geode grows back — lives in the shader as a function of that one number,
    // which is why the ease here is `none`: easing the driver as well would double-apply it. It is also
    // why the change can simply be run BACKWARDS to undo it: a pure function of progress has no residue.
    /**
     * Run `markState.progress` to one of its endpoints at the authored rate — 1 builds `to`, 0
     * un-builds it back to `from`.
     *
     * The duration is PROPORTIONAL to the distance left to cover, which is what lets a change be
     * turned around mid-flight without changing pace: a build caught at 0.4 un-builds in 0.4 ×
     * MARK_CHANGE_SECONDS, so the stones stream home at exactly the speed they streamed out. A flat
     * duration would crawl the remainder over a full change and read as a different, slower shot.
     */
    const runMarkTo = (endpoint: 0 | 1) => {
      markTween?.kill();
      markReversing = endpoint === 0;
      markTween = gsap.to(markState, {
        progress: endpoint,
        duration: MARK_CHANGE_SECONDS * Math.abs(endpoint - markState.progress),
        ease: 'none',
        onComplete: () => {
          // Settled: `from === to` is the strategy's "sit still on this mark", so the resting frame is
          // the same code path as every other frame rather than a special case.
          const settled = endpoint === 1 ? markState.to : markState.from;
          markState.from = settled;
          markState.to = settled;
          markState.progress = 0;
          markReversing = false;
          markTween = null;
        },
      });
    };

    const stageMark = (index: number) => {
      const target = markIndexOfProject[index] ?? 0;

      // ── At rest ──
      // `from === to` is the strategy's "sit still on this mark", so a change begins from a clean pair
      // and the full four seconds.
      if (!markTween) {
        if (target === markState.to) return;
        markState.to = target;
        markState.progress = 0;
        runMarkTo(1);
        return;
      }

      // Already building toward it. A REVERSING tween is the one exception: it is travelling AWAY from
      // `to`, so a step back onto that mark has to turn it around rather than stand by and watch the
      // thing that was just asked for come apart.
      if (target === markState.to && !markReversing) return;

      // ── Turning the change around ──
      // The step goes back to a mark this change is already between, so there is nothing to restage:
      // the same tween runs the other way and the accretion plays in reverse — the stones stream home
      // the way they came and the geode closes over them. Nothing restarts, so nothing can pop.
      if (target === markState.from) return runMarkTo(0);
      if (markReversing && target === markState.to) return runMarkTo(1);

      // ── Stepping onto a THIRD mark, mid-change ──
      // `setTransition` takes exactly two marks, so there is no blend that reaches a third. This used to
      // resolve that by resetting to a settled pair — dominant mark becomes `from`, progress back to 0 —
      // which is precisely what read as "it jumps back to a whole stone and replays the build". The
      // strategy is a pure function of `(from, to, progress)`, so it does not need resetting: the change
      // keeps its progress and simply RE-AIMS. `to` becomes the new mark and the stream carries on
      // assembling that instead.
      //
      // Below the point where the incoming stones start to read — growth opens about a quarter of the
      // way in, see the schedule in worksTransition.ts — there is nothing of `to` on screen yet, so the
      // swap is literally invisible. Past it the shape being assembled changes mid-flight. That is a
      // real edit and the deliberate trade: the stone is never cut and the picture never jumps back.
      // WORKS_STEP_HOLD_MS lands a hand-driven interrupt inside the invisible part; an arrow or a nav
      // link can reach past it.
      markState.to = target;
      // A reversing change is heading for `from`, and would now un-build a mark that was never built —
      // turn it onto the new target. A forward one is already going the right way and its running tween
      // needs nothing: the duration it was given is the authored rate, so the remainder still is.
      if (markReversing) runMarkTo(1);
    };
    const applyFocus = (index: number, instant: boolean) => {
      stagedIndex = index;
      const targetU = stopKeyIndex[index] ?? 0;
      travelToU = targetU;
      if (instant || reduceMotion) {
        pathU = targetU;
        // Reduced motion gets the destination, never the journey — land on the mark, fully formed.
        markTween?.kill();
        markTween = null;
        markReversing = false;
        const target = markIndexOfProject[index] ?? 0;
        markState.from = target;
        markState.to = target;
        markState.progress = 0;
        updateCamera(true);
        return;
      }
      stageMark(index);
      startTravel(targetU);
    };

    const setFocus = (index: number) => {
      if (index === stagedIndex || !markRigs.length) return;
      applyFocus(index, false);
    };
    setFocusRef.current = setFocus;

    // ── Flight state (the services → works handoff) ──
    // The hero pin scrubs the raw 0..1 handoff (0 = fleet, 1 = resting on project 01). While it's
    // inside that span the camera rides the shared flight path; at either boundary the flight hands
    // the camera back to the normal focus-follow (so browsing between projects works as before). The
    // meteors themselves don't move — the camera flies IN to the already-lit project 01.
    const flightState = { target: 0, current: 0, engaged: false };
    const flightPose = createFlightPose();
    // Offset that maps the field's origin (meteor 01, at layout [0,0,0]) onto the shared meteor spot:
    // worksCamera = sharedCamera − meteorOffset.
    const meteorOffset = new THREE.Vector3().fromArray(METEOR_SHARED_POSITION);
    const flightLookTarget = new THREE.Vector3();
    // Gate the expensive bloom draw to when the field is actually on screen (see
    // WORKS_RENDER_THRESHOLD). The render loop keeps running regardless, so flightState eases in
    // lockstep with the deck's camera and nothing desyncs — we skip only the composer draw.
    let worksShouldRender = false;
    const onHandoffProgress = (event: Event) => {
      const progress = readHandoffProgress(event);
      flightState.target = progress;
      flightState.engaged = true;
      worksShouldRender = progress > WORKS_RENDER_THRESHOLD;
      // Reaching Works is the cue to fetch the room — never at page load, so it stays off the intro's
      // asset gate and off the first paint.
      if (worksShouldRender) ensureChamber();
    };
    window.addEventListener(HANDOFF_PROGRESS_EVENT, onHandoffProgress);

    // ── Warming a lazily-built scene ──
    // Both scenes below are fetched on the way to the section that needs them, deliberately, so they
    // stay off the intro's asset gate. But being off the gate is not the same as being ready: a scene
    // that has been BUILT but never DRAWN still has every program and every map waiting, and they all
    // land on the frame it first appears — which for both of these is inside a scrubbed crossing, the
    // worst place on the site to spend one. So each is warmed on the next idle frame after it lands.
    // See lib/warmScene.ts, which is the sun's corona fix generalised.
    //
    // ⚠ `onWarm` is not decoration. Both callers are gated sources now, and the loader holds its
    // finale until every arrived source reports warm — so the report has to happen on the far side of
    // the deferred frame, not beside the call that schedules it.
    //
    // ⚠ `drawnInto` is not optional in practice and passing the wrong one is a silent no-op. three keys
    // a program on the tone mapping and colour space implied by whatever render target is bound WHEN IT
    // COMPILES, and a bare rAF has the default framebuffer bound — so a compile run here without it
    // built programs under a key that a scene drawn through a composer never asks for, and every one of
    // them was compiled again on the frame it was first shown. See lib/warmScene.ts's header.
    let lazyWarmupFrame = 0;
    const warmWhenIdle = (
      target: THREE.Object3D,
      targetCamera: THREE.Camera,
      drawnInto: THREE.WebGLRenderTarget,
      onWarm?: () => void,
    ) => {
      lazyWarmupFrame = requestAnimationFrame(() => {
        if (disposed) return;
        warmSceneMaterials(renderer, target, targetCamera, drawnInto);
        onWarm?.();
      });
    };

    // ── The chamber ──
    //
    // ⚠ IT IS NO LONGER "BUILT LAZILY", and the two call sites that used to be its only cues are now
    // its safety net. See `beginPreflight` below for why, and `assetLoadProgress`'s source list for
    // what it cost to leave it until the crossing.
    let chamber: ChamberScene | null = null;
    let chamberReady = false;
    const ensureChamber = () => {
      if (chamber) return;
      reportSourceActivity('chamber');
      chamber = createChamberScene({
        environment: scene.environment,
        // ⚠ Activity on EVERY event, the fraction only when there is one. The loader tells "slow"
        // from "dead" by activity, so a server sending no `Content-Length` must still count as alive.
        onProgress: (fraction) => {
          reportSourceActivity('chamber');
          reportAssetProgress('chamber', fraction);
        },
        onReady: () => {
          chamberReady = true;
          // The room's walls, ground grid, plinth, display shader and the table's maps — none of which
          // exist on the GPU until something draws them, and the first thing that does is the reveal.
          //
          // ⚠ The loader holds for this, so the warm report has to come AFTER the warm-up has actually
          // run, not beside the call that schedules it. `warmWhenIdle` defers a frame, and saying
          // "warm" before that frame has drawn is how the gate would open on a room whose programs are
          // still uncompiled.
          // `screenTarget`, not `spaceBuffer`: the room is what `screenRenderPass` draws, and only the
          // stage it lands in decides the cache key its programs are built under.
          if (chamber) {
            warmWhenIdle(chamber.scene, chamber.camera, screenTarget, () =>
              reportWarmupDone('chamber'));
          } else {
            reportWarmupDone('chamber');
          }
        },
        // ⚠ Separate from `onReady` because it also fires when the load FAILED — at which point there
        // is no room to warm and nothing will ever report one, so the source has to retire itself or
        // the loader waits out its full stall window for a file that is not coming.
        onSettled: () => {
          reportAssetProgress('chamber', 1);
          if (!chamberReady) reportWarmupDone('chamber');
        },
      });
    };

    // ── The contact star (built lazily; see ensureSingularity) ──
    // The star that dies at the end of the page. It lives in THIS scene rather than in the hero sun's
    // own canvas because the finale needs lensing, and lensing bends what is already in the framebuffer
    // — the starfield is here. See components/sections/Contact/singularityScene.ts.
    // No onReady callback: this field renders continuously while it is on screen (unlike the hero sun's
    // demand-rendered canvas), and the scene re-applies its own presence when the model lands.
    let singularity: SingularityScene | null = null;

    /**
     * ── The finale is warmed by DRAWING it, not by compiling it ──────────────────────────────────
     *
     * Every mesh in the contact scene is hidden from the moment it loads until the moment it is the
     * shot, and the moments are all the same moment: at the flash the star is dissolving, the burst
     * turns on, the accretion disc turns on, `black_hole.glb` turns on — and the lensing pass compiles
     * for the very first time (that half is warmed in `warmUpField`, where the pass lives). Two glTF
     * models' vertex buffers and a particle buffer, all landing inside the one frame the whole section
     * is built to deliver. Reported as a hitch as the lensing appears, and that is exactly what it was.
     *
     * So this does what `warmUpField` does for the field and `showMarksForWarmupDraw` does for the
     * marks: a REAL render of stage 1, with every hidden part of the finale held visible.
     *
     * ── ⚠ AND THE BIGGEST ITEM ON THAT FRAME WAS NEVER THE FINALE'S OWN MATERIALS ────────────────
     * The dying star carries a POINT LIGHT (`coreLight`, the white-hot compression light inside the
     * shell), and it hangs off the same group. three keys every non-raw material's program on
     * `numPointLights`, so the frame that group turns visible does not recompile the star — it
     * recompiles THE WHOLE SPACE SCENE, starfield and debris included, because all of it is suddenly
     * being lit by one more light than the programs it is holding were built for.
     *
     * ⚠ Which is why `prewarm()` runs BEFORE `warmSceneMaterials` and not after. `compile` gathers
     * lights with `traverseVisible` — the one part of it that IS visibility-filtered — so a compile run
     * with the group still hidden rebuilds every program under exactly the key that is about to be
     * thrown away. Both keys are wanted and both get built here; a program is cached until its material
     * is disposed, so the section can cross back and forth for free afterwards.
     *
     * ⚠ Stage 1 ONLY, and that is what makes it safe to draw a dead star at any moment in the load:
     * `spaceComposer.renderToScreen` is false, so this touches nothing but its own off-screen buffers.
     * Pixels reach the canvas from `screenComposer`, which is deliberately not called here. The read
     * buffer it leaves behind cannot leak either — the loop re-renders stage 1 before sampling it on
     * every frame it draws at all, and the one path that reuses the previous buffer (the chamber's
     * space stride) cannot be reached before the reveal.
     */
    const warmSingularityWhenIdle = (onWarm?: () => void) => {
      lazyWarmupFrame = requestAnimationFrame(() => {
        if (disposed) return;
        // ⚠ FIRST. See the note above on `coreLight` — the compile below is only worth running with
        // the finale's light already in the scene's light list.
        const restoreHidden = singularity?.prewarm();
        try {
          // Programs and maps, then the uploads the draw is the only thing that can do. Both halves are
          // now keyed against the stage this scene is really rendered in, and against its real lighting.
          warmSceneMaterials(renderer, scene, camera, spaceBuffer);
          spaceComposer.render();
        } finally {
          // In `finally` for the reason `warmUpField` gives about SMAA: a throw mid-warm must not leave
          // the whole finale standing on screen at contact 0.
          restoreHidden?.();
        }
        onWarm?.();
      });
    };

    const ensureSingularity = () => {
      if (singularity) return;
      reportSourceActivity('singularity');
      singularity = createSingularityScene({
        // A getter: this is built during the loader now, before the burn-in has decided the
        // session's resolution. See the option's own header.
        pixelRatio: () => renderer.getPixelRatio(),
        lowPower,
        // The star, its rings, the accretion spiral and `black_hole.glb`'s maps all come into existence
        // hidden and stay that way until the return fades them up — so without this they would compile
        // and upload on the frame the camera swings back onto the star, which is the frame the whole
        // finale is built to deliver. Warmed through the SPACE scene, because that is where the group
        // now lives; recompiling the rest of it is cached and costs nothing.
        onProgress: (fraction) => {
          reportSourceActivity('singularity');
          reportAssetProgress('singularity', fraction);
        },
        onReady: () => warmSingularityWhenIdle(() => reportWarmupDone('singularity')),
        // ⚠ THE GATE OPENS ON THIS, NOT ON `onReady`, and the difference is the whole point of putting
        // this source on the gate at all: `onReady` fires when the STAR lands and the black hole is
        // only requested from inside that callback. Reporting there would have declared 2.37 MB
        // finished at the moment it started.
        onSettled: () => {
          reportAssetProgress('singularity', 1);
          // A second warm pass costs nothing — every program compiled by the first is cached — and it
          // is what puts the black hole's own materials on the GPU rather than leaving them for the
          // frame the finale first shows them.
          warmSingularityWhenIdle(() => reportWarmupDone('singularity'));
        },
      });
      scene.add(singularity.group);
    };

    /**
     * ── Rung 3, and it is a BUILD now, not a prefetch ────────────────────────────────────────────
     *
     * `prefetchWhenAssetsReady` used to pull `table.glb` and `black_hole.glb` into the HTTP cache here
     * so that the crossings which build them would not also have to download them. That was a real
     * improvement and it only ever fixed a third of the problem: the parse, the Draco decode, the
     * geometry upload, the material compile and the first draw all still happened mid-scrub, on the
     * first lap, which is what a visitor actually felt.
     *
     * So the same signal now builds them outright. The prefetch is gone rather than kept alongside —
     * two requests for one URL at the same instant is not a warm cache, it is a race.
     *
     * ⚠ STILL ONLY ONCE THE ENTRY SOURCES ARE IN. `areEntrySourcesReady`, deliberately not
     * `areAssetsReady` — these two ARE two of the sources that function counts now, so asking it here
     * would be a deadlock. The ladder is unchanged and it is the whole reason this is safe: the star
     * first, then the field and the fleet, then these. They compete with nothing.
     *
     * ⚠ The `ensureChamber` / `ensureSingularity` calls on HANDOFF_PROGRESS and CHAMBER_PROGRESS stay
     * exactly where they are. They are idempotent, and they are now the safety net for a load where
     * one of these gave up (a stalled request retires its source; see the intro's gate) — the section
     * degrades to precisely the behaviour it had before any of this existed.
     */
    let stopPreflightWatch: (() => void) | null = null;
    const beginPreflight = () => {
      stopPreflightWatch?.();
      stopPreflightWatch = null;
      ensureChamber();
      ensureSingularity();
    };
    if (areEntrySourcesReady()) beginPreflight();
    else {
      stopPreflightWatch = onAssetProgress(() => {
        if (areEntrySourcesReady()) beginPreflight();
      });
    }
    const onChamberProgress = (event: Event) => {
      chamberState.reveal = readChamberProgress(event);
      combineChamberTarget();
      chamberState.engaged = true;
      // A jump straight to the end of the page can land here before Works ever rendered.
      ensureChamber();
      // The reveal STARTING is the cue to fetch the contact star — never at page load. `fractured_sun`
      // is not in assetLoadProgress's weights, so an early fetch adds invisible mass to a loader whose
      // counter is honest, and competes with the copy the intro holds its handoff on. From here there is
      // the room, a full stop and a 5.8s return glide before the first frame that needs it.
      ensureSingularity();
    };
    window.addEventListener(CHAMBER_PROGRESS_EVENT, onChamberProgress);

    // The return: the same room, walked back out of. It only ever UNDOES the reveal (see
    // combineChamberTarget), so it never engages the chamber on its own — arriving here without the
    // reveal having run would mean scrubbing a room that was never entered.
    const onContactProgress = (event: Event) => {
      chamberState.contact = readContactProgress(event);
      combineChamberTarget();
      // The mark leaves so the space is empty when the camera swings back onto the star.
      setMarkPresent(chamberState.contact < CONTACT_MARK_REMOVED_AT);
      // ── The star comes back ──
      // Early in the span, and deliberately: the finale's whole premise is that you watch it die, which
      // only works if you first see it alive and unchanged. It fades up while the camera is still
      // swinging off the room, so it is already there when the frame arrives on it rather than
      // materialising under the visitor's eye.
      //
      // This window used to live in `useHeroAnimation` as RETURN_SUN_RESTORE, driving the HERO sun's
      // opacity. It moved here with the star itself — see §8.1 of the plan. There must never be two.
      singularity?.setPresence(
        THREE.MathUtils.smoothstep(
          chamberState.contact,
          CONTACT_STAR_PRESENCE[0],
          CONTACT_STAR_PRESENCE[1],
        ),
      );
      // ── Arming the finale ──
      // Only at a fully landed return: the visitor is standing in contact, not gliding toward it. The
      // pin guarantees an EXACT 1 here (CROSSING_SNAP_EPSILON snaps a settle that rounds to just inside
      // the span), which is what lets this be an equality rather than a threshold somebody has to tune.
      //
      // Scroll back and it disarms, and the star unwinds out of its death. That is deliberate, not a
      // simplification — a latched black hole would still be sitting here when you scrolled up into
      // works, where the collapsing sun belongs. See §7 of docs/contact-singularity-plan.md.
      singularity?.setArmed(chamberState.contact >= 1);
    };
    window.addEventListener(CONTACT_PROGRESS_EVENT, onContactProgress);

    // ── The dive into the hole ──
    // The camera falls toward the origin. There is no path to author: the hole sits at (0,0,0) and every
    // works key already aims there, so the fall is simply the authored pose's distance collapsing.
    let diveProgress = 0;
    const onLoopProgress = (event: Event) => {
      diveProgress = readLoopProgress(event);
      singularity?.setDive(diveProgress);
    };
    window.addEventListener(LOOP_PROGRESS_EVENT, onLoopProgress);

    // ── The teleport landed; stop easing ──
    // Every value below CHASES its target rather than reading it, which is what makes the crossings
    // cinematic and is exactly wrong here: the pin has just jumped to 0, so their targets are already
    // home while they are still half a second behind. Behind the cover that reads as the chamber
    // re-assembling and the space flying back together. See LOOP_RESET_EVENT.
    const onLoopReset = () => {
      diveProgress = 0;
      chamberState.reveal = 0;
      chamberState.contact = 0;
      combineChamberTarget();
      chamberState.current = chamberState.target;
      chamberState.revealEased = chamberState.reveal;
      chamberState.engaged = false;
      flightState.target = 0;
      flightState.current = 0;
      flightState.engaged = false;
      worksShouldRender = false;
      setMarkPresent(true);
      singularity?.reset();
      // The warp is measured from frame-to-frame camera movement, and the jump moves it further than
      // any hop ever could. Without this the hero would open with the starfield streaking at full tilt.
      hasPreviousCameraPosition = false;
      warp = 0;
    };
    window.addEventListener(LOOP_RESET_EVENT, onLoopReset);

    // ── The pin was moved outright, but NOT to the top ──
    // The reverse loop parks at the far end of the dive. Everything above zeroes, which is right for an
    // arrival at the hero and wrong for anything else — so this is the same idea with the targets left
    // alone: stop easing, be where you are already being asked to be. The pin drives the crossings to
    // the new position before dispatching, so every target read here is current. See LOOP_SNAP_EVENT.
    const onLoopSnap = () => {
      chamberState.current = chamberState.target;
      chamberState.revealEased = chamberState.reveal;
      flightState.current = flightState.target;
      // Same reason as the reset's: the jump moves the camera further in one frame than any hop could,
      // and the warp is measured frame-to-frame. Without this the cover lifts on a full-tilt starfield.
      hasPreviousCameraPosition = false;
      warp = 0;
      singularity?.settle();
    };
    window.addEventListener(LOOP_SNAP_EVENT, onLoopSnap);

    // ── Warm-up: build every program and allocate every buffer while nothing is watching ──
    //
    // Four beats, ONE PER FRAME, and the spacing is the whole design. Every one of these is GPU-process
    // work, and while the GPU process is busy the compositor cannot present ANYONE's frames — including
    // the loader's dust, which renders in a worker and is otherwise immune to anything the main thread
    // does. That is the discriminator `docs/loader-freeze-plan.md` §7 established, and it is why "the
    // dust froze too" ruled out every main-thread explanation. Run back to back, these four are one long
    // stall on exactly the beat the loader is trying to deliver its finale. Given a frame each, they are
    // four short ones.
    //
    //   1 · compileAsync   — programs. ⚠ Runs `renderer.compile()` SYNCHRONOUSLY before it awaits
    //                        anything (three's own source); only the wait for linking is offloaded.
    //   2 · first draw     — by far the most expensive, and the least obvious: this is where both
    //                        composers ALLOCATE, and a full-resolution HalfFloat target with MSAA is
    //                        tens of megabytes each. It also compiles the bloom, present, HUD and SMAA
    //                        passes, none of which `compileAsync` can reach (they are not in the scene).
    //   3 · the probe      — the same draw again, drained and timed. See lib/gpuProbe.ts.
    //   4 · re-size        — only if the probe changed the pixel ratio, so the reallocation that implies
    //                        happens HERE rather than on the first frame of the works section.
    //
    // SMAA is force-enabled across the warm-up and put back afterwards: it is off for the whole works
    // section by design (see where the pass is built), so without this its three programs would compile
    // on the frame the chamber first appears — mid-reveal, in a scrubbed crossing, which is the worst
    // place on the site to spend a frame.
    let warmupFrame = 0;
    const nextWarmupFrame = () =>
      new Promise<void>((resolve) => {
        warmupFrame = requestAnimationFrame(() => resolve());
      });
    const drawWarmupFrame = () => {
      spaceComposer.render();
      presentUniforms.uSpace.value = spaceTexture();
      screenComposer.render();
    };

    /**
     * ── The marks have to be DRAWN once, not merely compiled ─────────────────────────────────────
     *
     * They are hidden at rest (`markVisible` is false until the handoff reaches
     * METEOR_ARRIVE_PROGRESS_START), so every warm-up draw above skips them — and `compileAsync`
     * covers only their PROGRAMS, because `compile` walks with `traverse`. Neither their multi-megabyte
     * vertex buffers nor their textures reach the GPU until the frame they first turn visible, which is
     * inside the services → works crossing.
     *
     * That froze the SHIP, which is drawn by a completely different renderer on a different canvas —
     * the tell that this is GPU-process work, exactly as `lib/warmScene.ts`'s header describes. The
     * compositor cannot present anyone's frames while the GPU process is uploading.
     *
     * Four marks land together, each carrying its own cut geometry plus cloned stone/cavity maps —
     * and a clone is a SEPARATE upload however much of its image it shares (see
     * `accretionTransition`'s note on `Texture.clone`). The deck's `prewarmPipeline` has always shown
     * every hull for its warm draw for this reason; the field simply never did the same for its marks.
     *
     * ⚠ `frustumCulled` off as well as visible: a culled object never reaches the render list, so
     * whether this uploaded anything would otherwise depend on where the camera happened to be
     * pointing during the warm-up. Both are restored by the returned function.
     */
    const showMarksForWarmupDraw = (): (() => void) => {
      const unculled: THREE.Object3D[] = [];
      markRigs.forEach((rig) => {
        rig.group.visible = true;
        rig.group.traverse((child) => {
          if (!child.frustumCulled) return;
          child.frustumCulled = false;
          unculled.push(child);
        });
      });
      return () => {
        unculled.forEach((child) => { child.frustumCulled = true; });
        // Back to hidden — the arrival block re-asserts this every frame anyway, but leaving four
        // landed marks in shot for the frames between here and the first scroll would be visible.
        markRigs.forEach((rig) => { rig.group.visible = false; });
      };
    };

    let warmupStarted = false;
    const warmUpField = async () => {
      if (warmupStarted || disposed) return;
      warmupStarted = true;
      // Restored in `finally`, not inline, so an early return on teardown or a throw mid-probe cannot
      // leave the works section running a pass it is supposed to have off.
      const smaaWasEnabled = smaaPass.enabled;
      // ⚠ THE LENS IS WARMED THE SAME WAY AND FOR A STRONGER REASON THAN SMAA.
      // `compileAsync` cannot reach a post-processing pass at all — a pass's material lives on its own
      // FullScreenQuad, not in any scene — so the only thing that ever builds this program is a render
      // with the pass enabled. Left to itself that render is the FLASH at the contact finale: the
      // program linked on the exact frame the lensing was supposed to appear, and the link is GPU-process
      // work, so it took the whole page with it for a beat. Enabled for the allocation draw below and
      // put straight back, so it never reaches the probe.
      const lensWasEnabled = lensingPass.enabled;
      try {
        // Out of the caller's tick first. Both entry points land inside asset work — `buildField` has
        // just finished cutting four marks and notifying the loader's listeners, and the backstop
        // event is dispatched from inside the intro's own progress callback. `compileAsync` runs
        // `renderer.compile()` synchronously, so without this it blocks on top of whatever is already
        // on that tick instead of getting a frame of its own.
        await nextWarmupFrame();
        if (disposed) return;

        await renderer.compileAsync(scene, camera);
        if (disposed) return;
        await nextWarmupFrame();
        if (disposed) return;

        smaaPass.enabled = true;
        lensingPass.enabled = true;
        // The marks ride on THIS draw and are put back before the next one — see
        // `showMarksForWarmupDraw`. This is already the draw that carries the allocations, and keeping
        // them off the probe below means the measurement that sizes the whole session still sees
        // exactly the frame it has always been calibrated against.
        const restoreMarks = showMarksForWarmupDraw();
        drawWarmupFrame();
        restoreMarks();
        // Off before the measurement: works never runs this pass, so billing the session's resolution
        // for a full-screen blit it only pays for one second at the bottom of the page would size every
        // machine against a frame it never draws.
        lensingPass.enabled = false;

        await nextWarmupFrame();
        if (disposed) return;
        // Measured on the SECOND draw — the first is carrying the allocations above, and timing those
        // would report every machine as far slower than it is.
        //
        // Measured with SMAA ON, deliberately, even though works itself runs without it: the chamber
        // does run it, and the chamber is the heaviest thing this pipeline ever draws. Sizing the
        // session against the worst frame rather than the common one is the conservative direction.
        const cost = measureGpuFrameCost(renderer, drawWarmupFrame);
        // The only measurement the site takes, and it decides the resolution every heavy scene runs at
        // for the session. Taken here because this is the heaviest pipeline on the page, at its real
        // size, on a render that had to happen anyway.
        reportProbedFrameCost(cost.milliseconds, cost.megapixels, renderer.getPixelRatio());

        await nextWarmupFrame();
        if (disposed) return;
        if (getPixelRatio() !== appliedPixelRatio) {
          // The probe moved us. Resize and draw once more, so the buffers the works section will
          // actually use are allocated now rather than on the frame it first appears.
          applyRendererSize();
          drawWarmupFrame();
        }

        // ⚠ The burn-in used to be step 5 here and produced a reading exactly never. It has moved out
        // to its own gate stage — see `runBurnIn` below and BURN_IN_EVENT.
      } catch {
        // A failed compile is not a reason to trap the loader — the section degrades to compiling
        // whatever failed on first draw, exactly as it did before any of this existed.
      } finally {
        smaaPass.enabled = smaaWasEnabled;
        lensingPass.enabled = lensWasEnabled;
        if (!disposed) reportWarmupDone('works'); // the intro holds the reveal until this fires
      }
    };

    /**
     * ── The loader's performance measurement ─────────────────────────────────────────────────────
     *
     * Cued by the intro once BOTH scenes report warm and before the shards fly — the one moment in the
     * whole load where the main thread is genuinely idle. Nothing is compiling, nothing is uploading,
     * the dust is in a worker, and the only other thing drawing is the star, which is exactly what will
     * be drawing alongside this section later.
     *
     * That last point is why this is a measurement and `gpuProbe` is only a ceiling: the probe times
     * this pipeline ALONE with the GPU drained either side, and its spread across four loads of one
     * page was eightfold. This is rAF-to-rAF on real pipelined frames with the real second context
     * running.
     *
     * ⚠ It ALWAYS answers, even when it refuses. The intro is holding its finale on the done event, so
     * a silent return here would stall the loader until the cap expires — and a refusal that says
     * nothing is how the previous version of this went unnoticed for a day.
     */
    let burnInRun = false;
    const runBurnIn = async () => {
      if (burnInRun || disposed) return;
      burnInRun = true;
      // ⚠ SMAA off for it. It is forced ON for the probe deliberately (the chamber runs it and is the
      // worst frame this pipeline ever draws), but the works BROWSING span — the long one, the one
      // that is scrubbed through — runs without it. Measure the common case and let the safety margin
      // absorb the chamber; sizing a whole session against its single heaviest frame is how a site
      // ends up uniformly soft.
      const smaaWasEnabled = smaaPass.enabled;
      smaaPass.enabled = false;
      const burnStartedAt = performance.now();

      // ── What this device is measured with ──
      // Read ONCE, so the two phases cannot be sampled under different rules — a phase A judged by one
      // ceiling and a phase B by another would make `B − A` a difference of two different instruments.
      // `getDeviceTier` is latched, so this is a formality today; it stops being one the moment anyone
      // makes the tier reactive.
      const slowDevice = isLowPowerDevice();
      const phaseBudgetMs = slowDevice ? BURN_IN_PHASE_MAX_LOW_POWER_MS : BURN_IN_PHASE_MAX_MS;
      const sampleCeilingMs = slowDevice
        ? BURN_IN_SANE_FRAME_LOW_POWER_MS
        : BURN_IN_SANE_FRAME_MS;

      /**
       * Draw works frames until the main thread stops throwing long tasks at us.
       *
       * ⚠ It KEEPS DRAWING while it waits, deliberately. The point is to reach the state the
       * measurement will be taken in — a warm pipeline on a settled GPU — not to idle beside it. An
       * empty wait would hand phase A its own first-draw costs all over again.
       */
      const waitForQuietMainThread = async () => {
        const settleBudgetMs = slowDevice
          ? BURN_IN_SETTLE_MAX_LOW_POWER_MS
          : BURN_IN_SETTLE_MAX_MS;
        let calmFrames = 0;
        let previousFrameAt = 0;
        while (performance.now() - burnStartedAt < settleBudgetMs) {
          await nextWarmupFrame();
          if (disposed) return;
          const frameAt = performance.now();
          drawWarmupFrame();
          if (previousFrameAt > 0 && frameAt - previousFrameAt <= BURN_IN_SANE_FRAME_MS) {
            calmFrames += 1;
          } else {
            calmFrames = 0;
          }
          previousFrameAt = frameAt;
          if (calmFrames >= BURN_IN_CALM_FRAMES) return;
        }
      };

      /**
       * One phase: draw real works frames and return the MEDIAN interval, or null if too few were
       * usable to mean anything.
       *
       * Median, not mean: one garbage collection inside the window is worth sixteen real frames at
       * 25 fps, and the mean would carry it straight into the solve.
       */
      const samplePhase = async (): Promise<number | null> => {
        const samples: number[] = [];
        const phaseStartedAt = performance.now();
        let previousFrameAt = 0;
        let discarded = 0;
        for (let frame = 0; frame < BURN_IN_MAX_FRAMES; frame += 1) {
          await nextWarmupFrame();
          if (disposed) return null;
          const frameAt = performance.now();
          drawWarmupFrame();
          const interval = previousFrameAt > 0 ? frameAt - previousFrameAt : 0;
          previousFrameAt = frameAt;
          // The first frames carry the reallocation and the first draw after a state change — the cost
          // of arriving at this resolution rather than the cost of holding it.
          //
          // ⚠ In phase B these also absorb the STAR's first frame, which is the expensive one: the
          // permit sets `forceRender`, and if the probe moved the shared ratio since the star was
          // built, its own `applySize` — a bloom pyramid reallocation — lands on that same frame. Three
          // is enough for both because the permit is dispatched immediately before this call, so the
          // star's first draw can only fall inside them.
          if (discarded < BURN_IN_DISCARD_FRAMES) {
            discarded += 1;
            continue;
          }
          // ⚠ Reject the frame, do not abandon the phase. See BURN_IN_SANE_FRAME_MS — and
          // BURN_IN_SANE_FRAME_LOW_POWER_MS for why the ceiling is not one number for every device.
          if (interval > 0 && interval <= sampleCeilingMs) samples.push(interval);
          if (samples.length >= BURN_IN_TARGET_SAMPLES) break;
          if (frameAt - phaseStartedAt >= phaseBudgetMs) break;
        }
        if (samples.length < BURN_IN_MIN_SAMPLES) return null;
        samples.sort((left, right) => left - right);
        return samples[Math.floor(samples.length / 2)];
      };

      try {
        await waitForQuietMainThread();
        if (disposed) return;

        // ── Phase A · the field alone. The star has not been permitted to draw yet. ──
        const fieldOnlyMs = await samplePhase();
        if (disposed) return;

        // ── The star joins, and TIMES ITSELF ──
        // Dispatched even if phase A refused: the measurement is optional, the star appearing is not.
        //
        // ⚠ THE POSE FIRST, THEN THE PERMIT, AND THE ORDER IS THE POINT. Until 2026-08-13 the star was
        // timed with its corona hidden and its rings collapsed — ten tumbling shards — because this all
        // runs before `SUN_ASSEMBLE_EVENT` and `positionShards(0, 0)` has already hidden everything
        // that is not a shard. The corona IS the star's cost. `SUN_MEASURE_BEGIN_EVENT` carries the
        // whole finding.
        window.dispatchEvent(new Event(SUN_MEASURE_BEGIN_EVENT));
        window.dispatchEvent(new Event(SUN_DRAW_PERMIT_EVENT));

        // ⚠ WAIT FOR THE STAR, BUT NEVER ON THE STAR. It answers from its own rAF loop, and it is
        // entitled to refuse the pose outright — before its model has landed, under reduced motion, or
        // once the assembly has been cued. So this is a bounded poll and not an event handshake: a
        // refusal must cost a fallback, never a loader stuck behind `BURN_IN_WAIT_MAX_MS`.
        //
        // ⚠ The field draws nothing while it waits, deliberately. The star is about to block the GPU
        // process on three `gl.finish()` drains, and anything this renderer submitted into that window
        // would be timed as part of the star.
        for (
          let frame = 0;
          frame < STAR_SELF_MEASURE_MAX_FRAMES && getStarFrameCost() === null;
          frame += 1
        ) {
          await nextWarmupFrame();
          if (disposed) return;
        }
        const starCost = getStarFrameCost();

        // ── Phase B · ONLY as the fallback, and only when the star did not answer ──
        // On the normal path this does not run at all: it is the subtraction that returned a NEGATIVE
        // star on a warming phone (see `noteStarFrameCost`), and skipping it also gives back most of
        // the loader time the low-power phase budget spends. It stays because `reportBurnIn` needs the
        // cost of a WHOLE frame with the star in it, and without the star's own number there is no
        // other way to obtain one.
        const fieldAndStarMs =
          starCost === null ? await samplePhase() : null;
        // Closed the moment the samples are in, not in `finally` — everything between here and there
        // is field work that would otherwise run with the star holding a formed pose it cannot keep.
        window.dispatchEvent(new Event(SUN_MEASURE_END_EVENT));
        if (disposed) return;

        // What a full frame costs, however we came by it. With the star's own number this is modelled
        // rather than sampled — ⚠ and it mixes two instruments, a drained star against rAF-sampled
        // field frames, so it is deliberately used ONLY for `reportBurnIn`'s fallback sizing and never
        // for the split itself.
        const wholeFrameMs =
          starCost !== null && fieldOnlyMs !== null
            ? fieldOnlyMs + starCost.milliseconds
            : fieldAndStarMs;

        if (wholeFrameMs === null) {
          if (telemetryEnabled) {
            console.log(
              `%c[pixels] burn-in REFUSED%c not enough usable frames in ` +
                `${(performance.now() - burnStartedAt).toFixed(0)} ms (needs ${BURN_IN_MIN_SAMPLES} per phase),` +
                ` and the star did not self-measure either.` +
                `\n  The runtime calibration will decide instead — expect a CALIBRATED line per scene.`,
              'color:#e0b341;font-weight:700',
              'color:#888',
            );
          }
          return;
        }

        // ── Hand the allocator the split ──
        //
        // ⚠ TWO PATHS, AND THE FIRST ONE NEEDS NO CREDIBILITY CHECKS AT ALL. The star's own drained
        // measurement is not a difference, so none of the ways a difference goes wrong can apply to
        // it: there is no ordering to bias it, no second phase to come out faster, and no jitter floor
        // to clear. It is simply what the star cost.
        //
        // The `B − A` path below keeps all three checks, because it keeps all three failure modes:
        //
        //   1 · REDUCED MOTION draws the star from mount (`drawingPermitted = reduceMotion` in
        //       SunModelCanvas — that path has no held beat and would otherwise show an empty box
        //       where the star goes). So phase A already contains the star, B − A is noise around
        //       zero, and the allocator would conclude the star is free and hand it the ceiling.
        //   2 · Phase A must be the FASTER of the two. ⚠ THIS IS THE ONE THAT FIRES IN PRACTICE — an
        //       iPhone returned field 21.0 ms against both 17.0 ms, i.e. a star costing MINUS 4 ms,
        //       because the machine sped up between the phases. That is the whole reason path one
        //       exists.
        //   3 · The difference must be big enough to be a measurement rather than jitter.
        //
        // ⚠ A REFUSED SPLIT NO LONGER SKIPS THE ALLOCATION on the star's own path — it cannot, since
        // there is nothing to disbelieve. Where the subtraction is used and refused, the behaviour is
        // exactly as it was: `reportBurnIn` sizes everything off one number.
        const subtractedStarMs =
          fieldOnlyMs === null || fieldAndStarMs === null ? 0 : fieldAndStarMs - fieldOnlyMs;
        const subtractionIsCredible =
          fieldAndStarMs !== null &&
          !prefersReducedMotion() &&
          fieldOnlyMs !== null &&
          subtractedStarMs >= MIN_CREDIBLE_STAR_MS &&
          subtractedStarMs <= fieldAndStarMs * MAX_CREDIBLE_STAR_SHARE;

        if (fieldOnlyMs !== null && starCost !== null) {
          reportSectionCosts({
            fieldMilliseconds: fieldOnlyMs,
            starMilliseconds: starCost.milliseconds,
            fieldRatio: renderer.getPixelRatio(),
            starRatio: starCost.ratio,
          });
        } else if (subtractionIsCredible && fieldOnlyMs !== null) {
          reportSectionCosts({
            fieldMilliseconds: fieldOnlyMs,
            starMilliseconds: subtractedStarMs,
            fieldRatio: renderer.getPixelRatio(),
            starRatio: getSunPixelRatio(),
          });
        } else if (telemetryEnabled) {
          console.log(
            `%c[pixels] split REFUSED%c field ${fieldOnlyMs?.toFixed(1) ?? '—'} ms, ` +
              `both ${fieldAndStarMs?.toFixed(1) ?? '—'} ms → star ${subtractedStarMs.toFixed(2)} ms.` +
              `\n  The star did not self-measure, and the subtraction is not a credible separation` +
              `${prefersReducedMotion() ? ' (reduced motion — the star draws from mount)' : ''};` +
              ` falling back to one number for the whole frame.`,
            'color:#e0b341;font-weight:700',
            'color:#888',
          );
        }

        reportBurnIn(wholeFrameMs, renderer.getPixelRatio());
        if (getPixelRatio() !== appliedPixelRatio) {
          // Allocate what it decided, here, behind the veil — so this section's first real frame is
          // already at its final resolution and never re-sizes in front of anyone.
          applyRendererSize();
          drawWarmupFrame();
        }
        // ── …and the extra it may have earned, in the same still frame ──
        // The burn-in's solve is the only measurement that exists before the site is visible, and it
        // is the one that decides this now. Left to the render loop it could not possibly be decided
        // before the first lap — the runtime licence needs four seconds of 50 fps — so the raise was
        // always a `dispose()` and reallocation of two composer targets several seconds into the
        // fleet, on the first visit and never again. That is exactly the class of thing this whole
        // change is here to move.
        //
        // ⚠ AFTER the ratio, never before. The samples come out of what the resolution left over, and
        // `estimateComposerBytes` below is measured against the drawing buffer the ratio just sized.
        raiseMsaaIfEarned();
        if (msaaRaised) drawWarmupFrame(); // rebuild the disposed targets now, not on the first real frame
      } finally {
        smaaPass.enabled = smaaWasEnabled;
        // ⚠ Both unconditional, and for the same reason: the loader is holding on us. The finale waits
        // on the done event, and the STAR waits on the permit — so a throw anywhere above must not be
        // able to leave a dark square where the site's centrepiece goes. `permitDrawing` is idempotent,
        // so re-firing a permit already sent between the phases costs nothing.
        if (!disposed) {
          // ⚠ The pose is closed here as well as after phase B, and it is the more important of the
          // two: a throw between them would otherwise strand the star fully formed with its rings out,
          // and the loader's finale would fly ten shards into a star that had already assembled itself.
          // Idempotent, so the normal path firing it twice costs nothing.
          window.dispatchEvent(new Event(SUN_MEASURE_END_EVENT));
          window.dispatchEvent(new Event(SUN_DRAW_PERMIT_EVENT));
          window.dispatchEvent(new Event(BURN_IN_DONE_EVENT));
        }
      }
    };
    const onBurnInRequested = () => void runBurnIn();
    window.addEventListener(BURN_IN_EVENT, onBurnInRequested);

    // ── When it runs ──
    // As soon as THIS section's own assets are in — not when the whole page's are.
    //
    // The two sources finish at very different times (the fleet is ~5.3 MB of vessels against this
    // section's ~0.95 MB of surfaces), and the gate used to hold both warm-ups until the LAST byte on
    // the page had landed, then run them one after the other. That stacked two compiles and two first
    // allocations into a two-frame window at exactly 100 % — immediately before the shard flight, which
    // is the one thing the whole loader is built to deliver. Starting here instead spends this
    // section's warm-up inside the fleet's download, where the GPU is otherwise idle, and leaves only
    // one scene's worth of work on the tail.
    //
    // ⚠ But own-assets-in is only HALF the condition, and shipping it alone made the loader's wordmark
    // stutter. The other half is that the loader has finished animating: five Syne 800 glyphs at up to
    // 256 px, moving transform AND opacity through a `back.out` overshoot, are the most expensive thing
    // the loader ever draws — and on a fast connection this section's assets land right on top of them.
    // ASSETS_WARMUP_EVENT is now dispatched when the wordmark has resolved and the stage is still, so
    // the compile goes where nothing is moving except the dust, which is in a worker and cannot stutter.
    let assetsIn = false;
    // Starts TRUE when there is no loader on the page. Under reduced motion the intro bypasses its
    // timeline entirely and never dispatches, so waiting on the event would mean never warming at all.
    // Read from the DOM rather than from INTRO_ACTIVE_EVENT because this hook is behind a dynamic
    // import and mounts long after that event has been and gone — the same reason SunModelCanvas does it.
    // Three ways to already be quiet, and all three are needed. The STATE covers a scene whose chunk
    // arrived after the intro had already dispatched (this hook is dynamically imported, so on a slow
    // connection that ordering is real). The DOM check covers reduced motion and any page with no
    // loader on it. The event covers the ordinary case.
    let stageQuiet =
      isStageQuiet() || document.querySelector(INTRO_MARKER_SELECTOR) === null;
    const warmWhenBothReady = () => {
      if (assetsIn && stageQuiet) void warmUpField();
    };
    const onWarmupRequested = () => {
      stageQuiet = true;
      warmWhenBothReady();
    };
    window.addEventListener(ASSETS_WARMUP_EVENT, onWarmupRequested);

    // ── Meteor arrival (driven by handoff progress; fully reversible) ──
    // 0 = hidden/far, 1 = landed. Recomputed each frame in the render loop from the eased flight
    // progress via a smoothstep window — so scrolling back recedes the rocks in step with the ship
    // flying back onto the pad.
    const meteorArrival = { value: 0 };
    const meteorArriveFrom = new THREE.Vector3(); // scratch: each rock's far start (basePosition + offset)

    // ── Drag-to-look ──
    // Only while you're actually IN the space. Once the reveal has started, the space is a picture on a
    // screen across the room — dragging it around like a camera you're sitting behind makes no sense — so
    // once the chamber is up, a drag does nothing.
    const drag = { active: false, startX: 0, startY: 0 };
    /** True once the space is being shown on a screen rather than flown through. */
    const inChamber = () => !!chamber && chamberState.current > CHAMBER_ENGAGE_EPSILON;

    const handlePointerDown = (event: PointerEvent) => {
      if (reduceMotion) return;
      drag.active = true;
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      canvas.setPointerCapture?.(event.pointerId);
    };
    const handlePointerMove = (event: PointerEvent) => {
      if (!drag.active) return;
      // In the room the space is a picture on a screen — a drag has nothing to orbit.
      if (inChamber()) return;
      viewYawTarget = THREE.MathUtils.clamp(
        (event.clientX - drag.startX) * DRAG_YAW_SENSITIVITY, -DRAG_YAW_CLAMP, DRAG_YAW_CLAMP,
      );
      viewPitchTarget = THREE.MathUtils.clamp(
        (event.clientY - drag.startY) * DRAG_PITCH_SENSITIVITY, -DRAG_PITCH_CLAMP, DRAG_PITCH_CLAMP,
      );
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (!drag.active) return;
      drag.active = false;
      canvas.releasePointerCapture?.(event.pointerId);
      // Spring the look back to centre (the eased return in updateCamera does the travel).
      viewYawTarget = 0;
      viewPitchTarget = 0;
    };
    canvas.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    // Push the shared adaptive pixel ratio + current CSS size onto BOTH the renderer and the
    // composer (the composer caches its own pixel ratio, so it must be told separately or the bloom
    // targets stay at the old density). Also owns the portrait pull-back. Used for real resizes and
    // whenever the adaptive controller shifts the ratio; defined before the loop so it can call it.
    /** One MSAA upgrade attempt per session, whichever way it goes. */
    let msaaRaised = false;

    /**
     * Raise the space stage to 4× MSAA, if this machine earned it and can hold the bytes.
     *
     * ⚠ TWO GATES, AND THEY ARE DIFFERENT QUESTIONS. `hasEarnedExtraQuality` asks whether there is
     * time in the frame for it; `estimateComposerBytes` asks whether there is memory for it. A
     * machine can pass one and fail the other, and the memory answer is the one that turns a fast
     * laptop into a slow one — see the render-target arithmetic in the constant block above.
     *
     * ⚠ Called from the BURN-IN first, behind the loader's veil, so the reallocation lands where no
     * one can see it. The render loop keeps a call as the fallback for a load where the burn-in never
     * ran. Idempotent either way: `msaaRaised` latches on the first attempt, pass or fail.
     */
    const raiseMsaaIfEarned = () => {
      if (
        msaaRaised ||
        deviceTier === 'potato' ||
        !hasEarnedExtraQuality() ||
        spaceBuffer.samples >= BLOOM_MSAA_SAMPLES_EARNED
      ) {
        return;
      }
      const drawingContext = renderer.getContext();
      const projectedBytes = estimateComposerBytes(
        drawingContext.drawingBufferWidth,
        drawingContext.drawingBufferHeight,
        BLOOM_MSAA_SAMPLES_EARNED,
      );
      msaaRaised = true;
      const affordable = projectedBytes <= SPACE_COMPOSER_MEMORY_BUDGET_BYTES;
      if (affordable) {
        // ⚠ BOTH buffers, and `dispose` rather than `setSize`: the latter only rebuilds when the
        // DIMENSIONS change, and `samples` is read in `setupRenderTarget`.
        for (const target of [spaceComposer.renderTarget1, spaceComposer.renderTarget2]) {
          target.samples = BLOOM_MSAA_SAMPLES_EARNED;
          target.dispose();
        }
      }
      if (telemetryEnabled) {
        console.log(
          affordable
            ? `[voidix] msaa: raised to ${BLOOM_MSAA_SAMPLES_EARNED}× on the space stage — ` +
                `earned, and it costs ${(projectedBytes / 1048576).toFixed(0)} MB`
            : `[voidix] msaa: earned but declined — ${BLOOM_MSAA_SAMPLES_EARNED}× would cost ` +
                `${(projectedBytes / 1048576).toFixed(0)} MB, over the ` +
                `${SPACE_COMPOSER_MEMORY_BUDGET_BYTES / 1048576} MB budget`,
        );
      }
    };
    let appliedPixelRatio = getPixelRatio();
    /** How long the controller's ratio has differed from the one actually allocated. */
    let ratioPendingSeconds = 0;
    /**
     * Mirrors the `.is-uncomposited` class. Starts `false` to match the DOM, which carries no class
     * yet — the first frame then applies the real state.
     *
     * ⚠ `visibility: hidden` and not `display: none`: a hidden element keeps its layout box, so
     * `canvas.clientWidth/Height` still read correctly and the warm-up render still sizes itself. It
     * also does not stop WebGL drawing, which is exactly right — the warm-up has to happen off screen.
     */
    let canvasUncomposited = false;
    // The canvas's CSS size, which the chamber needs in full — not just as an aspect. Its display wears
    // the aspect (that's what makes the cover distance exact), and its hologram's anchor is projected
    // into these pixels (see lib/hologramPose.ts). Measured here rather than read off `window` on the
    // other side, so nothing has to assume the canvas fills the viewport.
    let viewportWidth = 1;
    let viewportHeight = 1;
    /** The canvas box has moved and the buffers have not followed yet — see the resize block below. */
    let canvasSizeDirty = false;
    /**
     * How far the canvas's CSS box has drifted from the size the buffers were allocated at.
     *
     * Symmetric, so shrinking counts as much as growing: 1 means they agree, 1.25 means a quarter out
     * either way. Measured against `viewportWidth/Height`, which `applyRendererSize` sets to the size
     * it last allocated — so a slow drag accumulates toward the ceiling instead of creeping under it.
     */
    const canvasStretch = () => {
      const width = canvas.clientWidth || canvas.offsetWidth;
      const height = canvas.clientHeight || canvas.offsetHeight;
      if (!width || !height) return 1;
      return Math.max(
        width / viewportWidth,
        viewportWidth / width,
        height / viewportHeight,
        viewportHeight / height,
      );
    };
    const applyRendererSize = () => {
      const width  = canvas.clientWidth  || canvas.offsetWidth;
      const height = canvas.clientHeight || canvas.offsetHeight;
      if (!width || !height) return;
      const aspect = width / height;
      const ratio = getPixelRatio();
      if (ratio !== appliedPixelRatio) noteRatioApplied();
      appliedPixelRatio = ratio;
      viewportWidth = width;
      viewportHeight = height;
      hud.setSize(width, height, ratio);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      // Portrait → pull the camera back so the meteor doesn't overflow the narrow frame.
      // ⚠ The flight reads this too (see the handoff branch in the render loop). It used to be an
      // inline expression here and nowhere else, which is precisely how the arrival came to pop.
      distanceScale = portraitPullbackScale(aspect);
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      // Both stages follow the adaptive resolution. The composers resize their own buffers in place;
      // the present quad re-reads its texture off the composer each frame, so nothing goes stale here.
      spaceComposer.setPixelRatio(ratio);
      spaceComposer.setSize(width, height);
      screenComposer.setPixelRatio(ratio);
      screenComposer.setSize(width, height);
    };

    // ── Render loop ──
    const frameTimer = createFrameTimer(MAX_FRAME_SECONDS);
    let frameId = 0;
    /**
     * Frames drawn since stage 1 last redrew — the chamber's space stride (CHAMBER_SPACE_STRIDE_MAX).
     *
     * Counted as "since", not as `frameCounter % stride`, on purpose: the stride is a live function of
     * the room's progress, and a modulo against a stride that just changed can skip several frames in
     * a row or fire twice. This form always draws the frame the stride returns to 1.
     */
    let framesSinceSpaceRender = 0;
    /**
     * Did stage 1 actually redraw on the PREVIOUS drawn frame?
     *
     * ⚠ The resolution controller's whole diet. `frameTimer.lastRawDelta()` measures the frame BEFORE
     * this one, so a sample is only honest when that frame did the full job. Decimated frames are
     * cheaper by construction, and feeding them to `sampleFrame` would teach the controller a frame
     * rate the site cannot hold — which it latches on, twice and both one-way: `EMERGENCY_FAST_FPS`
     * raises the resolution for the rest of the session, and `EXTRA_QUALITY_FPS` buys 4× MSAA on the
     * space composer. The chamber would quietly bill works browsing for standing still in a room.
     */
    let spaceRenderedLastFrame = true;
    // Warp state — read from the camera's own speed each frame so the streaks + FOV follow the exact
    // launch/arrive curve of the travel tween (longer hops naturally streak harder).
    const previousCameraPosition = new THREE.Vector3();
    const streakDirection = new THREE.Vector3(0, 0, 1);
    let hasPreviousCameraPosition = false;
    let warp = 0;
    const renderFrame = () => {
      frameId = requestAnimationFrame(renderFrame);
      const loopStartedAt = profileNow();
      // Accumulate across every pass this frame rather than being reset by each `render()` — see the
      // gauge read at the bottom. Costs nothing when telemetry is off; `autoReset` is set there too.
      if (telemetryEnabled) renderer.info.reset();
      const deltaSeconds = frameTimer.tick();
      const elapsed = frameTimer.elapsed();

      // The debris and the starfield keep their slow ambient drift and nothing else. They used to
      // counter-rotate against the body during a change, so the two rates would add into the apparent
      // speed — but the body is steady now, and a field spinning on its own reads as the camera
      // rolling rather than as anything moving (which is exactly what that constant's own comment
      // warned about). The sense of going around comes from the camera orbit instead.
      starSystem.group.rotation.y = elapsed * STAR_DRIFT;
      shardMeshes.forEach((mesh, meshIndex) => {
        // Opposite drift on the two fields gives the debris a parallax shimmer.
        mesh.rotation.y = elapsed * SHARD_DRIFT_SPEED * (meshIndex === 0 ? 1 : -1);
      });

      // ── The mark ──
      // Steady. It does not turn on its own axis: the camera path orbits it, and a body that also
      // spun would fight that — you could no longer tell whether the mark or the world was moving.
      // The float is kept, so a parked mark still breathes rather than sitting dead in space.
      //
      // One call drives the entire change. Everything else — which stones are travelling, how far the
      // geode has grown, how hot a break face burns — is a pure function of these three numbers,
      // evaluated in the vertex shader.
      // Skipped wholesale once the mark has left for contact. This is the half of "removed, not hidden"
      // that actually costs something: the strategy is driven from this list rather than from the scene
      // graph, so taking the group out of the scene would not have stopped a line of it.
      if (markPresent) {
        markRigs.forEach((rig) => {
          rig.strategy.setTransition(markState.from, markState.to, markState.progress);
          rig.strategy.update(reduceMotion ? 0 : elapsed);
          if (reduceMotion) return;
          rig.group.position.y =
            rig.basePosition.y + Math.sin(elapsed * FLOAT_SPEED) * FLOAT_AMPLITUDE;
        });
      }

      if (surfaceMap.repeat.x !== tuning.shardTextureRepeat) {
        surfaceMap.repeat.setScalar(tuning.shardTextureRepeat);
      }

      // ── The mark's arrival ──
      // It stays HIDDEN until the ship has flown out of frame, so the handoff shows only debris and
      // streaking stars. Then it travels in from far behind its spot — perspective grows it as it
      // nears, so it never reads as spawning — and fades up out of the far dark.
      //
      // Driven by the eased handoff progress rather than by a timer, so scrolling back recedes it into
      // the dark exactly as the ship flies back on. At 1 it is landed and the float block above owns it.
      const arrival = THREE.MathUtils.smoothstep(flightState.current, METEOR_ARRIVE_PROGRESS_START, 1);
      meteorArrival.value = arrival;
      const markVisible = arrival > METEOR_VISIBLE_EPSILON;
      // Same gate as the block above, and it has to be here too: the arrival keeps writing positions and
      // material opacities every frame, and on a mark that is out of the scene that is pure waste. It
      // also stops this branch quietly re-showing a group contact has taken away.
      if (!markPresent) {
        // nothing to arrive — the mark left with the works section
      } else if (arrival < 0.999) {
        const appear = THREE.MathUtils.smoothstep(arrival, 0, METEOR_APPEAR_FRACTION);
        markRigs.forEach((rig) => {
          rig.group.visible = markVisible;
          if (!markVisible) return;
          meteorArriveFrom.copy(rig.basePosition).add(METEOR_ARRIVE_OFFSET);
          rig.group.position.lerpVectors(meteorArriveFrom, rig.basePosition, arrival);
          rig.group.position.y += Math.sin(elapsed * FLOAT_SPEED) * FLOAT_AMPLITUDE * arrival;
          rig.materials.forEach((material) => { material.opacity = appear; });
        });
      } else {
        markRigs.forEach((rig) => {
          rig.group.visible = markVisible;
          rig.materials.forEach((material) => { material.opacity = 1; });
          rig.basePosition.set(tuning.markX, tuning.markY, tuning.markZ);
          rig.group.position.x = rig.basePosition.x;
          rig.group.position.z = rig.basePosition.z;
        });
      }
      // ── The reveal: back out of the display until the room is around you ──
      // Eased per frame off the scrubbed target, like every other crossing, so it stays cinematic
      // whether the user creeps, flicks, or the snap glides across it. Pure function of progress: it
      // can't be outrun, and it reverses.
      //
      // Eased HERE, above the camera, rather than beside the code that shows the room: the camera's
      // reveal pan reads this same number (see REVEAL_PAN_*), and easing it afterwards would pan on
      // last frame's value — a frame of lag between the star turning away and the room arriving.
      if (chamberState.engaged) {
        const smoothing = reduceMotion ? 1 : CHAMBER_SMOOTHING;
        chamberState.current += (chamberState.target - chamberState.current) * smoothing;
        if (Math.abs(chamberState.target - chamberState.current) < 0.001) {
          chamberState.current = chamberState.target;
        }
        // The reveal's own copy, eased at the same rate so the turn and the frame stay locked to the
        // room they arrived with — they simply do not follow it back out.
        chamberState.revealEased += (chamberState.reveal - chamberState.revealEased) * smoothing;
        if (Math.abs(chamberState.reveal - chamberState.revealEased) < 0.001) {
          chamberState.revealEased = chamberState.reveal;
        }
      }

      // ── Camera: fly the shared path during the handoff, else the normal focus-follow ──
      // Cleared here rather than in each branch that fails to set it: only the authored-path branch of
      // `updateCamera` has a rest pose to offer, and the handoff flight bypasses it entirely.
      // Resetting once, up front, means a new way of driving the camera cannot accidentally
      // inherit the last valid rest pose and drag the sun around with a stale one.
      restPoseValid = false;
      if (flightState.engaged) {
        // Ease at the same rate as the deck ship so the two cameras stay locked together.
        flightState.current +=
          (flightState.target - flightState.current) * (reduceMotion ? 1 : FLIGHT_CAMERA_SMOOTHING);
        if (Math.abs(flightState.target - flightState.current) < 0.001) {
          flightState.current = flightState.target;
        }

        // Same shared pose the deck reads, shifted so the field's origin (meteor 01) lands on the
        // shared meteor spot — so the ship (deck canvas) and this field composite as one space.
        computeFlightPose(flightState.current, flightPose);
        flightLookTarget.copy(flightPose.cameraTarget).sub(meteorOffset);
        camera.position.copy(flightPose.cameraPosition).sub(meteorOffset);
        // ── The portrait pull-back, ramped across the crossing ──
        // The flight's landing pose IS stop 0 (worksTuning's FLIGHT_LANDING_KEY says so, and says it
        // must never be hand-edited away from it). But `updateCamera` then multiplies that pose's
        // offset by `distanceScale`, and on a phone that is 1.9 — so the identity the seam depends on
        // held only on a landscape screen. The mark arrived filling the frame and shrank by nearly
        // half the moment browsing took the camera. Applying the same scale HERE, ramped to exactly 1
        // at progress 0 and exactly `distanceScale` at 1, makes both ends identities again and turns
        // the pop into part of the dolly.
        //
        // ⚠ The deck's own camera does the same thing off the same shared function. If you change one,
        // change both — they are one continuous space photographed by two renderers, and they only
        // composite because they agree on where the camera is.
        //
        // Scaled about the AIM POINT, never about the world origin: this pushes the camera away from
        // what it is looking at, which is the whole intent. Scaling the position would slide the shot.
        camera.position
          .sub(flightLookTarget)
          .multiplyScalar(flightPullbackScale(distanceScale, flightState.current))
          .add(flightLookTarget);
        camera.lookAt(flightLookTarget);
        if (Math.abs(camera.fov - flightPose.cameraFov) > 0.001) {
          camera.fov = flightPose.cameraFov;
          camera.updateProjectionMatrix();
        }

        // At either boundary the flight is over → hand back to focus-follow. At progress 1 the pose
        // is, by construction, exactly the resting framing of project 01, so browsing continues with
        // no jump; at 0 we're back at the fleet (field faded out).
        if (
          flightState.current === flightState.target &&
          (flightState.target === 0 || flightState.target === 1)
        ) {
          flightState.engaged = false;
        }
      } else {
        updateCamera(false);
      }

      // Warp intensity = the camera's speed this frame, normalised and smoothed. It rises as the hop
      // launches and falls as it arrives, so the streaks stretch + the FOV widens in lockstep.
      if (hasPreviousCameraPosition && !reduceMotion) {
        const cameraSpeed = camera.position.distanceTo(previousCameraPosition) / deltaSeconds;
        const warpTarget = THREE.MathUtils.clamp(cameraSpeed / WARP_REFERENCE_SPEED, 0, 1);
        warp += (warpTarget - warp) * WARP_SMOOTHING;
        if (cameraSpeed > 1e-4) {
          streakDirection.subVectors(camera.position, previousCameraPosition).normalize();
        }
      } else {
        warp = 0;
      }
      previousCameraPosition.copy(camera.position);
      hasPreviousCameraPosition = true;

      // ── The fall toward the black hole ──
      // Nothing actually moves in contact: the camera holds the angle it was left at and the hole sits
      // on the point that angle already aims through. The sense of falling is entirely the STAR TAILS —
      // the same streak uniforms the travel warp uses, held open at a constant instead of driven by
      // measured camera speed. It is the cheapest possible way to sell the ending, and it is honest
      // enough that nobody looks for the trick.
      //
      // Taken as a max against the warp rather than added: they are two expressions of one thing (how
      // fast the field is going past you), and summing them would let a hop into contact briefly streak
      // harder than either alone.
      const fallStrength = THREE.MathUtils.smoothstep(
        chamberState.contact,
        CONTACT_FALL_WINDOW[0],
        CONTACT_FALL_WINDOW[1],
      );
      if (fallStrength > warp) {
        // Falling the way we are looking, which is through the hole. `getWorldDirection` writes into the
        // scratch vector the warp already owns, so this allocates nothing.
        camera.getWorldDirection(streakDirection);
      }
      // The dive takes the tails past the contact section's steady fall and up to the warp's full
      // violence — taken as another `max` for the same reason the fall is: they are three expressions of
      // one thing (how fast the field is going past you), and summing them would stack.
      const streakStrength = Math.max(
        warp,
        fallStrength * CONTACT_FALL_STREAK_SCALE,
        diveProgress * DIVE_STREAK_SCALE,
      );
      starSystem.streakUniforms.uStreakLength.value = streakStrength * STREAK_MAX_LENGTH;
      starSystem.streakUniforms.uOpacity.value = streakStrength * STREAK_MAX_OPACITY;
      starSystem.streakUniforms.uStreakDir.value.copy(streakDirection);
      // The warp kick rides ON TOP of whatever FOV the current key authored — updateCamera has already
      // set the authored value this frame, so this only ever adds the punch of the hop. During the
      // flight the shared path owns the fov outright and neither applies.
      if (!flightState.engaged && warp > 0.001) {
        camera.fov = authoredFov() + warp * FOV_KICK;
        camera.updateProjectionMatrix();
      }

      // The contact star's idle spin and its rings' orbits. It no-ops entirely while the star is absent,
      // which is every frame outside the return and contact — so browsing projects pays one function
      // call and a boolean.
      singularity?.update(deltaSeconds, elapsed, camera);
      // ── The star's glow, and the supernova on top of it ──
      // This field blooms globally at a strength tuned for a starfield, which is nowhere near hot enough
      // to make a collapsed sun read. It cannot be fixed on the star alone: exposure and bloom here grade
      // the whole space. So the FIELD lifts its bloom while the star is present — and at contact the
      // frame is a star, a starfield and nothing else, so that lift is simply the section's grade.
      //
      // The flash then rides on the same two dials. Being global is the POINT here rather than a
      // compromise: a star detonating should wash out the whole frame, starfield included. In the hero's
      // canvas the same boost could only ever have lit the star's own 175px box.
      //
      // Written every frame rather than on the progress event, because both have to survive whatever
      // else touches the pass — and they are two float assignments.
      const restingBloom = lowPower ? BLOOM_STRENGTH_LOW : BLOOM_STRENGTH;
      bloomPass.strength = singularity?.bloomStrength(restingBloom) ?? restingBloom;
      renderer.toneMappingExposure =
        TONE_MAPPING_EXPOSURE + (singularity?.exposureBoost() ?? 0);

      // ── The lens ──
      // The scene decides what it should be (only it knows where the hole is and how far it has opened);
      // this owns the pass. Strength 0 disables it outright rather than running a pass-through, so the
      // full-screen cost exists only across the ~1s the hole is being born.
      const lens = singularity?.lensing();
      lensingPass.enabled = (lens?.strength ?? 0) > 0;
      if (lens && lensingPass.enabled) {
        const lensUniforms = lensingPass.uniforms;
        lensUniforms.uStrength.value = lens.strength;
        lensUniforms.uCenter.value.set(lens.centerX, lens.centerY);
        lensUniforms.uRadius.value = lens.radius;
        lensUniforms.uAberration.value = lens.aberration;
        lensUniforms.uLiquid.value = lens.liquid;
        lensUniforms.uRingStrength.value = lens.ring;
        lensUniforms.uShadow.value = lens.shadow;
        lensUniforms.uTime.value = lens.time;
        // Keeps the distortion circular instead of following the viewport's shape.
        lensUniforms.uAspect.value = viewportHeight > 0 ? viewportWidth / viewportHeight : 1;
      }

      // Deliberately AFTER the warp kick: the projection below uses `camera.fov`, and reading it before
      // this line would place the sun with one lens while the frame was drawn with another.
      publishSunParallax();

      // ── The instrument frame ──
      // Same placement reasoning as the sun above: everything it reports is read AFTER the camera is
      // final for the frame, so the lens it names is the lens the frame was drawn with.
      // The combined value: the frame arrives with the room AND leaves with it. It belongs to the
      // moment of the twist — it explains the screen you have just discovered — and once you dive back
      // in, that job is done. A camera frame standing over the finale would only compete with it.
      //
      // `roomProgressFrom` still applies, because the frame must not appear during the look-down: at
      // that point the display still fills the frustum and there are no edges to have noticed.
      const hudRevealProgress = roomProgressFrom(chamberState.current);
      hud.setOpacity(
        THREE.MathUtils.smoothstep(hudRevealProgress, HUD_FADE_WINDOW[0], HUD_FADE_WINDOW[1]),
      );
      hud.update({
        feedIndex: activeIndexRef.current + 1,
        feedTotal: fieldProjects.length,
        fovDegrees: camera.fov,
        panRadians: viewYaw,
        tiltRadians: viewPitch,
        slewing: travelActive,
        // Stop down, then reopen — see HUD_EXPOSURE_*. Both halves are smoothsteps on the same eased
        // progress, so the bump reverses exactly like everything else in the crossing.
        exposureStops:
          HUD_EXPOSURE_MAX_STOPS *
          THREE.MathUtils.smoothstep(
            hudRevealProgress,
            HUD_EXPOSURE_STOP_DOWN[0],
            HUD_EXPOSURE_STOP_DOWN[1],
          ) *
          (1 -
            THREE.MathUtils.smoothstep(
              hudRevealProgress,
              HUD_EXPOSURE_RECOVER[0],
              HUD_EXPOSURE_RECOVER[1],
            )),
      });

      // Skip the bloom pipeline whenever the field isn't on screen (and when the tab is
      // backgrounded). The loop above still ran, so state is current and the first visible frame is
      // already right.
      // The room reads the COMBINED value, so the return walks it back out again.
      const roomRaw = chamberState.engaged ? chamberState.current : 0;
      const revealProgress = roomProgressFrom(roomRaw);

      // Show the room only once it's actually in. Until then the screen pipeline keeps painting the
      // full-bleed quad — which is exactly what the chamber would be showing at progress 0 anyway, so
      // a slow model load degrades to "the reveal hasn't started yet" rather than to a black frame.
      // This is also what makes the look-down beat free: through the lead-in the room is not drawn at
      // all, because as far as the chamber is concerned the reveal has not started.
      const revealing =
        !!chamber && chamberReady && revealProgress > CHAMBER_ENGAGE_EPSILON;

      const handoffActive = flightState.current > 0.001 && flightState.current < 0.999;
      // Measured on the RAW progress, not the room's, so the adaptive controller stays frozen through
      // the look-down too. It reads the lead-in as "the reveal hasn't begun" and would otherwise be
      // free to reallocate the composer mid-camera-move, which is a visible resolution jump.
      const revealScrubbing =
        chamberState.engaged && roomRaw > CHAMBER_ENGAGE_EPSILON && roomRaw < CHAMBER_SCRUB_END;

      const isDrawing = worksShouldRender && !document.hidden;

      // ── Stop paying the compositor for a canvas nobody can see ──
      // `worksShouldRender` is the section's own gate — false through the hero and the whole fleet,
      // where this canvas is `opacity: 0` and therefore still being composited at full size for
      // nothing. It goes true early in the handoff, before the field is needed. `document.hidden` is
      // deliberately excluded: a backgrounded tab composites nothing anyway. See `.is-uncomposited`.
      const shouldUncomposite = !worksShouldRender;
      if (shouldUncomposite !== canvasUncomposited) {
        canvasUncomposited = shouldUncomposite;
        canvas.classList.toggle('is-uncomposited', shouldUncomposite);
      }

      // ── ⚠ THE FAQ PANEL IS HIDDEN ON EVERY FRAME, NOT ONLY ON DRAWN ONES ──
      // The panel is DOM (see lib/hologramPose.ts) so it goes on being composited whether or not this
      // canvas draws, and its pose is a stale-until-told store — the room's `update` is the only thing
      // that publishes one, and nothing infers "gone" from a pose that simply stopped arriving.
      //
      // This used to live inside the draw block, in the branch that decides the panel has no room to be
      // anchored in. Correct for browsing projects; wrong for LEAVING. The moment the pin is somewhere
      // this field does not render, `isDrawing` goes false and that branch stops being reached at all —
      // so the last pose stands and the panel hangs there, fully lit, over whatever is on screen. It was
      // photographed sitting over the CREAM HERO, beside the wordmark, after a window resize threw the
      // pin back to the top.
      //
      // Hoisted here so there is ONE writer and it runs unconditionally. `revealing` is the honest
      // question ("is a room being drawn"); `isDrawing` is the other half ("is anything being drawn"),
      // and neither implies the other.
      if (!revealing || !isDrawing) hideHologram();
      // Hoisted out of the draw block because the resolution controller below has to know whether this
      // frame did the full job before it decides whether the NEXT one's timing means anything.
      let spaceRenderedThisFrame = true;
      if (isDrawing) {
        // Geometry AA follows the room, because the room is the only thing stage 2 ever draws that has
        // geometry. Toggling `enabled` is all this needs: EffectComposer recomputes which pass is the
        // last ENABLED one on every render, so `OutputPass` takes over drawing to the canvas by itself
        // whenever this is off. See the note where the pass is built.
        smaaPass.enabled = revealing;

        // Stage 1 into the texture, stage 2 out to the canvas. Stage 2 runs every frame without
        // exception; stage 1 may stride once the room is established, because the screen pipeline
        // paints whatever the space pipeline LAST produced and the composer's read buffer is still
        // holding it. See CHAMBER_SPACE_STRIDE_MAX for why that is safe here and nowhere else.
        const spaceStride = revealing && chamberState.contact <= CROSSING_IDLE_EPSILON
          ? 1 + Math.round(
              CHAMBER_SPACE_STRIDE_MAX *
                THREE.MathUtils.smoothstep(
                  revealProgress,
                  CHAMBER_SPACE_STRIDE_WINDOW[0],
                  CHAMBER_SPACE_STRIDE_WINDOW[1],
                ),
            )
          : 1;
        const spaceDue = framesSinceSpaceRender >= spaceStride - 1;
        spaceRenderedThisFrame = spaceDue;
        if (spaceDue) {
          framesSinceSpaceRender = 0;
          profileMeasure('works · space', () => spaceComposer.render(), true);
        } else {
          framesSinceSpaceRender += 1;
        }
        const space = spaceTexture();

        if (revealing && chamber) {
          // The room, with the space showing on its display. Same texture, same shader as the
          // full-bleed quad — only the geometry it's painted on has changed.
          chamber.setSpaceTexture(space);
          chamber.update(revealProgress, viewportWidth, viewportHeight);
          screenRenderPass.scene = chamber.scene;
          screenRenderPass.camera = chamber.camera;
        } else {
          presentUniforms.uSpace.value = space;
          screenRenderPass.scene = presentScene;
          screenRenderPass.camera = presentCamera;
          // Browsing projects, not standing in a room — so there is no room for the FAQ panel to be
          // anchored in. `hideHologram()` for this case is no longer here: it is hoisted above the draw
          // block, because this branch cannot be reached on a frame that does not draw and "the panel
          // must go away" is exactly what those frames need to say. One writer, see it there.
        }
        profileMeasure('works · screen', () => screenComposer.render(), true);

        // Gauges, not spans: the latest reading, so the breakdown carries what the frame was actually
        // asked to draw. Draw-call count is the first thing to look at when `unaccounted` is large and
        // the spans are small — submission is cheap, but a few thousand calls is not.
        //
        // ⚠ Read AFTER both composers and with `autoReset` off (see the loop's head). three resets
        // `info` at the start of every `render()` by default, and this scene calls render twice per
        // frame through two composers with many internal passes — so the first cut of this printed
        // `works draws 1.00`, which is the final fullscreen quad and nothing else.
        profileGauge('ratio', renderer.getPixelRatio());
        // How hard each stage is running. `space stride` above 1 means the room is decimating its
        // display's feed — expect it to read 1 everywhere except standing in the chamber.
        profileGauge('space stride', spaceStride);
        // Cross-check: this must now track the `[frame]` headline. It did not before — the controller
        // read a clamped delta and believed 20+ fps while the page ran at 9.
        profileGauge('fps(ctrl)', getControllerFps());
        profileGauge('works draws', renderer.info.render.calls);
        profileGauge('works tris', renderer.info.render.triangles);
      }

      // ── Adaptive resolution: only ever re-sized while this scene is NOT being drawn ──
      // Same rule as the deck (see useServicesDeck). Applying a new pixel ratio reallocates the whole
      // composer (bloom pyramid + SMAA buffers) and blocks for a frame or more. It must NOT be hidden
      // behind motion: the warp hop between two meteors is a real-time tween, so a stall mid-hop makes
      // the camera skip straight to the far end — the hop reads as a freeze then a jump. So we only
      // ever do it on a genuinely idle frame: the field off screen (services / the fill) or the tab
      // backgrounded. Also frozen entirely through either crossing.
      // Hoisted out of the ratio branch below only so it reads beside the size block, which asks a
      // deliberately DIFFERENT question — see there. This one is the RATIO's freeze and is unchanged.
      //
      // ⚠ THE HOP. `travelActive` is the real-time GSAP tween that moves the camera between two
      // projects, and it is the exact hazard the ratio branch's header describes: a stall mid-hop lets
      // the tween advance behind it, so the camera skips to the far end and the hop reads as a freeze
      // then a jump. It is NOT covered by `handoffActive` or `revealScrubbing` — those are the two
      // crossings — so a forced apply would have landed straight in it.
      const scrubbing =
        travelActive ||
        (chamberState.contact > CROSSING_IDLE_EPSILON &&
          chamberState.contact < 1 - CROSSING_IDLE_EPSILON) ||
        diveProgress > CROSSING_IDLE_EPSILON;

      // ── ⚠ THE CANVAS'S OWN SIZE: THE DRAG IS THE ONLY THING IT WAITS FOR ─────────────────────
      //
      // ⚠ A SIZE CHANGE AND A RATIO CHANGE ARE NOT THE SAME WAITING PROBLEM, and treating them alike
      // cost two revisions. A queued RATIO makes the frame softer or sharper — waiting is free, and
      // the ratio still waits below. A queued SIZE leaves `camera.aspect` disagreeing with the box the
      // final quad is blitted into, so everything on screen is visibly STRETCHED for as long as it
      // waits. Never worth it for more than a frame.
      //
      // The first cut froze this through every crossing, copied from the ratio, and the craft flew a
      // whole handoff distorted. The second cut kept the freeze only for real-time tweens
      // (`travelActive`) on the argument that a stall desyncs motion — and a stretch still showed on
      // the section crossings. The rule is simpler than either: the drag is the only thing worth
      // waiting for, because it is the only thing that would make us re-allocate again next frame.
      //
      // A one-frame stall inside a 0.6 s camera hop nudges the tween by ~30 ms, which is not visible.
      // A stretched image for the length of that hop is. There is no version of this trade where the
      // distortion is the better half, so there is no exception list any more.
      //
      // Deliberately NOT gated on `RATIO_APPLY_GRACE_SECONDS` either: that grace exists so a
      // controller that keeps changing its mind cannot thrash the buffers, and a window that has
      // finished moving is not going to change its mind. Waiting 1.5 s would just be 1.5 s of stretch.
      if (canvasSizeDirty) {
        const stretched = canvasStretch() > MAX_DEFERRED_STRETCH;
        if (!isDrawing || stretched || isViewportSettled()) {
          applyRendererSize();
          canvasSizeDirty = false;
          ratioPendingSeconds = 0;
        }
      }

      if (!handoffActive && !revealScrubbing) {
        // ── The one optional extra, on a frame nobody is watching ──
        //
        // ⚠ THIS IS THE FALLBACK PATH NOW, not the usual one. `raiseMsaaIfEarned` is called from the
        // burn-in, behind the veil, where the reallocation costs a frame nobody will ever see. It can
        // still only be reached from here on a load where the burn-in never ran or refused — in which
        // case `hasEarnedExtraQuality` is back to meaning what it always meant: 50 fps held at full
        // resolution for four seconds, and a `dispose()` of two composer targets in front of somebody.
        // That is the right trade when there is no measurement, and the wrong one when there is.
        if (!isDrawing) raiseMsaaIfEarned();

        const targetRatio = getPixelRatio();
        if (targetRatio === appliedPixelRatio) {
          ratioPendingSeconds = 0;
          // In sync → measure this frame. Only frames we actually DREW, so idle frames can't fake
          // headroom and trick the controller into ramping the resolution up.
          // ⚠ RAW, not `deltaSeconds`. This loop clamps at MAX_FRAME_SECONDS (0.05 s = 20 fps) so a
          // tab-restore cannot fling the animation — and feeding that clamp to the controller meant it
          // could not see this section running below 20 fps, which is where it spends its whole time
          // on the machines this exists for. See `FrameTimer.lastRawDelta`.
          //
          // ⚠ …and only frames whose PREVIOUS frame did the full job. `lastRawDelta` measures the frame
          // before this one, so once the chamber's space stride engages, two frames in three are cheap
          // by construction and would read as headroom the site does not have. Both consumers latch on
          // that and neither ever un-latches — see `spaceRenderedLastFrame`.
          if (isDrawing && spaceRenderedLastFrame) sampleFrame(frameTimer.lastRawDelta(), 'works');
        } else {
          // Queued. Sampling deliberately stops here — measuring at one ratio while the controller
          // believes it is at another feeds it a lie.
          ratioPendingSeconds += deltaSeconds;
          // ⚠ The `||` half is what stops this waiting for an idle frame that never comes. This scene
          // draws works, the chamber AND contact without a break, so its only idle frame is the
          // teleport — see RATIO_APPLY_GRACE_SECONDS for the whole failure. The crossings are already
          // excluded by the enclosing guard, and the two spans it does NOT cover are added by
          // `scrubbing` (hoisted above), so the hitch can only ever land on a stop being browsed at rest.
          if (!isDrawing || (!scrubbing && ratioPendingSeconds >= RATIO_APPLY_GRACE_SECONDS)) {
            applyRendererSize();
            canvasSizeDirty = false;
            ratioPendingSeconds = 0;
          }
        }
      }

      // Last, so the controller above reads the PREVIOUS frame's answer rather than this one's. Only
      // updated on frames we drew: an undrawn frame's timing is already excluded from sampling, and
      // letting it write here would make the first frame back look like it followed a full one.
      if (isDrawing) spaceRenderedLastFrame = spaceRenderedThisFrame;

      profileSpan('works · loop', profileNow() - loopStartedAt);
    };
    renderFrame();

    // ── Resize ──
    // ⚠ THE OBSERVER MARKS, THE LOOP APPLIES. It used to call `applyRendererSize` directly, which
    // walked straight past every guard the twenty lines above it are made of: a resize mid-crossing
    // re-allocated both composers inside a scrubbed flight — the exact "visible jump" that
    // `RATIO_APPLY_GRACE_SECONDS` exists to prevent — and a window drag did it once a frame for the
    // length of the drag. See MAX_DEFERRED_STRETCH for what the waiting costs and why it is worth it.
    applyRendererSize();
    const stopReframeWatch = startViewportReframeWatch();
    const resizeObserver = new ResizeObserver(() => {
      canvasSizeDirty = true;
    });
    resizeObserver.observe(canvas.parentElement ?? canvas);

    // No authoring surface: every value this scene runs on is a constant in `worksTuning.ts` and
    // `ACCRETION_TUNING`, edited in the file like any other. The panel that used to author them —
    // along with its free-fly camera and its mark rebuild — is in git if it is ever wanted back.

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      stopReframeWatch();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener(HANDOFF_PROGRESS_EVENT, onHandoffProgress);
      window.removeEventListener(CHAMBER_PROGRESS_EVENT, onChamberProgress);
      window.removeEventListener(BURN_IN_EVENT, onBurnInRequested);
      window.removeEventListener(CONTACT_PROGRESS_EVENT, onContactProgress);
      // ⚠ Only the snap, deliberately. `LOOP_PROGRESS_EVENT` and `LOOP_RESET_EVENT` have never been
      // removed here, and adding removals for them alongside this one was reverted: they are not this
      // change's business, this effect is long and its teardown ordering is load-bearing, and altering
      // the lifecycle of two working listeners to tidy up while chasing a bug is how a second bug gets
      // introduced. If the leak is worth closing it is worth closing on its own.
      window.removeEventListener(LOOP_SNAP_EVENT, onLoopSnap);
      traceBuild('effect: TEARDOWN — disposed is now true for this run');
      window.removeEventListener(ASSETS_WARMUP_EVENT, onWarmupRequested);
      stopPreflightWatch?.();
      cancelAnimationFrame(warmupFrame);
      cancelAnimationFrame(lazyWarmupFrame);
      chamber?.dispose();
      singularity?.dispose();
      hud.dispose();
      // The sun outlives this field, so it must not be left holding the last offset we published.
      clearSunParallaxPose();

      // The strategy owns every geometry, material and texture it built, so this one call frees the
      // whole mark — including the two surfaces it loaded for itself.
      markRigs.forEach((rig) => rig.strategy.dispose());
      markRigs.length = 0;
      shardGeometries.forEach((geometry) => geometry.dispose());
      shardMaterials.forEach((material) => material.dispose());
      shardMeshes = [];
      disposableTextures.forEach((texture) => texture.dispose());
      gsap.killTweensOf(travel);
      markTween?.kill();
      starSystem.dispose();
      pmremGenerator.dispose();
      scene.environment?.dispose();
      presentGeometry.dispose();
      presentMaterial.dispose();
      // EffectComposer.dispose() doesn't free added passes — release the bloom pyramid explicitly.
      // Each composer owns (and disposes) both of its read/write targets, so the buffers handed to
      // them — and the clones they made — are freed with them.
      bloomPass.dispose();
      lensingPass.dispose();
      smaaPass.dispose();
      spaceComposer.dispose();
      screenComposer.dispose();
      renderer.dispose();
    };
    // Setup runs once; focus changes are read live via activeIndexRef / the selection effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to focus changes: re-stage the existing scene (fly camera, ignite/cool).
  useEffect(() => {
    setFocusRef.current(activeIndex);
  }, [activeIndex]);
}
