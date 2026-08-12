'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { detectKtx2Support, getSharedDracoLoader, getSharedKtx2Loader } from '@/lib/modelLoading';
import { createFrameTimer } from '@/lib/frameTimer';
import { profileGauge, profileMeasure, profileNow, profileSpan } from '@/lib/frameProfiler';
import { telemetryEnabled } from '@/lib/telemetryEnabled';
import {
  getSunPixelRatio,
  RATIO_APPLY_GRACE_SECONDS,
} from '@/lib/adaptivePixelRatio';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  REVEAL_EVENT,
  INTRO_ACTIVE_EVENT,
  SUN_DRAW_PERMIT_EVENT,
  SUN_ASSEMBLE_EVENT,
  SUN_ASSEMBLED_EVENT,
  SUN_FORMING_EVENT,
  INTRO_MARKER_SELECTOR,
} from '@/components/effects/IntroSequence/introEvents';
import {
  SUN_FRAMING_NUDGE_X,
  SUN_CANVAS_HEADROOM,
} from '@/components/effects/IntroSequence/gatherShader';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { VECTOR_DEG_PER_SECOND } from './HeroInstruments/heroReadouts';
import { HANDOFF_PROGRESS_EVENT, readHandoffProgress } from '@/lib/handoffEvents';
import {
  HERO_SERVICES_PROGRESS_EVENT,
  readHeroServicesProgress,
} from '@/lib/heroServicesEvents';
import {
  createSunBloom,
  BLOOM_STRENGTH,
  BLOOM_RADIUS,
  BLOOM_THRESHOLD,
} from './sunBloom';
import { BLACK_STAGE_EVENT, readBlackStageActive } from '@/lib/blackStageEvent';
import { CHAMBER_PROGRESS_EVENT, readChamberProgress } from '@/lib/chamberEvents';
import { LOOP_RESET_EVENT, SUN_REGATHER_EVENT } from '@/lib/loopEvents';
import { createSunParticles } from '@/lib/sunParticles';
import { createSunPlasma, type SunPlasma } from './sunPlasma';
import { SUN_OMITTED_PARTS, isOmittedSunPart } from './sunParts';
import { warmSceneMaterials } from '@/lib/warmScene';
import { SLATE_400 } from '@/lib/coolPalette';
import {
  reportAssetProgress,
  reportWarmupDone,
  reportSourceActivity,
} from '@/lib/assetLoadProgress';

// The shared sun — the real fractured_sun model, replacing the procedural plasma shader.
//
// The star has four authored stages, and they are the site's spine (peaceful → cracks → collapse →
// singularity). The numbers below are the Peaceful one. They came out of a model editor that has since
// been deleted, so this file is now their only copy — there is nothing left to keep them in step with.
//
// It also ASSEMBLES, and that assembly is the loader's finale: when the load hits 100% the ten fracture
// shards sweep in from outside the frame and lock together, the star lights inside the closing shell, and
// only then does the intro hand over. See the assembly section below.

const MODEL_PATH = '/models/fractured_sun.glb';

// ── The "Peaceful" stage ──
const MODEL_ROTATION = { x: 5, y: 106, z: -59 };
// Imported, NOT copied: the hero HUD's "orbital vector" readout displays this exact rate so the
// telemetry reads as synced to the sun. Hard-coding the authored 16 deg/s here would spin the sun 2.6x
// faster than the number on screen claims. One source of truth, so they cannot drift.
const AUTO_ROTATE_DEGREES_PER_SECOND = VECTOR_DEG_PER_SECOND;
const FLARE_SPIN_DEGREES_PER_SECOND = 15;
/**
 * The magma's glow.
 *
 * This was raised to compensate for having no bloom pass — that reason is now GONE (see `sunBloom`),
 * so the hero sun is running a Cracks-level emissive through a bloom it was tuned without. If the
 * calm hero star reads too hot, this is the first number to pull down: the Peaceful stage
 * leaves magma at the model's own default and lets bloom do the work, and 2.4 is the value its
 * CRACKS stage authors.
 */
const MAGMA_EMISSIVE = 2.4;
const EXPOSURE = 1.42;
const ENV_INTENSITY = 1.77;
const KEY_COLOR = 0xfff4e0;
const KEY_INTENSITY = 2.7;
/** The shared cool fill — the same sky the fleet and the works field are lit by. */
const FILL_COLOR = SLATE_400;
const FILL_INTENSITY = 0.5;
const AMBIENT_INTENSITY = 0.25;
const CAMERA_FOV = 45;
/**
 * How far back the camera sits, as a multiple of the distance that would exactly fit the model's
 * bounding sphere. **This is the sun's size dial, and lower means bigger** — apparent size is inversely
 * proportional to distance, so halving this doubles the sun.
 *
 * Done with the camera rather than CSS on purpose: the canvas fills `.hero-sun-flight`, and the intro
 * measures that element to fly the sun into the "o" and the hero square. Resizing the element would
 * desync the landing; moving the camera changes nothing outside this file.
 *
 * Note the bounding sphere includes the flares and planes that stick well out past the sun's body, so
 * base values below ~0.6 start cropping those outer elements before they touch the body itself.
 *
 * The `× SUN_CANVAS_HEADROOM` is NOT a size change. `HeroSun` grows the canvas by that same factor
 * to give the bloom and the ring room to fade out, so the camera has to pull back by it or the sun
 * would simply render bigger and fill the new space it was given. Change one, change both — they are
 * the same number for exactly this reason.
 */
const CAMERA_FIT_MARGIN = 0.575 * SUN_CANVAS_HEADROOM;

const MAX_DEVICE_PIXEL_RATIO = 2;

/**
 * The star's resolution — the SHARED adaptive one, capped by this canvas's own limit.
 *
 * ── ⚠ Why it stopped being `min(devicePixelRatio, 2)` ────────────────────────────────────────────
 * It was the only heavy renderer on the page not answering to `adaptivePixelRatio`, and on a dpr 2.5
 * laptop that meant the star drew at **2.0 with MSAA while the works field beside it drew at 1.01** —
 * roughly four times the pixel density of the scene it sits in front of. The frame profiler found it
 * costing 10–21 ms, the largest measured span on the page during works, against a cost table in
 * CLAUDE.md that rates the sun BELOW the fleet.
 *
 * Two renderers arguing about how expensive the machine is cannot both be right, and the one that has
 * actually measured something should win.
 *
 * ── ⚠ AND IT NOW HAS ITS OWN NUMBER AGAIN — WHICH IS NOT A RETURN TO THE ABOVE ──────────────────
 * `reportSectionCosts` gives the star a ratio of its own, but the reasoning that took the old one away
 * is untouched: what was wrong with `min(devicePixelRatio, 2)` was that it had measured NOTHING while
 * the renderer beside it had. The new number is the remainder of a 30 fps frame after the section's
 * models have taken theirs, solved from a measurement of this canvas's own marginal cost (the burn-in
 * draws one phase with this canvas dark and one with it lit, and the difference is us).
 *
 * The star is still not allowed to out-vote the field about how fast the machine is. It is allowed to
 * spend what the field did not need.
 *
 * ⚠ The cap stays. `getSunPixelRatio()` clamps to the same `MAX_PIXEL_RATIO` of 2 that this constant
 * names, so the two cannot drift; it is kept here because `particleFrameExtent` and the camera fit are
 * reasoned about in terms of it.
 */
const sunPixelRatio = () => Math.min(getSunPixelRatio(), MAX_DEVICE_PIXEL_RATIO);
const MAX_FRAME_SECONDS = 0.05;

// ── How often the star is actually drawn ─────────────────────────────────────────────────────────
/**
 * Frames between draws while nothing is CHOREOGRAPHED **and a black scene owns the page**.
 *
 * ⚠ THE BLACK-STAGE HALF IS THE POINT, not a refinement of it. This is per-section budgeting, and the
 * sections differ in what the star IS:
 *
 *   hero      the star is the subject, at full size, and NOTHING else on the page is drawing.
 *             There is no contention to resolve, so striding here would buy nothing and cost the one
 *             screen where the star has to be perfect. Full rate.
 *   services  behind the fleet at z-index −1, with the deck's own renderer wanting the frame.
 *   works     behind the marks, with the heaviest scene on the site wanting the frame.
 *             `AUTO_ROTATE_DEGREES_PER_SECOND` is 11 — 0.37° of turn in a 30 fps frame, on a
 *             background object. It cannot be seen; the fleet and the marks in front of it can.
 *   chamber   already frozen outright by `covered`. This never reaches it.
 *
 * `preserveDrawingBuffer` (see the renderer) is what makes a skipped frame keep compositing the last
 * image rather than showing an undefined one — the mechanism this rides on already existed for the
 * demand-render gate.
 */
const SUN_IDLE_STRIDE = 2;
/**
 * Drawn frames between refreshes of the bloom's SOURCE (sunBloom steps 1–3).
 *
 * Counted in DRAWN frames, not in loop frames, so it composes with the stride above instead of
 * multiplying against it in some way nobody could predict from either constant alone. Gated on the
 * black stage for the same reason and by the same rule.
 */
const SUN_GLOW_STRIDE = 2;

// ── DIAGNOSTIC: which parts of the star are allowed to draw ──────────────────────────────────────
/**
 * The star's cost is not its model and not its textures — it is a stack of double-sided, alpha-blended
 * meshes. `fractured_sun.glb` holds four groups, and the instance counts are what matter — the file
 * has 36 meshes across 76 NODES, so several are instanced many times:
 *
 *     sunouter    11 instances   transparent shells, α 0.82, 2.00 across   ← the ATMOSPHERE
 *     blowout     20 instances   small planes, 0.55×0.62×0.10              ← blown-out hot spots
 *     flare        8 instances   flat discs, 0.86×0.86×0.14, spun per frame ← the radiating discs
 *     sun_inner / magma          opaque — the 1.93 core and the ten shard cells
 *
 * ── ⚠ THE COST IS PER DRAW CALL, NOT PER PIXEL, AND THAT WAS A SURPRISE ──────────────────────────
 * Measured on a dpr 1.1 desktop at 144 fps, `sun · bloom` per call, by hiding one group at a time:
 *
 *     all                2.00 ms      —
 *     −flare             1.65 ms      −0.35 over 16 draws   = 0.0219 ms/draw
 *     −flare −blowout    0.87 ms      −0.78 over 40 draws   = 0.0195 ms/draw
 *     shells 11 → 3      1.65 ms      −0.35 over 16 draws   = 0.0219 ms/draw
 *
 * Three groups with completely different geometry, the same cost per draw to within 10 %. Projected
 * AREA predicts none of it: `blowout` and `flare` cover near-identical area and differ 2.2× in cost,
 * while the shells cover 4× the area of `flare` for the same cost. `sun · bloom` wraps
 * `bloom.render` in wall clock, so what it measures is CPU submission — and every mesh is submitted
 * twice, because `sunBloom` renders the scene twice per drawn frame.
 *
 * ⚠ On the dpr 2.5 laptop the same call costs 16–19 ms and the bottleneck there is GPU fill, not
 * submission. Different machine, different limit — but fewer meshes wins in both, which is the whole
 * reason this list exists rather than a resolution knob.
 *
 * ── Why `sunouter` is NOT in the list ──
 * It is the sun's ATMOSPHERE. The core is an opaque ball; those eleven layered translucent shells over
 * it are what make it read as burning rather than as a rock. They are also the thing a procedural
 * plasma shader would REPLACE — one animated surface instead of eleven static ones — so they should be
 * superseded, never simply deleted. `SUN_ABLATION_KEEP_SHELLS` stays for measuring that, at 0.
 *
 * ⚠ HIDING IS NOT REMOVING. This buys frame time only; the geometry and its textures are still
 * downloaded. Reclaiming those means rebuilding the GLB, which changes the mesh table `compareModels`
 * asserts on — a separate, deliberate pass.
 */
// ⚠ The list itself lives in `sunParts.ts`, shared with `Contact/singularityScene`. There are two
// stars built from this model and CLAUDE.md requires them not to drift; a copy here is how the star
// at contact would have kept its flares and its eleven shells after the hero star lost them.
/** DIAGNOSTIC. Keep only the N LARGEST `sunouter` shells. 0 = keep all, and that is the shipping value. */
const SUN_ABLATION_KEEP_SHELLS = 0;

/**
 * What the ablation is doing, for the console capture.
 *
 * ⚠ Built from the values, with no `=== 0` anywhere. The first cut compared both constants against 0
 * to decide the word "all" — and a find-and-replace of `0` → `3` while setting up a run caught the
 * comparison too, so a `shells:3` capture reported itself as `all`. The ablation had run correctly; the
 * label lied about it. A diagnostic that can disagree with what it measured is worse than none.
 */
const SUN_ABLATION_LABEL =
  [
    ...SUN_OMITTED_PARTS.map((name) => `-${name}`),
    SUN_ABLATION_KEEP_SHELLS > 0 ? `shells:${SUN_ABLATION_KEEP_SHELLS}` : '',
  ]
    .filter(Boolean)
    .join(' ') || 'all';

// ── Assembly ──
// The shards do not just slide outward — they arrive from deep space: scattered far behind the sun in
// CAMERA depth, tumbling, drifting, and settling into place as assets land.
//
// All distances are in units of the assembly's own radius (~0.78 model units, ~0.78 sun radii), so the
// effect scales with the model.
//
// REGISTERED TO THE LOADER'S DUST. The gather field streams matter from 22 to 54 sun radii out (see
// DEPTH_NEAR/DEPTH_FAR in gatherShader.ts) through a camera with the same framing as this one. These
// numbers put the shards in the NEAR HALF of that band — roughly 18 to 34 sun radii — so they read as
// the last and largest pieces of the same flow rather than a second effect arriving on its own.
/** How far back along the camera's view axis the parts start. This is what makes them read as distant. */
const ASSEMBLY_DEPTH = 23;
/** Extra depth variation, so they are not all on one plane. */
const ASSEMBLY_DEPTH_SPREAD = 20;
/**
 * How far out the shards wait, as a multiple of the frame's own half-height at their depth.
 *
 * ⚠ These were 1.45 / 2.6 — deliberately OUTSIDE the frame, on the reasoning that "you never catch a
 * piece appearing, it is simply already sweeping in when it crosses the edge". That was a good idea for
 * a fast load and the wrong one for a slow one: it meant the ten shards spent the entire download
 * clipped off-screen, so the loader had nothing on it but dust, and the star arrived from nowhere at
 * the very end.
 *
 * They now WAIT IN FRAME, drifting and turning among the dust (see `driftShards`) — the largest pieces
 * of the same flow, visibly present for as long as the load takes. The band still straddles the edge:
 * the near ones sit comfortably inside it, the far ones hang just past the corner and swim in and out.
 *
 * The cost of this is real and worth naming: a piece is no longer hidden until it is moving, so the
 * flight begins from something the visitor has already been looking at. That is the trade — the star
 * assembling out of debris you have been watching, instead of out of nothing.
 */
const ASSEMBLY_ENTRY_MARGIN_MIN = 0.55;
/**
 * The furthest out any shard waits. Spreading the margin across a range staggers the entries — the
 * nearest piece is well inside the frame, the furthest is past its corner — instead of ten pieces
 * sitting on one ring.
 */
const ASSEMBLY_ENTRY_MARGIN_MAX = 1.35;

/**
 * When the star itself appears, as a fraction of the assembly.
 *
 * Only the ten cells are shards. The core sphere, the outer glow, the flares and the twenty corona planes
 * all live under `Sketchfab_model` and sit at home permanently — so without this the glowing sun is
 * already there for the whole download and the shards merely arrive AROUND it, which is the opposite of
 * the story. They scale up from nothing instead, so the star lights inside the closing shell.
 */
const CORONA_APPEAR = 0.55;
/** A little of the original radial push, so they still read as pieces of one sphere coming apart. */
const ASSEMBLY_SPREAD = 1.4;
/** Drift amplitude while they are still travelling — the "floating" part. Fades to 0 as they land. */
const ASSEMBLY_FLOAT = 0.55;
const ASSEMBLY_FLOAT_SPEED = 0.55;
/**
 * How fast a waiting shard turns on its own axis, in degrees per second.
 *
 * The drift above moves them through space; this turns them. Without it the pieces held one fixed
 * orientation for the whole wait and read as painted on rather than as floating — the tumble
 * quaternion is a START pose, and slerping it toward home by an `arrival` that is still 0 leaves it
 * exactly where it began.
 *
 * Slow, and each piece gets its own axis and its own rate (scaled by its phase), because ten rocks
 * turning at one speed is a carousel. Faded out as the assembly takes over — a piece that is docking
 * has to be settling into its true orientation, not still spinning.
 */
const IDLE_TUMBLE_DEGREES_PER_SECOND = 11;
/** Slow orbit of the whole waiting field about the star, so the group circles rather than just bobbing. */
const IDLE_ORBIT_DEGREES_PER_SECOND = 4;
/**
 * How much hotter the magma runs while the pieces are still falling in, as a multiple of its resting
 * emissive. Infalling matter is hot and cools as it settles — but the real job is legibility: at the far
 * end of the flight a shard is a ~10px chip of unlit basalt on a black veil, under a field of bright
 * dust. Without this the early travel is invisible no matter how well it is paced.
 */
const ASSEMBLY_HEAT = 2.5;
/**
 * Seconds the parts take to fly in, as a ONE-SHOT.
 *
 * It is deliberately NOT driven by asset progress. That was the first attempt and it made the assembly
 * invisible: on a warm reload progress is already 1, so the shards were 99% home within a second and the
 * sun just sat there fully formed. The dust field is the progress meter; the sun forming is a reveal, and
 * a reveal needs a duration of its own or it is never actually seen.
 *
 * Sized to the intro's own beat: the cue lands ~0.7s in and the pre-handoff hold starts ~3.3s in, so this
 * finishes with the sun sitting formed and still in the "o" for a moment before the flight out.
 */
const ASSEMBLY_SECONDS = 2.2;
/** If the hero reveals while parts are still inbound, hurry them rather than snapping them into place. */
const ASSEMBLY_REVEAL_SPEEDUP = 3;
/**
 * When to start on our own if no cue ever arrives — measured from THE MODEL LANDING, not page load.
 *
 * Only a backstop for an intro that never reaches its gate. It has to sit past the intro's LAST possible
 * cue or the two race: losing that race starts the shard flight in the middle of a compile, which is the
 * exact freeze the serial gate exists to prevent.
 *
 * ⚠ It used to be measured from page load (18500), derived by adding up the gate's three serial caps —
 * 12s to give up on assets + 3.5s for the warm-up + 1s of lead. That arithmetic could not survive the
 * gate it described. The intro now waits on the star for as long as the star keeps arriving instead of
 * giving up on a deadline, so its "last possible cue" is a function of the visitor's BANDWIDTH and has
 * no upper bound at all — at 20 KB/s the star lands around 78s, and any fixed number from page load is
 * either far too small or an arbitrary guess at how slow a connection can get.
 *
 * Measured from the landing, the question becomes local and answerable: the model is here, so the only
 * thing still owed is the intro's remaining gate — WARMUP_WAIT_MAX_MS (3.5s) plus ASSEMBLY_LEAD_MS (1s).
 * This sits past that with room to spare, and it no longer has to be revised when anything upstream of
 * the download changes. Before the model lands there is nothing to assemble, so there is nothing for
 * this to be late for.
 *
 * The normal no-intro case is handled immediately by INTRO_MARKER_SELECTOR instead of by waiting this out.
 */
const ASSEMBLE_CUE_FALLBACK_MS = 8000;

// ── The hero → services state ramp ──
// What carries the sun from Peaceful into Cracks. It is a pure function of SCROLL (the pin's
// HERO_SERVICES_PROGRESS_EVENT), which is the whole point: the star comes apart under your finger as
// the void closes over the page, and scrolling back closes it again, exactly.
//
// It used to be a boolean — DECK_REVEAL_EVENT flipped a target to 1 and a per-frame chase ran after
// it — and that was wrong three separate ways. It fired at a THRESHOLD, so the square filled for
// 120vh with a completely peaceful star and the change then played out unconnected to the scroll. It
// eased `× 0.05` per FRAME, so the whole thing ran ~2.4× faster on a 144Hz display than on a 60Hz one.
// And an exponential chase spends its life in the tail — 63% of the way there in the first 0.33s,
// then two more seconds creeping through the last few percent. That last one is what hid the ring:
// its formation is real (see sunParticles) but every visible frame of it was crammed into ~0.3s and
// the remaining 80% of the duration was spent where nothing moves. Same failure the shard assembly
// documents in `positionShards` — the motion was real, it was just spent where the eye can't see it.

/**
 * When the shell comes apart, in the pin's FILL space (0 = top of the page, 1 = the black square has
 * covered the viewport).
 *
 * Measured in `fill` rather than in the transition's own progress so the star finishes opening on the
 * exact frame the page goes black — a landmark, not a number that drifts if the layout changes.
 *
 * The opening therefore begins while the cream hero and the headline are still on screen, which is
 * deliberate: the star straining is the REASON the void grows. Raise the start if it reads as busy.
 */
const CRACKS_WINDOW: readonly [number, number] = [0.3, 1.0];
/**
 * When the orbital ring assembles, in the TRANSITION's space (0 = top of the page, 1 = fleet on
 * screen) — so it completes on the fleet, a beat after the cracks finish.
 *
 * Two constraints pin this window down, and they are why it is late and in a different space:
 *
 *  1. The grains are ADDITIVELY blended, and they enter from 2.1× their final orbit — outside the
 *     canvas, clipped, the way the shards do. Over the cream hero that washes out and reads as
 *     broken. The black square covers this canvas (which is SUN_CANVAS_HEADROOM × the square, and
 *     the sun is also RISING away from it) at ~0.31–0.40 of the fill across every viewport tested,
 *     so anything from ~0.45 up is safely on black.
 *  2. The hero headline is cut instantly at the end of the fill, and the ring's outer radius reaches
 *     past where the "rlds" glyphs sit. Starting at 0.55 leaves only the earliest arrivals — where
 *     `settled` is still near 0 and they are barely drawn — overlapping any text.
 */
const RING_WINDOW: readonly [number, number] = [0.3, 1.0];
/**
 * The window of the services→works HANDOFF over which the outer two rings erupt.
 *
 * A second eruption on a second scroll, rather than all three arriving at once on the first. Services
 * shows a single band thrown off the newly cracked star; flying to works fills the system out. It ends
 * before the handoff does so the rings have settled by the time you arrive, and starts after it begins
 * so they are not already forming while the ship is still on the pad.
 */
const RING_WORKS_WINDOW: readonly [number, number] = [0.05, 1.0];
/**
 * Per-frame ease toward the scrubbed targets, as every crossing does — but expressed as a RATE, so
 * `1 - exp(-rate × delta)` is genuinely frame-rate independent (the same form as useServicesDeck's
 * HEADING_EASE_RATE). 6/s reproduces the feel of the crossings' `0.09` per frame at 60Hz on every
 * display instead of only on that one.
 */
const STATE_EASE_RATE = 6;
const STATE_SETTLE_EPSILON = 0.0005;

/** A 0..1 across a window of some other 0..1, flat outside it. */
const rampWindow = (range: readonly [number, number], value: number) =>
  THREE.MathUtils.clamp((value - range[0]) / (range[1] - range[0]), 0, 1);

// ── Services: the "Cracks" stage ──
// The sun's SECOND state, and the next beat of the site's spine (peaceful → cracks → collapse →
// singularity). Authored in the same deleted editor as Peaceful above, and likewise now only here.
//
// The star does not swap or reload: the same model eases from its Peaceful pose into this one on
// `intensity`, so scrolling back up to the hero closes the cracks again.
/** How far the ten shards part, × the shard radius. Positive opens; negative would collapse (Stage 3). */
const CRACKS_FRACTURE_SPREAD = 0.18;
/** It turns more restlessly once it starts coming apart. */
const CRACKS_ROTATE_DEGREES_PER_SECOND = 20;
const CRACKS_FLARE_SPIN_DEGREES_PER_SECOND = 22;
/** A warm light INSIDE the shell, so the magma reads as pushing out through the widening gaps. */
const CRACKS_CORE_LIGHT_COLOR = 0xffb060;
const CRACKS_CORE_LIGHT_INTENSITY = 4;
/** The cracks breathe — a slow inward (gravity) tug that never quite closes them. */
const CRACKS_PULSE_AMOUNT = 0.12;
const CRACKS_PULSE_SPEED = 0.3;
/** Per-shard phase, so they breathe out of step. In lockstep it reads as one mechanical pulse. */
const CRACKS_PULSE_PHASE_STEP = 0.7;

// ── The sun's THIRD state: COLLAPSE ──
// The star the works section is lit by. ⚠ `singularityScene.ts` mirrors the four GEOMETRY values of
// this pose so the star you leave and the star you come back to match — those two must not drift.
//
// This is not new machinery. Collapse is the SAME ten-shard rig the cracks already drive, carried
// past zero: where the cracks part the shell by +0.18 of a shard radius, this crushes it inward by
// −0.5. Everything else — the spin-up, the white-hot core, the hotter grade — follows the same one
// ramp, so it reverses exactly on scroll-back like every other scrubbed state on this site.
//
// ⚠ It is a POSE, not the finale. Stage 4 (Singularity) arms the flash, the accretion spiral and the
// black hole, and that still belongs after the chamber — see docs/sun-to-blackhole-finale-plan.md.
// Nothing here should ever advance on its own.
/** Shards crushed INWARD, × the shard radius. The sign is the whole difference from cracks. */
const COLLAPSE_FRACTURE_SPREAD = -0.5;
/** It shrinks to a dense core as it implodes. */
const COLLAPSE_MODEL_SCALE = 0.5;
/** Conservation of angular momentum — it winds up as it contracts. */
const COLLAPSE_ROTATE_DEGREES_PER_SECOND = 45;
const COLLAPSE_FLARE_SPIN_DEGREES_PER_SECOND = 40;
/** White-hot compression light, well past the cracks' warm amber. */
const COLLAPSE_CORE_LIGHT_COLOR = 0xffe6c8;
const COLLAPSE_CORE_LIGHT_INTENSITY = 18;
/** Super-glowy: the grade is most of why a collapse reads as violent rather than as a shrink. */
const COLLAPSE_BLOOM_STRENGTH = 2.5;
const COLLAPSE_BLOOM_RADIUS = 1;
const COLLAPSE_BLOOM_THRESHOLD = 0.42;
const COLLAPSE_EXPOSURE = 1.6;
const COLLAPSE_MAGMA_EMISSIVE = 5;

/**
 * Past this much of the works→chamber reveal the star stops animating and the demand-render gate takes
 * over.
 *
 * ⚠ It used to key off the services→works HANDOFF, on the stated grounds that "the works field's opaque
 * backdrop has fully covered the sun". That premise was false, and globals.css says so:
 * `.hero-section.is-services .works-backdrop` is forced to `opacity: 0` precisely so the sun stays
 * visible through works. The star was freezing on one frame for the whole section and nobody noticed,
 * because a motionless star still looks like a star — which stopped being acceptable when works became
 * where it COLLAPSES. So it keys off the REVEAL instead, and the star is alive for all of works.
 *
 * Set just past the end of `REVEAL_SUN_FADE` (0.12 in useHeroAnimation), which is where the sun's own
 * opacity reaches 0 — the earliest point at which nothing it does can be seen. Keep the two in step: a
 * value BELOW the fade's end freezes the star while it is still on screen, and a value far above it
 * pays for a bloom pass on something fully transparent, during the reveal, which is the most expensive
 * moment on the site.
 */
const SUN_COVERED_CHAMBER_PROGRESS = 0.15;

const TWO_PI = Math.PI * 2;

/** One fracture shard: where it belongs, and where it travels in from. */
interface Shard {
  object: THREE.Object3D;
  home: THREE.Vector3;
  homeQuaternion: THREE.Quaternion;
  /**
   * Unit direction from the fracture's centroid out to this shard's home — the axis it parts along
   * when the star cracks open. `singularityScene.ts` builds it the same way, so the hero's crack and
   * the contact finale's implosion part the shell along the same axes.
   */
  outward: THREE.Vector3;
  /** Its starting offset from home, already converted into the model's local frame. */
  far: THREE.Vector3;
  /** How far back along the camera's view axis `far` puts it — the term that drives apparent size. */
  depth: number;
  /** The orientation it tumbles in from, slerped back to `homeQuaternion` as it lands. */
  tumble: THREE.Quaternion;
  /** Per-shard phase so they drift out of step rather than bobbing in unison. */
  phase: number;
  /** Its own axis of rotation while it waits — see IDLE_TUMBLE_DEGREES_PER_SECOND. */
  spinAxis: THREE.Vector3;
}

/** Everything that is not a shard — the star's body and its corona, which grow in as the shell closes. */
interface CoronaPart {
  object: THREE.Object3D;
  /** Its authored scale. Not 1 — `Sketchfab_model` carries 0.964 — so growth multiplies, never sets. */
  homeScale: THREE.Vector3;
}

/** One flare disc's spin state — axis is its own normal, so it turns flat like a coin. */
interface FlareSpin {
  mesh: THREE.Mesh;
  axis: THREE.Vector3;
  base: THREE.Quaternion;
  angle: number;
}

export default function SunModelCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // preserveDrawingBuffer so the last frame keeps compositing while we're NOT drawing — the sun is
    // deliberately frozen for most of the scroll (see the demand-render gate). Without it, an
    // un-preserved buffer's contents are undefined once we stop rendering.
    const renderer = new THREE.WebGLRenderer({
      canvas,
      /**
       * ── ⚠ OFF, and this is the one change in the perf pass that wants eyes on it ────────────────
       *
       * MSAA on the DEFAULT framebuffer, on the one context that also sets `preserveDrawingBuffer`.
       * That pair is the expensive one: the driver has to resolve the multisample buffer and then
       * keep the result rather than discarding it, every frame, on a canvas that is 3 Mpx at this
       * ratio and 6.7 Mpx of device pixels once composited. The profiler had `sun · bloom` at 9–22 ms
       * — the largest measured span on the page whenever the star draws.
       *
       * What it buys is small here, for two reasons specific to this canvas. The star goes through a
       * bloom pass, so its bright edges are already soft; MSAA only ever helped the shards' hard
       * silhouette against the transparent background. And the canvas renders BELOW the panel's
       * density (ratio ~1.68 on a dpr 2.5 display), so the browser upscales it on composite, which
       * softens those silhouettes anyway.
       *
       * If the star's edges crawl as it turns, this is the line — put it back and we find the frame
       * time somewhere else.
       */
      antialias: false,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(sunPixelRatio());
    // Which compressed texture formats this GPU accepts. Must happen before any KTX2 model loads —
    // the loader throws rather than guessing. See lib/modelLoading.ts.
    detectKtx2Support(renderer);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = EXPOSURE;

    const initialWidth = canvas.clientWidth || canvas.offsetWidth || 900;
    const initialHeight = canvas.clientHeight || canvas.offsetHeight || 300;
    renderer.setSize(initialWidth, initialHeight, false);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, initialWidth / initialHeight, 0.01, 100);

    // The spinner carries the idle rotation; the model keeps its authored pose. Separate nodes so the
    // two never fight over the same Euler.
    const spinner = new THREE.Group();
    scene.add(spinner);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const environmentTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = environmentTexture;

    const keyLight = new THREE.DirectionalLight(KEY_COLOR, KEY_INTENSITY);
    keyLight.position.set(3, 4, 5);
    const fillLight = new THREE.DirectionalLight(FILL_COLOR, FILL_INTENSITY);
    fillLight.position.set(-4, -1, -3);
    const ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
    // The Cracks stage's inner light. Dark on the hero (intensity 0) and ramped up with the services
    // energy, it sits INSIDE the shell at the star's centre — so as the shards part, the light escapes
    // through the widening gaps instead of the crack simply reading as a dark seam.
    const coreLight = new THREE.PointLight(CRACKS_CORE_LIGHT_COLOR, 0);
    scene.add(keyLight, fillLight, ambientLight, coreLight);

    // Bloom — the Peaceful stage's glow, on a transparent canvas.
    //
    // NOT an EffectComposer. One was tried and it drew a visible RECTANGLE around the sun: a composer
    // ends by blitting its target to the canvas with a full-screen quad, and that quad writes alpha
    // across the whole buffer, so the canvas stopped being transparent and its box showed against the
    // cream hero. `sunBloom.ts` keeps the base scene rendering DIRECTLY to the canvas (so those pixels
    // and their alpha are untouched) and only ADDS the blurred glow over it. See its header.
    const bloom = createSunBloom(renderer);
    // Sized up front as well as from `applySize`: the ResizeObserver's first callback can land after
    // a frame has already drawn, and a 1×1 glow target for that frame would read as a flash.
    bloom.setSize(initialWidth, initialHeight);

    let modelRoot: THREE.Object3D | null = null;
    /** The glTF's own root scale, so the collapse can shrink FROM it rather than replace it. */
    const modelBaseScale = new THREE.Vector3(1, 1, 1);
    /** Scratch for the core light's collapse tint, so a per-frame lerp allocates nothing. */
    const collapseCoreColor = new THREE.Color(COLLAPSE_CORE_LIGHT_COLOR);
    // Built only once the model has loaded — the ring radii are fractions of the visible frame, which
    // isn't known until the camera has been fitted to the model.
    let sunParticles: ReturnType<typeof createSunParticles> | null = null;
    /**
     * The star's burning surface. Null under reduced motion, where a churning field is exactly the
     * ambient movement that setting asks us not to run — the crust and its emissive still read.
     */
    let plasma: SunPlasma | null = null;
    /**
     * Visible half-height at the sun's own distance, set when the camera is fitted. The particle
     * rings are sized against this so they can never spill past the canvas edge — which is what drew
     * a hard rectangle around the sun when they were sized against the model instead.
     */
    let frameHalfHeightAtSun = 1;
    const shards: Shard[] = [];
    const coronaParts: CoronaPart[] = [];
    let shardRadius = 1;
    /** Camera → sun distance, set once the model is framed. The assembly's perspective maths needs it. */
    let cameraDistance = 1;
    /** The magma materials, so the assembly can run them hot while the pieces are still inbound. */
    const heatedMaterials: THREE.MeshStandardMaterial[] = [];
    const flareSpins: FlareSpin[] = [];
    const scratchSpin = new THREE.Quaternion();
    /** Scratch for a waiting shard's spun tumble pose, so the per-frame drift allocates nothing. */
    const idleTumble = new THREE.Quaternion();

    // ── Sizing ──
    let forceRender = true;
    /**
     * The half-extent the particle rings are measured against: the SMALLER of the frame's half-width
     * and half-height, so a ring stays inside the canvas on a portrait aspect too. (Half-width is
     * half-height × aspect, so anything under 1:1 is the limiting dimension.)
     */
    const particleFrameExtent = () =>
      frameHalfHeightAtSun * Math.min(1, camera.aspect || 1);
    /** The ratio these buffers were actually allocated at — see the loop's follow-up below. */
    let appliedPixelRatio = sunPixelRatio();
    const applySize = () => {
      const width = canvas.clientWidth || canvas.offsetWidth;
      const height = canvas.clientHeight || canvas.offsetHeight;
      if (!width || !height) return;
      // Also the re-entry point for a ratio change, so the controller has one thing to call.
      const ratio = sunPixelRatio();
      appliedPixelRatio = ratio;
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      // The bloom's targets follow the canvas, or the glow is sampled at the wrong scale.
      bloom.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // Re-fit the rings to the new frame — this is what keeps them from clipping on resize.
      sunParticles?.setFrameExtent(particleFrameExtent());
      // Point sizes are computed in DEVICE pixels, so they have to follow the ratio too — otherwise
      // the grains change apparent size the moment the controller moves.
      sunParticles?.setPixelRatio(ratio);
      forceRender = true;
    };
    const observer = new ResizeObserver(applySize);
    observer.observe(canvas.parentElement ?? canvas);

    // ── The hero → services state ramp ──
    // Two windows on one scrubbed signal (see CRACKS_WINDOW / RING_WINDOW). The pin publishes the
    // span's layout; the meaning is entirely here, so `useHeroAnimation` knows nothing about how the
    // star looks.
    let targetCracks = 0;
    let targetRingForm = 0;
    const onHeroServicesProgress = (event: Event) => {
      const { progress, fill } = readHeroServicesProgress(event);
      targetCracks = rampWindow(CRACKS_WINDOW, fill);
      targetRingForm = rampWindow(RING_WINDOW, progress);
    };
    window.addEventListener(HERO_SERVICES_PROGRESS_EVENT, onHeroServicesProgress);

    // ── The collapse ──
    // Driven by the services→works crossing's own 0..1, so the star implodes as you fly across and
    // un-implodes if you scroll back. Nothing here is a flag or a timer: it is the same "publish a
    // scrubbed fraction, let each scene ease its own copy" contract the cracks already use, which is
    // why the whole thing reverses for free and cannot be outrun by a fast flick.
    let targetCollapse = 0;
    let targetRingWorks = 0;
    const onHandoffProgress = (event: Event) => {
      const progress = THREE.MathUtils.clamp(readHandoffProgress(event), 0, 1);
      targetCollapse = progress;
      // Its own window of the same scrubbed signal — a window is not a second clock, so the rings
      // cannot desync from the collapse they erupt around, and both reverse together.
      targetRingWorks = rampWindow(RING_WORKS_WINDOW, progress);
    };
    window.addEventListener(HANDOFF_PROGRESS_EVENT, onHandoffProgress);

    // True once the chamber reveal has faded the sun out — see SUN_COVERED_CHAMBER_PROGRESS. This is
    // what lets the collapsing sun stay alive for the whole works section while still costing nothing
    // once the room has taken over.
    //
    // ⚠ The RETURN used to veto this, thawing the star for the whole of contact so it could die there.
    // That is gone: the star that dies is a separate object in the works scene, so this one now stays
    // frozen from the reveal to the bottom of the page — no bloom pass and no second scene render for
    // the whole ending. Re-adding a contact input here would pay for a star nobody can see.
    let covered = false;
    let revealProgress = 0;
    const applyCovered = () => {
      const wasCovered = covered;
      covered = revealProgress >= SUN_COVERED_CHAMBER_PROGRESS;
      if (wasCovered === covered) return;
      // Uncovering has to draw again: the sun stopped redrawing while it was hidden, so without this
      // scrolling back out of the room would reveal the stale frame it froze on.
      if (!covered) forceRender = true;
      // ── …and stop COMPOSITING it, not just drawing it ──
      // `covered` already stops the render. It does nothing about the layer: the reveal fades this
      // canvas to `opacity: 0`, and a zero-opacity canvas is still rasterized and blended every frame
      // — a full-screen layer, at device resolution, for the whole of the chamber and contact, showing
      // a star that has been deliberately faded out. Same trap `useFluidCursor` documents for its two
      // canvases, and the same fix.
      //
      // ⚠ `visibility`, not `display: none`. `applySize` reads `clientWidth/clientHeight` off this
      // element; display-none reports zero and would resize the drawing buffer to nothing.
      canvas.classList.toggle('is-uncomposited', covered);
    };
    const onChamberProgress = (event: Event) => {
      revealProgress = readChamberProgress(event);
      applyCovered();
    };
    window.addEventListener(CHAMBER_PROGRESS_EVENT, onChamberProgress);

    // ── Is another scene competing for the frame? ──
    // False on the hero and its fill, where the star is the subject and nothing else draws; true from
    // the fleet to the bottom of the page. The ONLY thing it gates is how often the star is drawn (see
    // SUN_IDLE_STRIDE) — not what it looks like, not when it is allowed to move. Keyed off the black
    // stage rather than the deck's reveal because a navbar jump reaches works without entering the
    // fleet; see lib/blackStageEvent.ts.
    let inBlackStage = false;
    const onBlackStage = (event: Event) => {
      const active = readBlackStageActive(event);
      if (active === inBlackStage) return;
      inBlackStage = active;
      // Coming back to the hero, draw immediately rather than up to one strided frame later — this is
      // also the teleport's path home, where the star has a whole re-gather to play.
      if (!active) forceRender = true;
    };
    window.addEventListener(BLACK_STAGE_EVENT, onBlackStage);

    // ── The loop landed at the top ──
    // The pin has jumped to progress 0, so every target below is already home while our own eased copies
    // are still wherever the bottom of the page left them. They chase at STATE_EASE_RATE, which is a
    // sixth of a second per e-fold — long enough to watch the shell re-crack and the collapse un-wind
    // behind the cream. Snapped instead. See LOOP_RESET_EVENT.
    const onLoopReset = () => {
      revealProgress = 0;
      applyCovered();
      targetCracks = 0;
      targetRingForm = 0;
      targetRingWorks = 0;
      targetCollapse = 0;
      cracks = 0;
      ringForm = 0;
      ringWorksForm = 0;
      collapse = 0;
      forceRender = true;
    };
    window.addEventListener(LOOP_RESET_EVENT, onLoopReset);

    // ── Gather again ──
    // The loader's own finale, replayed: the ten shards sweep back in from outside the frame and lock
    // together, and the star lights inside the closing shell.
    //
    // ⚠ Deliberately its OWN event rather than re-firing SUN_ASSEMBLE_EVENT. `IntroSequence` returns null
    // once it is done but STAYS MOUNTED (Contract 1 — it must never rely on effect cleanup to unlock
    // scroll), so its `SUN_ASSEMBLED_EVENT` listener is still live and re-cueing the shared event would
    // poke the loader's handoff long after the loader is gone.
    const onRegather = () => {
      if (reduceMotion || !modelReady) return;
      assembly = 0;
      // Not the reveal's hurried version: nothing is waiting on this one, so it plays at its authored
      // pace and is actually watched.
      forceAssembled = false;
      assemblyCued = true;
      // Reads only — this used to be `getElapsedTime()`, which advanced the clock from OUTSIDE the
      // render loop and so stole the next frame's delta. See lib/frameTimer.ts.
      positionShards(0, frameTimer.elapsed());
      forceRender = true;
    };
    window.addEventListener(SUN_REGATHER_EVENT, onRegather);

    // ── Assembly ──
    // A one-shot flight, cued when the load reaches 100%. The dust carries the wait; this is the reward
    // for it ending, so it runs on its own clock and the intro holds its handoff until it finishes.
    // Gates more than the assembly, despite living here: it also kills the cracks' breathing pulse,
    // drops the orbital ring entirely, and snaps the state ramp instead of easing it.
    const reduceMotion = prefersReducedMotion();
    let assembly = 0;
    /**
     * ── ⚠ THE STAR DOES NOT DRAW WHILE THE LOADER IS WAITING ─────────────────────────────────────
     *
     * It used to draw every frame from the moment the model landed until the reveal: ten shards
     * drifting, `sunParticles`, and a bloom pass, on a canvas `SUN_CANVAS_HEADROOM` larger than the
     * hero square PER AXIS — 6.76× its area. The profiler note above puts `sun · bloom` at 10–21 ms,
     * the largest measured span on the page. On a slow connection the loader was paying that for a
     * minute, on the frames where the GPU process was already decoding textures and compiling two
     * scenes, and it is most of why the loading screen itself was reported as laggy.
     *
     * ⚠ THIS REVERSES THE REASONING BEHIND `ASSEMBLY_ENTRY_MARGIN_MIN/MAX`, deliberately. The shards
     * were moved INTO frame to wait, because "on a slow load that left the loader with nothing on it
     * but dust for a minute, and the star arriving from nowhere at the end". That was correct, and its
     * premise is gone: the loader's wait is now filled by the gather field's held drawings, and the
     * whole finale — wordmark, star, assembly — sits on the far side of the gate (see IntroSequence).
     * If the drawings are ever removed, this decision has to be revisited with them.
     *
     * ⚠ It is permitted at the BURN-IN, not at the reveal, and that is load-bearing. The burn-in's
     * only claim over `gpuProbe` is that it measures the frame the visitor actually gets — which
     * includes this canvas rendering alongside the works field. Letting it start one stage early costs
     * ~1.5 s of star and keeps the measurement honest.
     *
     * ⚠ AND IT DOES NOT APPLY UNDER REDUCED MOTION. That path has no held beat and no drawings — the
     * gather field opts out of WebGL entirely — and it reveals the sun layer from its first frame, at
     * z-index 10001, ABOVE the veil. Withholding the render there would put an empty box on screen
     * where the star is meant to be, for the whole download. The reduced-motion loader is a counter
     * and a star, exactly as it was.
     */
    let drawingPermitted = reduceMotion;
    const permitDrawing = () => {
      if (drawingPermitted) return;
      drawingPermitted = true;
      forceRender = true;
    };
    // ⚠ Not `BURN_IN_EVENT` any more. The burn-in measures this canvas by drawing one phase without it
    // and one with it, so the star has to stay dark until the field has had its phase alone — see
    // SUN_DRAW_PERMIT_EVENT for the three independent things that guarantee this still fires.
    window.addEventListener(SUN_DRAW_PERMIT_EVENT, permitDrawing);

    let modelReady = false;
    let assemblyCued = false;
    let forceAssembled = false;
    const cueAssembly = () => {
      assemblyCued = true;
      // Belt and braces: whatever cued it — the intro, a missing loader, the fallback timer — the
      // flight must never run behind a canvas that is not being drawn. It is the loader's finale.
      permitDrawing();
    };
    // The intro cues this when the load hits 100%, and holds its own handoff until we answer with
    // SUN_ASSEMBLED_EVENT — so the flight is the loader's finale and is always watched start to finish.
    window.addEventListener(SUN_ASSEMBLE_EVENT, cueAssembly);
    // With no loader on the page there is no cue coming, so assemble as soon as the model lands. Checking
    // the DOM rather than listening for INTRO_ACTIVE_EVENT because this canvas is dynamically imported
    // and mounts well after the intro has already announced itself — the event would be long gone.
    const introOnPage = document.querySelector(INTRO_MARKER_SELECTOR) !== null;
    if (!introOnPage) cueAssembly();
    // Ultimate safety net: an intro that is on the page but never reaches its gate must not leave the
    // sun in pieces forever. Armed from the model's landing (see ASSEMBLE_CUE_FALLBACK_MS) — until
    // then there is nothing to assemble and nothing this could be late for.
    let cueFallbackTimer = 0;
    /** The heartbeat listener that keeps re-arming it, held so teardown can remove it. */
    let introHeartbeatListener: (() => void) | null = null;
    const onReveal = () => {
      forceAssembled = true;
      cueAssembly(); // past the point of waiting for a cue that clearly is not coming
    };
    window.addEventListener(REVEAL_EVENT, onReveal);

    /**
     * Place every shard for an assembly value: 0 = deep, and outside the frame entirely; 1 = home.
     *
     * `time` only drives the drift, which fades out as the pieces settle — so a settled sun is
     * perfectly still and needs no separate stop condition.
     */
    const positionShards = (assemblyValue: number, time: number) => {
      // Ease the ARRIVAL, then solve back for the position — do not ease the position directly.
      //
      // Apparent size under perspective is cameraDistance / (cameraDistance + depth), and these pieces
      // start ~16 shard-radii behind a camera sitting 1.5 radii out, so they open the flight at ~17% of
      // their final size. Easing the position lerp (what this used to do) therefore buys almost nothing
      // early: the shards crawled 17% → 29% over the first half of the animation and then did all their
      // visible growing in the last few frames. That is exactly what "it isn't assembling, it's just
      // standing there" looks like — the motion was real, it was just spent where the eye can't see it.
      //
      // Interpolating RECIPROCAL distance is the standard fix: it makes depth read linearly, so the
      // pieces now sweep in at an even perceived rate the whole way (17% → 30% → 59% → 87% → 100%).
      const arrival = assemblyValue * assemblyValue * (3 - 2 * assemblyValue);
      const receding = 1 - arrival;

      heatedMaterials.forEach((material) => {
        material.emissiveIntensity = MAGMA_EMISSIVE * (1 + receding * ASSEMBLY_HEAT);
      });

      // The star lights inside the closing shell rather than waiting there for it.
      const coronaGrowth = THREE.MathUtils.smoothstep(arrival, CORONA_APPEAR, 1);
      coronaParts.forEach(({ object, homeScale }) => {
        object.visible = coronaGrowth > 0;
        object.scale.copy(homeScale).multiplyScalar(coronaGrowth);
      });

      // The whole waiting field circles the star slowly, and stops circling as it docks. One angle for
      // every piece, so they hold their formation while they orbit rather than scattering.
      const orbit = THREE.MathUtils.degToRad(IDLE_ORBIT_DEGREES_PER_SECOND) * time * receding;
      const orbitCos = Math.cos(orbit);
      const orbitSin = Math.sin(orbit);

      shards.forEach(({ object, home, homeQuaternion, far, depth, tumble, phase, spinAxis }) => {
        const distance =
          1 / THREE.MathUtils.lerp(1 / (cameraDistance + depth), 1 / cameraDistance, arrival);
        const travelling = (distance - cameraDistance) / depth;
        // Drift and tumble stay on the eased clock, not on `travelling` — `travelling` collapses early
        // by design now, and hanging the float off it would stop the pieces moving well before they land.
        const drift = receding * ASSEMBLY_FLOAT * shardRadius;
        // The offset from home, orbited about the view axis. Rotating the OFFSET rather than the world
        // position is what keeps the star's own centre fixed while the debris goes round it.
        const offsetX = far.x * travelling;
        const offsetY = far.y * travelling;
        object.position.set(
          home.x + offsetX * orbitCos - offsetY * orbitSin +
            Math.sin(time * ASSEMBLY_FLOAT_SPEED + phase) * drift,
          home.y + offsetX * orbitSin + offsetY * orbitCos +
            Math.cos(time * ASSEMBLY_FLOAT_SPEED * 0.8 + phase) * drift,
          home.z + far.z * travelling + Math.sin(time * ASSEMBLY_FLOAT_SPEED * 1.2 + phase) * drift,
        );
        // Turning on its own axis while it waits, settling into its true orientation as it docks.
        //
        // ⚠ The spin is applied to the TUMBLE pose and then the whole thing is slerped home, rather
        // than being added after — so at arrival 1 the result is exactly `homeQuaternion`, with no
        // residue. A spin applied on top would leave every shard a few degrees off its authored seat,
        // and the fracture only looks like a fracture when the ten pieces line up exactly.
        scratchSpin.setFromAxisAngle(
          spinAxis,
          THREE.MathUtils.degToRad(IDLE_TUMBLE_DEGREES_PER_SECOND) *
            time *
            (0.6 + phase / TWO_PI) *
            receding,
        );
        idleTumble.copy(tumble).multiply(scratchSpin);
        object.quaternion.slerpQuaternions(idleTumble, homeQuaternion, arrival);
      });
    };

    /**
     * Open the shell into the Cracks pose. Each
     * shard slides along its own outward axis by `spread × shardRadius`.
     *
     * Takes over shard positions from `positionShards` the moment the assembly finishes, so exactly
     * one thing owns them at any time. At `cracks = 0` it resolves to precisely `home`, which is why
     * it can be called unconditionally — scrolling back to the hero closes the star exactly, with no
     * drift left behind.
     */
    const applyCracks = (cracks: number, collapse: number, time: number) => {
      // Where the shell sits: parted by the cracks, then crushed inward as the collapse takes over.
      // One number, carried across zero — see COLLAPSE_FRACTURE_SPREAD.
      const spread = THREE.MathUtils.lerp(
        CRACKS_FRACTURE_SPREAD,
        COLLAPSE_FRACTURE_SPREAD,
        collapse,
      );
      shards.forEach(({ object, home, outward }, index) => {
        // The cracks breathe: a slow tug back toward the centre that never fully closes them. Each
        // shard carries its own phase so they pull out of step — in lockstep it reads as one
        // mechanical pulse rather than a star straining.
        //
        // Faded out by the collapse: a star being crushed is not idling, and a breathing pulse on top
        // of an implosion reads as the shell bouncing rather than as it giving way.
        const breath = reduceMotion
          ? 0
          : (Math.sin(TWO_PI * CRACKS_PULSE_SPEED * time + index * CRACKS_PULSE_PHASE_STEP) * 0.5 +
              0.5) *
            CRACKS_PULSE_AMOUNT *
            (1 - collapse);
        // The collapse must reach its pose even at `cracks = 1`, so it is applied OUTSIDE the cracks
        // ramp rather than multiplied by it — otherwise the crush would be capped by however far the
        // shell happened to have opened.
        const distance = (spread - breath) * Math.max(cracks, collapse) * shardRadius;
        object.position.set(
          home.x + outward.x * distance,
          home.y + outward.y * distance,
          home.z + outward.z * distance,
        );
      });
    };

    const onVisibility = () => {
      if (!document.hidden) forceRender = true;
    };
    document.addEventListener('visibilitychange', onVisibility);

    /**
     * Build the star's programs and upload its maps while nothing is watching.
     *
     * ⚠ THIS IS THE ONE THAT FROZE THE LOADER. The cause is `positionShards`: everything in
     * `coronaParts` — the core sphere, the outer glow, the flares and the twenty corona planes — sits
     * `visible = false` for the whole download, because the star is meant to light INSIDE the closing
     * shell (see CORONA_APPEAR). three builds a program the first time an object is actually DRAWN, so
     * none of those ~23 programs existed and none of their maps had been uploaded until the single
     * frame at arrival 0.55 when they all turned visible at once. Every compile and every upload
     * landed on that one frame, in the middle of the finale.
     *
     * Done here instead, right after the model lands — a beat already stalled by the glTF parse, where
     * one more pause hides in noise the visitor cannot avoid anyway.
     *
     * The mechanism moved to `lib/warmScene.ts` when it turned out the sun was not special: the room
     * and the contact star have exactly the same shape (built lazily, drawn much later) and were
     * paying exactly the same stall. Read its header for why the maps have to be uploaded separately
     * from the compile, and for the GPU-process reasoning that found this in the first place.
     */
    const warmStarMaterials = () => warmSceneMaterials(renderer, scene, camera);

    // ── Load ──
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(getSharedDracoLoader());
    gltfLoader.setKTX2Loader(getSharedKtx2Loader());

    let disposed = false;
    gltfLoader.load(
      MODEL_PATH,
      (gltf) => {
      if (disposed) return;
      modelRoot = gltf.scene;
      modelBaseScale.copy(modelRoot.scale);

      // The magma ships an emissive TEXTURE but no emissive factor, so by the glTF spec it renders
      // dead-black. Prime it to white or the sun has no glow at all.
      modelRoot.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (material instanceof THREE.MeshStandardMaterial) {
            if (material.emissiveMap && material.emissive.getHex() === 0x000000) {
              material.emissive.setHex(0xffffff);
            }
            // Lifted because there is no bloom to amplify it — this is the sun's entire glow now.
            material.emissiveIntensity = MAGMA_EMISSIVE;
            material.envMapIntensity = ENV_INTENSITY;
            // Shards share their materials, and they all travel on one clock, so the assembly's heat is
            // a single global ramp rather than a per-shard one.
            if (material.emissiveMap && !heatedMaterials.includes(material)) {
              heatedMaterials.push(material);
            }
          }
        });
      });

      // Flares are FLAT discs, and their geometry centre is offset from the mesh origin — spinning about
      // the origin would orbit them. Recentre each so it turns in place like a coin on a table.
      //
      // ⚠ Skipped entirely when the flares are omitted. `SUN_OMITTED_PARTS` only sets `visible = false`,
      // and an invisible mesh still gets its geometry cloned here and its quaternion rebuilt every frame
      // by `flareSpins` below. Hiding the draw while keeping the work is the one way this cull could
      // have quietly cost more than it saved.
      const flaresOmitted = SUN_OMITTED_PARTS.includes('flare');
      modelRoot.traverse((object) => {
        if (flaresOmitted) return;
        if (!(object instanceof THREE.Mesh)) return;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (!materials.some((material) => material.name === 'flare')) return;
        const geometry = object.geometry.clone();
        geometry.computeBoundingBox();
        const centre = new THREE.Vector3();
        geometry.boundingBox?.getCenter(centre);
        object.position.add(centre.clone().multiply(object.scale).applyQuaternion(object.quaternion));
        geometry.translate(-centre.x, -centre.y, -centre.z);
        object.geometry = geometry;

        geometry.computeBoundingBox();
        const size = new THREE.Vector3();
        geometry.boundingBox?.getSize(size);
        // Shortest local dimension is the disc's normal.
        const axis =
          size.x <= size.y && size.x <= size.z
            ? new THREE.Vector3(1, 0, 0)
            : size.y <= size.z
              ? new THREE.Vector3(0, 1, 0)
              : new THREE.Vector3(0, 0, 1);
        flareSpins.push({ mesh: object, axis, base: object.quaternion.clone(), angle: 0 });
      });

      modelRoot.rotation.set(
        THREE.MathUtils.degToRad(MODEL_ROTATION.x),
        THREE.MathUtils.degToRad(MODEL_ROTATION.y),
        THREE.MathUtils.degToRad(MODEL_ROTATION.z),
      );
      spinner.add(modelRoot);

      // World matrices, for everything below. Both the ablation's per-shell sizing and the centring
      // read world-space boxes, and `Box3` is always world space — so this has to happen once, here,
      // after the model is parented and before either of them looks at it.
      spinner.updateMatrixWorld(true);

      // ── The ablation — see SUN_OMITTED_PARTS ──
      //
      // ⚠ Runs BEFORE the centring below, and that ordering is load-bearing. It used to run after, so
      // that `Box3.setFromObject` (which does NOT skip invisible objects) framed the star identically
      // whether parts were hidden or not — the right property for a DIAGNOSTIC being A/B'd. It is the
      // wrong one for a shipping decision: the box then centres the star on geometry that no longer
      // draws.
      //
      // Measured, world space, after MODEL_ROTATION:
      //
      //     all meshes            centre x  -0.1741      ← what the star was centred on
      //     shipping geometry     centre x  +0.0003
      //     sunouter halo         centre x  +0.0003
      //     opaque core + shards  centre x  -0.0001
      //
      // The flares and the blowout planes were the ONLY thing off-axis. Everything that still ships is
      // already centred to within 0.0003 of the spin axis.
      //
      // ⚠ Hiding a MESH, never one of `coronaParts`. Those are the model root's own children and their
      // `visible` is written every frame from `coronaGrowth`; anything set here would be overwritten on
      // the next tick. Visibility in three is hierarchical, so a hidden mesh stays hidden when an
      // ancestor is shown — which is exactly the behaviour this needs.
      if (SUN_OMITTED_PARTS.length > 0 || SUN_ABLATION_KEEP_SHELLS > 0) {
        modelRoot.updateMatrixWorld(true);
        const shells: { mesh: THREE.Mesh; size: number }[] = [];
        let hidden = 0;
        modelRoot.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const names = (Array.isArray(object.material) ? object.material : [object.material]).map(
            (material) => material.name,
          );
          if (names.some(isOmittedSunPart)) {
            object.visible = false;
            hidden += 1;
            return;
          }
          if (SUN_ABLATION_KEEP_SHELLS > 0 && names.includes('sunouter')) {
            const extent = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3());
            shells.push({ mesh: object, size: Math.max(extent.x, extent.y, extent.z) });
          }
        });
        // Largest first, then drop everything past the keep count. The big shells carry the rim and the
        // silhouette; the small inner ones are the ones sitting behind ~99 % opacity.
        shells
          .sort((left, right) => right.size - left.size)
          .slice(SUN_ABLATION_KEEP_SHELLS)
          .forEach(({ mesh }) => {
            mesh.visible = false;
            hidden += 1;
          });
        if (telemetryEnabled) {
          console.log(
            `%c[voidix] sun ablation%c ${SUN_ABLATION_LABEL} — ${hidden} meshes hidden` +
              `${shells.length > 0 ? `, ${SUN_ABLATION_KEEP_SHELLS} of ${shells.length} shells kept` : ''}.` +
              `\n  Read \`sun · bloom\` per call on the hero; the gauge line carries \`sun parts\`.`,
            'color:#e0b341;font-weight:700',
            'color:#888',
          );
        }
      }

      // ── Put the model's centre ON the spinner's axis ──
      //
      // Without this the idle spin does not turn the sun in place, it ORBITS it: `spinner.rotation.y`
      // turns about the world origin, so content centred off that axis swings sideways over each
      // 58-second turn. That slow drift is what reads as "not centred" — the sun would be in the middle
      // only twice a minute. Converted back into the spinner's frame because the spinner has already
      // been turning for however long the model took to download.
      //
      // TWO boxes, and they are deliberately different:
      //
      //   `box`        every mesh, hidden ones included → the RADIUS, and therefore how big the star
      //                renders. Kept whole on purpose: `SUN_BODY_FILL` in gatherShader describes the
      //                margin around the body as "flares and empty margin", so the authored framing
      //                already treats them as padding. Fitting to the visible geometry instead would
      //                render the star 3.7 % larger and quietly re-compose the hero.
      //   `drawnBox`   the meshes that were not INDIVIDUALLY hidden → the CENTRE. This is the fix:
      //                centring on geometry that no longer renders put the star 0.174 units off its
      //                own spin axis.
      //
      // `Box3.setFromObject` has no visibility check, so the second box is built by hand.
      //
      // ⚠ "not individually hidden" is deliberately narrower than "visible on screen", and the
      // difference is load-bearing at exactly this moment. `positionShards(0, 0)` has already run, so
      // every entry in `coronaParts` is `visible = false` for the whole loader — the star lights
      // inside its closing shell. Testing ancestor visibility would therefore centre on the ten
      // shards alone and hand a different answer depending on WHEN this ran. Testing each mesh's own
      // flag asks the question we actually mean: what does this build ship? Measured, the two agree
      // to 0.0004 units here (shards -0.0001, shipping +0.0003) — but only one of them stays right
      // if `CORONA_APPEAR` or the load order ever moves.
      const box = new THREE.Box3().setFromObject(modelRoot);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const drawnBox = new THREE.Box3();
      modelRoot.traverse((object) => {
        if (!(object instanceof THREE.Mesh) || !object.visible) return;
        drawnBox.expandByObject(object);
      });
      // A star with nothing visible cannot be centred on anything — fall back rather than translate by
      // the empty box's Infinity. Only reachable if every group is omitted at once.
      const centre = (drawnBox.isEmpty() ? box : drawnBox).getCenter(new THREE.Vector3());
      spinner.worldToLocal(centre);
      modelRoot.position.sub(centre);

      // Frame it. The shards' entry points are expressed in terms of the visible frame — they have to
      // start outside it — so the camera has to be placed before they can be built.
      //
      // Panning (moving the camera and its aim point together) rather than rotating, so the sun shifts
      // across the frame without the perspective skewing.
      //
      // ⚠ SUN_FRAMING_NUDGE_X IS NOW 0, and this comment used to explain why it was not. It said the
      // model is not visually symmetric about its own bounding box — that the halo sits right of the
      // geometric centre. Measured, that is not what was happening: `sunouter` and the opaque core are
      // BOTH centred at x ≈ 0.000, and the whole 0.174 offset came from the flare discs and the blowout
      // planes dragging the bounding box left. Neither ships, and the centring above now reads the
      // drawn geometry, so there is nothing left to correct. See the constant for the dial if the glow
      // still reads off by eye.
      const fitDistance =
        (sphere.radius / Math.sin(THREE.MathUtils.degToRad(CAMERA_FOV * 0.5))) * CAMERA_FIT_MARGIN;
      const frameHalfHeight = fitDistance * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV * 0.5));
      frameHalfHeightAtSun = frameHalfHeight;
      const panX = frameHalfHeight * SUN_FRAMING_NUDGE_X;
      camera.position.set(panX, 0, fitDistance);
      camera.lookAt(panX, 0, 0);
      camera.updateProjectionMatrix();
      cameraDistance = fitDistance;
      // Half the visible frame per unit of distance from the camera — turns a depth into "how far out is
      // off-screen at that depth".
      const frameHalfPerUnit = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV * 0.5));

      // ── The plasma surface, in place of the eleven `sunouter` shells ──
      //
      // Added as a child of `modelRoot` and BEFORE `coronaParts` is built below, which is the whole
      // trick: it is picked up by that list automatically, so `positionShards` scales it from nothing
      // at CORONA_APPEAR exactly like every other non-shard part. Miss this and the star burns on
      // screen for the entire download and the loader's finale has nothing left to reveal.
      //
      // ⚠ Added AFTER the framing above, so it cannot move the camera fit. Its radius matches the
      // shells it replaces, so the bounding box is unchanged either way — but that is a property of
      // today's numbers, not a guarantee, and the framing should not depend on a constant in another
      // file. See `sunPlasma.ts` for what PLASMA_RADIUS chooses.
      if (!reduceMotion) {
        plasma = createSunPlasma();
        modelRoot.add(plasma.mesh);
      }

      // The ten fracture shards are Groups at the model root; their local positions carry the real
      // assembly offsets, so "outward" is measured entirely within that one frame.
      const shardObjects = modelRoot.children.filter((child) =>
        child.name.startsWith('Sphere_0_cell'),
      );
      // Everything else is the star's body and corona. Captured before anything is moved, so the scales
      // recorded here are the authored ones.
      modelRoot.children
        .filter((child) => !child.name.startsWith('Sphere_0_cell'))
        .forEach((object) => coronaParts.push({ object, homeScale: object.scale.clone() }));
      if (shardObjects.length > 0) {
        const centroid = new THREE.Vector3();
        shardObjects.forEach((shard) => centroid.add(shard.position));
        centroid.multiplyScalar(1 / shardObjects.length);
        let radiusSum = 0;
        shardObjects.forEach((shard) => {
          radiusSum += shard.position.clone().sub(centroid).length();
        });
        shardRadius = radiusSum / shardObjects.length || 1;

        // The parts start far back along the CAMERA's view axis, not the model's. The model carries an
        // authored pose, so a starting offset built in world space has to be rotated into the model's
        // local frame or "behind the camera" would point somewhere arbitrary.
        const toLocal = modelRoot.quaternion.clone().invert();

        shardObjects.forEach((shard) => {
          const outward = shard.position.clone().sub(centroid);
          // A shard exactly on the centroid has no outward — default to +Y so it still parts visibly.
          if (outward.lengthSq() < 1e-8) outward.set(0, 1, 0);
          outward.normalize();

          // Deep in −Z (away from the camera) and out past the edge of the frame, with a little of its
          // own radial direction so the pieces still read as belonging to one sphere.
          //
          // Depth is pulled out as its own number because the assembly paces itself by apparent size,
          // which depends on it. The radial push tilts the true depth a little, but it is ~1 unit
          // against 17–32, so it makes no difference to the pacing.
          const depth = (ASSEMBLY_DEPTH + Math.random() * ASSEMBLY_DEPTH_SPREAD) * shardRadius;
          // Off-frame at that depth, in a random direction around the view axis. Because the offset
          // shrinks with the same factor that carries the shard forward, a piece crosses into view of
          // its own accord partway through the flight — already moving, already at a readable size.
          const entryMargin =
            ASSEMBLY_ENTRY_MARGIN_MIN +
            Math.random() * (ASSEMBLY_ENTRY_MARGIN_MAX - ASSEMBLY_ENTRY_MARGIN_MIN);
          const entryRadius = (cameraDistance + depth) * frameHalfPerUnit * entryMargin;
          const entryAngle = Math.random() * Math.PI * 2;
          const far = new THREE.Vector3(
            Math.cos(entryAngle) * entryRadius,
            Math.sin(entryAngle) * entryRadius,
            -depth,
          )
            .applyQuaternion(toLocal)
            .addScaledVector(outward, ASSEMBLY_SPREAD * shardRadius);

          // A random orientation to tumble in from.
          const tumble = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(
              Math.random() * Math.PI * 2,
              Math.random() * Math.PI * 2,
              Math.random() * Math.PI * 2,
            ),
          );

          shards.push({
            object: shard,
            home: shard.position.clone(),
            homeQuaternion: shard.quaternion.clone(),
            // Cloned: `far` above consumed this vector via addScaledVector, and the cracks spread
            // needs it intact for the lifetime of the scene.
            outward: outward.clone(),
            far,
            depth,
            tumble,
            phase: Math.random() * Math.PI * 2,
            // A random unit axis, so no two pieces turn about the same one.
            spinAxis: new THREE.Vector3(
              Math.random() * 2 - 1,
              Math.random() * 2 - 1,
              Math.random() * 2 - 1,
            ).normalize(),
          });
        });
      }

      // The services dust. Added to the SCENE rather than to `spinner` on purpose: the model is
      // re-centred onto the spinner's origin above, so both frames share the star's centre — but the
      // dust has its own orbital motion and should not also inherit the star's spin.
      //
      // Skipped entirely under reduced motion: a continuously falling particle field is exactly the
      // kind of ambient motion that setting asks us not to run, and the cracked sun still reads
      // without it.
      if (!reduceMotion) {
        sunParticles = createSunParticles(particleFrameExtent(), renderer.getPixelRatio());
        // Centred on wherever the camera is actually aimed, not on the model's geometric origin —
        // rings left at the origin while the camera is panned would orbit a point the star does not
        // occupy. The loader's dust applies the same correction, from the same constant.
        //
        // ⚠ `panX` is 0 as of 2026-08-08 (SUN_FRAMING_NUDGE_X went to 0), so this is currently an
        // identity. It stays because it is the correction, not a constant: the moment the nudge is
        // touched, this and the dust have to move with it.
        sunParticles.object.position.x = panX;
        scene.add(sunParticles.object);
      }

      if (reduceMotion) {
        assembly = 1; // leave the shards home — no flight to reduce
        window.dispatchEvent(new Event(SUN_ASSEMBLED_EVENT)); // never make the intro wait for a flight
      } else {
        positionShards(0, 0); // parked off-frame, so the parts visibly travel in
      }
      warmStarMaterials();
      modelReady = true; // the one-shot assembly starts on the next frame after the cue
      // There is now something to assemble, so the backstop starts counting. See
      // ASSEMBLE_CUE_FALLBACK_MS for why this is armed here rather than at page load.
      //
      // ⚠ RE-ARMED ON EVERY INTRO HEARTBEAT, and without that this is a hole straight through the
      // gate. The intro now waits for EVERY source, not just this one — so the star can land in eight
      // seconds and the fleet keep streaming for another thirty. A one-shot timer measured from the
      // landing would fire in the middle of that, assemble the star while the loader was still
      // counting, and — because `SUN_ASSEMBLED_EVENT` is what releases the intro's last pause — hand
      // off to a site whose fleet had not arrived. Which is exactly the "it starts before the loading
      // finishes" report.
      //
      // The hero's own reveal fallback already solves this the same way (see
      // REVEAL_FALLBACK_WITH_INTRO_MS): while the loader is beating, nothing is stuck, so the backstop
      // has nothing to protect against. It only means anything once the beat stops.
      const armCueFallback = () => {
        window.clearTimeout(cueFallbackTimer);
        cueFallbackTimer = window.setTimeout(cueAssembly, ASSEMBLE_CUE_FALLBACK_MS);
      };
      armCueFallback();
      window.addEventListener(INTRO_ACTIVE_EVENT, armCueFallback);
      introHeartbeatListener = armCueFallback;
      applySize();
      forceRender = true;
      reportAssetProgress('sun', 1);
      // ⚠ The star is one of EXPECTED_SOURCES, so `areWarmupsDone()` counts it — and until now
      // nothing ever reported it, which meant that gate could never close. The intro's fast path
      // (`checkWarm`) was therefore dead on every load and `cueAssembly` only ever fired from its
      // 3.5s safety cap, so EVERY visitor — cached, fast machine, both scenes already warm — sat at
      // 100% for WARMUP_WAIT_MAX_MS before the shards moved. Reported HERE, next to the corona
      // compile it stands for: `warmStarMaterials` is the one warm-up that matters to the flight
      // that is about to run, because it is that flight's own materials.
      reportWarmupDone('sun');
      },
      // ── The loader's gate waits on this, and until 2026-08-03 it did not ──
      // The star is the hero's subject and the loader's whole finale is its ten shards flying in, but
      // it was invisible to `assetLoadProgress`: the counter reached 100 % on the fleet and the field
      // alone and handed off. On a slow connection that revealed a hero with nothing in it, and the sun
      // faded in half a minute later when its 1.3 MB finally arrived behind 5.3 MB of vessels the
      // visitor would not reach for another minute. See EXPECTED_SOURCES.
      //
      // `total` is 0 when the server sends no Content-Length (chunked / gzipped), in which case there
      // is nothing honest to report and the source simply jumps to 1 on completion.
      (progressEvent) => {
        // Unconditional, and before the total check. The loader's gate now waits on this star for as
        // long as it keeps moving instead of giving up on a fixed deadline, so it needs to know the
        // difference between a slow download and a dead one — and on a server that sends no
        // `Content-Length` the fraction below never moves off 0 no matter how healthy the transfer
        // is. Bytes arriving is the honest signal; the fraction is only the presentable one.
        reportSourceActivity('sun');
        if (progressEvent.total > 0) {
          reportAssetProgress('sun', progressEvent.loaded / progressEvent.total);
        }
      },
      (error) => {
        console.error(`Sun model failed to load: ${MODEL_PATH}`, error);
        // Report ready anyway. A source that never reaches 1 holds the intro's gate until its timeout,
        // so a missing star would cost every visitor twelve seconds on top of losing the star.
        reportAssetProgress('sun', 1);
        // Same reasoning one stage further down the gate: there is no model, so there is nothing to
        // warm and nothing this star can still be waiting for. Without this a 404 would clear the
        // asset wait and then hold the WARM wait to its own cap instead.
        reportWarmupDone('sun');
      },
    );

    // ── Render loop ──
    const frameTimer = createFrameTimer(MAX_FRAME_SECONDS);
    // The Cracks ramp — 0 on the hero, 1 on services. Every difference between the star's two states
    // is a function of this one value, so the transition reverses for free. `ringForm` is the same
    // idea on its own window of the same scroll.
    let cracks = 0;
    let ringForm = 0;
    let ringWorksForm = 0;
    /** The Collapse ramp — 0 through the hero and services, 1 across works. Eased like `cracks`. */
    let collapse = 0;
    let wasAnimating = true;
    let animationFrame = 0;
    /** Loop frames, for SUN_IDLE_STRIDE. */
    let loopFrameCounter = 0;
    /** Frames actually DRAWN, for SUN_GLOW_STRIDE. */
    let drawnFrameCounter = 0;
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const loopStartedAt = profileNow();
      const delta = frameTimer.tick();

      // Ease our own copy of the scrubbed targets, so the choreography can't be outrun by a fast
      // flick and never steps between the pin's ticks and our own frames.
      const stateEase = reduceMotion ? 1 : 1 - Math.exp(-STATE_EASE_RATE * delta);
      cracks += (targetCracks - cracks) * stateEase;
      ringForm += (targetRingForm - ringForm) * stateEase;
      ringWorksForm += (targetRingWorks - ringWorksForm) * stateEase;
      collapse += (targetCollapse - collapse) * stateEase;
      const elapsed = frameTimer.elapsed();
      // The star always turns — once it is allowed to be seen at all. It stops again only once the
      // works field has covered it completely.
      const moving = drawingPermitted && !covered;

      // ── Waiting: the pieces drift, and they are ON SCREEN while they do it ──
      //
      // This branch is new and it is the whole of "the shards should be flying around until the load
      // finishes". `positionShards` used to be called exactly once, at model-land, with a fixed time of
      // 0 — so the ten pieces were placed off-frame and then held that single pose, motionless and
      // clipped, for the entire download. The drift and tumble in `positionShards` were already written
      // and simply never ran; nothing was advancing their clock.
      //
      // Now it runs every frame until the cue, at arrival 0 — where `receding` is 1, so the orbit, the
      // float and the per-shard spin are all at full strength and the magma is at full ASSEMBLY_HEAT.
      // The pieces read as the largest, hottest debris in the same flow the dust belongs to.
      /**
       * ── ⚠ THE DRIFT AND THE FLIGHT ARE TWO DIFFERENT KINDS OF MOTION, AND WERE ONE FLAG ─────────
       *
       * Both used to set a single `assembling`, which fed `choreographyActive`, which BLOCKS a
       * resolution change. And the drift is true for the entire loader wait — so the star had no clear
       * frame anywhere between the burn-in and the hero, and any ratio the allocator gave it could only
       * land in front of the visitor as a sharpness pop on the site's centrepiece (`sunParticles`
       * changes grain size with it, so it is not a subtle one).
       *
       * The distinction is the one the rule below already draws for everything else:
       *
       *   · DRIFT  — delta-timed idle tumbling with no authored landing. A stall inside it is invisible.
       *              Must force a draw; must NOT block a reallocation.
       *   · FLIGHT — a one-shot beat that has to land exactly where it was authored to. A stall lets it
       *              advance behind the stall and finish somewhere else. Blocks everything.
       *
       * Splitting them is a correctness fix in its own right, quite apart from the allocator.
       */
      let driftActive = false;
      let assemblyFlightActive = false;
      // ⚠ `drawingPermitted` gates the DRIFT as well as the render, not just the render. The pieces
      // tumble on a delta-timed clock with no authored landing, so skipping it while nothing is on
      // screen changes nothing anyone can see — and leaving it running would keep the canvas drawing,
      // which is one of the two things that force a draw below. Gating one without the other would
      // have saved nothing at all.
      if (modelReady && !assemblyCued && !reduceMotion && drawingPermitted) {
        positionShards(0, elapsed);
        driftActive = true; // keep drawing: something on this canvas is moving
      }

      // Assembly: a one-shot flight in from deep space, run once the model is here AND the intro has
      // put the "o" on screen — whichever of those two lands last.
      if (modelReady && assemblyCued && assembly < 1) {
        const rate = (forceAssembled ? ASSEMBLY_REVEAL_SPEEDUP : 1) / ASSEMBLY_SECONDS;
        // Checked before the increment, so the frame that reaches exactly 1 still places the pieces —
        // they land on their true home rather than a fraction short of it.
        const wasBeforeForming = assembly < CORONA_APPEAR;
        assembly = Math.min(1, assembly + delta * rate);
        positionShards(assembly, elapsed);
        assemblyFlightActive = true;
        // The star has just lit inside the shell. The gathering field withdraws from around it on this,
        // rather than on the CUE — the cue is only the intro asking, and on a slow load the model may
        // not have arrived to answer it. See SUN_FORMING_EVENT.
        if (wasBeforeForming && assembly >= CORONA_APPEAR) {
          window.dispatchEvent(new Event(SUN_FORMING_EVENT));
        }
        // The intro is holding its handoff on this. Fired from here rather than from a timer so it is the
        // frame the last shard actually lands, however long the flight ended up taking.
        if (assembly >= 1) window.dispatchEvent(new Event(SUN_ASSEMBLED_EVENT));
      }

      if (moving) {
        // Peaceful → Cracks → Collapse, in that order, so the star gets steadily more restless rather
        // than changing speed at a threshold. The second lerp is the figure-skater effect: it winds up
        // as it contracts.
        const rotateRate = THREE.MathUtils.lerp(
          THREE.MathUtils.lerp(
            AUTO_ROTATE_DEGREES_PER_SECOND,
            CRACKS_ROTATE_DEGREES_PER_SECOND,
            cracks,
          ),
          COLLAPSE_ROTATE_DEGREES_PER_SECOND,
          collapse,
        );
        const flareRate = THREE.MathUtils.lerp(
          THREE.MathUtils.lerp(
            FLARE_SPIN_DEGREES_PER_SECOND,
            CRACKS_FLARE_SPIN_DEGREES_PER_SECOND,
            cracks,
          ),
          COLLAPSE_FLARE_SPIN_DEGREES_PER_SECOND,
          collapse,
        );
        spinner.rotation.y += THREE.MathUtils.degToRad(rotateRate) * delta;
        const flareDelta = THREE.MathUtils.degToRad(flareRate) * delta;
        flareSpins.forEach((spin) => {
          spin.angle += flareDelta;
          scratchSpin.setFromAxisAngle(spin.axis, spin.angle);
          spin.mesh.quaternion.copy(spin.base).multiply(scratchSpin);
        });
      }

      // The shell cracks open, then implodes. Guarded on the assembly being finished so the two never
      // fight over a shard's position — the flight owns them until it lands, this owns them afterwards.
      if (assembly >= 1) applyCracks(cracks, collapse, elapsed);

      // ── Everything else the collapse touches ──
      // All of it a pure function of the same ramp, so scrolling back out of works restores the star
      // exactly. Written unconditionally rather than behind an `if (collapse > 0)`: at 0 every lerp
      // resolves to the value it already had, and a guard would only add a branch that has to be kept
      // in step with the list below.
      //
      // The light inside the shell — amber escaping through widening gaps, then white-hot compression.
      coreLight.intensity = THREE.MathUtils.lerp(
        CRACKS_CORE_LIGHT_INTENSITY * cracks,
        COLLAPSE_CORE_LIGHT_INTENSITY,
        collapse,
      );
      coreLight.color.set(CRACKS_CORE_LIGHT_COLOR).lerp(collapseCoreColor, collapse);
      // It shrinks to a dense core as it crushes in. Multiplied onto the model's OWN scale rather than
      // assigned with setScalar: nothing else scales the root, but the glTF is free to arrive with a
      // non-uniform one, and flattening that would silently reshape the star.
      if (modelRoot) {
        modelRoot.scale
          .copy(modelBaseScale)
          .multiplyScalar(THREE.MathUtils.lerp(1, COLLAPSE_MODEL_SCALE, collapse));
      }
      // The grade. This is most of why a collapse reads as violent rather than as a shrink — see the
      // note on `setGrade` in sunBloom.
      bloom.setGrade(
        THREE.MathUtils.lerp(BLOOM_STRENGTH, COLLAPSE_BLOOM_STRENGTH, collapse),
        THREE.MathUtils.lerp(BLOOM_RADIUS, COLLAPSE_BLOOM_RADIUS, collapse),
        THREE.MathUtils.lerp(BLOOM_THRESHOLD, COLLAPSE_BLOOM_THRESHOLD, collapse),
      );
      renderer.toneMappingExposure = THREE.MathUtils.lerp(EXPOSURE, COLLAPSE_EXPOSURE, collapse);
      // Guarded on the assembly, because the intro drives these same materials hot while the shards
      // are still inbound (see ASSEMBLY_HEAT). Writing here unconditionally would overwrite that heat
      // with the resting value on the very frames it exists for.
      if (assembly >= 1) {
        const magmaIntensity = THREE.MathUtils.lerp(
          MAGMA_EMISSIVE,
          COLLAPSE_MAGMA_EMISSIVE,
          collapse,
        );
        heatedMaterials.forEach((material) => {
          material.emissiveIntensity = magmaIntensity;
        });
      }
      // The rings, on their OWN windows of the scroll rather than the cracks ramp — they have to
      // assemble on black (see RING_WINDOW / RING_WORKS_WINDOW).
      //
      // ⚠ These are NOT zeroed when the star freezes, and that is load-bearing. Zeroing here hard-cut
      // `uForm` to 0, which returns every grain to the launch knot inside the star and hides the layer —
      // so the star visibly lost its rings the moment the reveal passed the freeze point, and scrubbing
      // across it flickered them on and off. The freeze is meant to stop paying for a frame nobody can
      // see; it must never CHANGE the frame it freezes on, or scrubbing back across the threshold pops.
      sunParticles?.update(elapsed, ringForm, ringWorksForm);
      // The burning surface, on the same two ramps everything else in this file reads — so it is a
      // pure function of scroll progress and reverses for free, like the rest of the star. Three
      // uniform writes; the work is all in the fragment shader.
      plasma?.update(elapsed, cracks, collapse);

      // Demand-render: only draw while the image is actually changing — while the state ramp eases,
      // while the star still turns, or while the shards are still arriving.
      //
      // The sun used to freeze the moment services revealed, which made the whole
      // services → works → chamber span free. It cannot any more: the cracked star breathes, its dust
      // falls, and it collapses across the handoff — all of which have to keep drawing to read as alive,
      // and all of which are visible, because the works backdrop is transparent behind them. `covered`
      // buys back only the tail: once the reveal has faded the sun out, `moving` goes false and this
      // holds one frozen frame for the rest of the room.
      // `wasAnimating` draws the one final settled frame; `forceRender` covers resize / tab-restore.
      // ── Split in two, because "is anything moving" and "is anything CHOREOGRAPHED" are different ──
      // The ramps and the shard flight are authored beats: a stall inside one lets it advance behind
      // the stall and land somewhere else. The idle turn is not — it is delta-timed and constant, so a
      // dropped frame in the middle of it is invisible. Only the first kind may block a reallocation;
      // see where this is used below.
      const choreographyActive =
        Math.abs(targetCracks - cracks) > STATE_SETTLE_EPSILON ||
        Math.abs(targetRingForm - ringForm) > STATE_SETTLE_EPSILON ||
        Math.abs(targetRingWorks - ringWorksForm) > STATE_SETTLE_EPSILON ||
        Math.abs(targetCollapse - collapse) > STATE_SETTLE_EPSILON ||
        assemblyFlightActive;
      // ⚠ `driftActive` is here and NOT in `choreographyActive`, and that is the whole point of the
      // split above: the drift must keep the canvas drawing, and must not hold the resolution hostage
      // for the length of the download.
      const animating = choreographyActive || driftActive || moving;

      // ── ONE RULE: an authored beat runs at full rate; everything else may stride ──
      //
      // `choreographyActive` is that rule, and it is the same discriminator the reallocation below
      // uses for the same reason. The cracks, the ring, the shard flight and above all the COLLAPSE
      // are scrubbed under the visitor's finger, so a decimated one steps against the scroll. The idle
      // turn is delta-timed and constant; a dropped frame in it is invisible.
      //
      // ⚠ It also covers a subtlety that has nothing to do with motion: `bloom.setGrade` lerps the
      // bright pass's `uThreshold` during the collapse, and that uniform lives inside the very pass
      // SUN_GLOW_STRIDE skips. One rule, both problems.
      //
      // Counters are read BEFORE they increment so frame 0 always draws with a full glow — starting on
      // a skipped glow would composite an empty mip chain and flash the star in without its halo.
      const paintThisFrame =
        !inBlackStage ||
        choreographyActive ||
        forceRender ||
        loopFrameCounter % SUN_IDLE_STRIDE === 0;
      loopFrameCounter += 1;
      // What the star is costing right now, in the profiler's own report. 1 on the hero and through
      // every authored beat; SUN_IDLE_STRIDE while it is a background object behind another scene.
      profileGauge('sun stride', inBlackStage && !choreographyActive ? SUN_IDLE_STRIDE : 1);
      // ⚠ Every capture carries the configuration that produced it. Four ablation runs produce four
      // logs that are otherwise indistinguishable, and a number you cannot attribute is not a
      // measurement.
      profileGauge('sun parts', SUN_ABLATION_LABEL);
      // The star's OWN resolution, beside the field's `ratio` gauge — the two together are the whole
      // output of the allocator, and the only way to see at a glance whether the star was handed the
      // headroom the models left it. Reads `appliedPixelRatio`, not `getSunPixelRatio()`: what these
      // buffers were actually allocated at, never what the controller currently wishes they were.
      profileGauge('sun ratio', appliedPixelRatio);

      // ⚠ `drawingPermitted` is checked here as well as inside `moving`, and it has to be: the three
      // state ramps in `choreographyActive` settle on their own and `forceRender` is set by resize and
      // tab-restore, so either could ask for a draw while the loader is still waiting.
      if (drawingPermitted && !document.hidden && paintThisFrame && (animating || wasAnimating || forceRender)) {
        // ⚠ The star is a SECOND WebGL context and it draws alongside the field for the whole of
        // services and works (see CLAUDE.md — `covered` only goes true at the chamber reveal). It is
        // therefore one of the prime suspects for the frame time the works probe cannot see, and it
        // has never been measured separately from it.
        const refreshGlow =
          !inBlackStage || choreographyActive || drawnFrameCounter % SUN_GLOW_STRIDE === 0;
        drawnFrameCounter += 1;
        profileMeasure('sun · bloom', () => bloom.render(scene, camera, refreshGlow), true);
        forceRender = false;
      }
      // ⚠ Only a frame the stride let through may consume this. `wasAnimating` exists to draw the ONE
      // final settled frame after motion stops — and if the frame where `animating` goes false happens
      // to be one the stride skipped, clearing it here would mean that frame is never drawn by anyone.
      // The star would hold a pose 16 ms short of where the scroll actually left it, which is exactly
      // the kind of thing that only shows up as "it doesn't quite land right".
      if (paintThisFrame) wasAnimating = animating;

      // ── Follow the shared controller, on a frame with no authored beat running ──
      //
      // ⚠ `choreographyActive`, NOT `animating`, and the difference is the whole thing. `animating`
      // includes `moving`, which is `!covered` — true for the ENTIRE hero, fleet and works, because
      // the star turns the whole way. Gating on it meant the star kept whatever ratio it was built
      // with (the pre-probe 1.0) for the entire visible journey, which on a dpr 2.5 panel is 40 % of
      // the display's density on the site's centrepiece, for the whole session.
      //
      // What must block a reallocation is an AUTHORED beat — the state ramps and the shard flight —
      // because those advance behind a stall and land in the wrong place, exactly like the works hop.
      // The idle turn is delta-timed and constant; losing a frame of it cannot be seen.
      //
      // ⚠ Still no grace period, unlike the two heavy scenes. Those draw continuously and can go a
      // whole lap without a clear frame, so they have to take the hitch eventually. This one settles
      // between every beat, so a clear frame always arrives on its own.
      // ⚠ THE ALLOCATOR'S NUMBER ARRIVES THROUGH HERE, AND THE WINDOW IT USES IS NARROW. It is set at
      // the end of the burn-in's phase B; the assembly is cued later, from the finale timeline, after
      // the gate opens and the wordmark resolves. The frames in between are DRIFT frames — and drift
      // no longer counts as choreography (see `driftActive`), so this fires in them. If the assembly
      // were ever cued closer to `BURN_IN_DONE_EVENT`, the flight would run at the old ratio and snap
      // to the new one on landing: a sharpness pop on the centrepiece, at the handoff.
      if (sunPixelRatio() !== appliedPixelRatio && !choreographyActive) applySize();

      profileSpan('sun · loop', profileNow() - loopStartedAt);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      observer.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener(HERO_SERVICES_PROGRESS_EVENT, onHeroServicesProgress);
      window.removeEventListener(HANDOFF_PROGRESS_EVENT, onHandoffProgress);
      window.removeEventListener(CHAMBER_PROGRESS_EVENT, onChamberProgress);
      window.removeEventListener(BLACK_STAGE_EVENT, onBlackStage);
      window.removeEventListener(LOOP_RESET_EVENT, onLoopReset);
      window.removeEventListener(SUN_REGATHER_EVENT, onRegather);
      window.removeEventListener(REVEAL_EVENT, onReveal);
      window.removeEventListener(SUN_DRAW_PERMIT_EVENT, permitDrawing);
      window.removeEventListener(SUN_ASSEMBLE_EVENT, cueAssembly);
      if (introHeartbeatListener) {
        window.removeEventListener(INTRO_ACTIVE_EVENT, introHeartbeatListener);
      }
      window.clearTimeout(cueFallbackTimer);
      modelRoot?.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      sunParticles?.dispose();
      plasma?.dispose();
      bloom.dispose();
      environmentTexture.dispose();
      pmrem.dispose();
      // The Draco loader is shared and page-lifetime now — disposing it here would terminate the
      // decoder workers the fleet, the chamber and the contact star are still using. See
      // lib/modelLoading.ts.
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="sun-canvas" />;
}
