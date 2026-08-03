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
import { createStoneMaterial } from '../meteorMaterial';
import { getWorksTuning } from '../worksTuning';
import { WORKS_PROJECTS } from '../worksProjects';
import { MARK_CHANGE_SECONDS } from '../worksTransition';
import { prepareMarks } from '../prepareMarks';
import { createAccretionMark } from '../transitions/accretionTransition';
import type { MarkTransitionStrategy } from '../transitions/markTransition';
import { createSpacePresentMaterial } from '@/lib/spacePresentMaterial';
import { CHAMBER_PROGRESS_EVENT, readChamberProgress } from '@/lib/chamberEvents';
import { CONTACT_PROGRESS_EVENT, readContactProgress } from '@/lib/contactEvents';
import { LOOP_PROGRESS_EVENT, LOOP_RESET_EVENT, readLoopProgress } from '@/lib/loopEvents';
// The chamber belongs to its own section, but it is drawn by THIS renderer — a GPU texture cannot
// cross a WebGL context, and the space it displays is rendered here. So the works field hosts it.
import { createChamberScene, type ChamberScene } from '@/components/sections/Chamber/chamberScene';
// Hosted here for the same reason the chamber is: it has to be drawn by THIS renderer. The chamber
// because a GPU texture cannot cross a context; the star because lensing can only bend what is already
// in this framebuffer. See docs/contact-singularity-plan.md §3.
import {
  createSingularityScene,
  CONTACT_BLOOM_STRENGTH,
  type SingularityScene,
} from '@/components/sections/Contact/singularityScene';
import { hideHologram } from '@/lib/hologramPose';
import { publishSunParallaxPose, clearSunParallaxPose } from '@/lib/sunParallaxPose';
import { createWorksHud } from '../worksHud';
import {
  reportAssetProgress,
  reportWarmupDone,
  isStageQuiet,
  ASSETS_WARMUP_EVENT,
} from '@/lib/assetLoadProgress';
import { getPixelRatio, sampleFrame, reportProbedFrameCost } from '@/lib/adaptivePixelRatio';
import { measureGpuFrameCost } from '@/lib/gpuProbe';
import { warmSceneMaterials } from '@/lib/warmScene';
import { INTRO_MARKER_SELECTOR } from '@/components/effects/IntroSequence/introEvents';

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
const CHAMBER_SCRUB_END = 0.999; // past this you're standing in the room → let adaptive resolution resume
const CHAMBER_SMOOTHING = 0.09; // per-frame ease toward the scrubbed target, as the crossings all do

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
const METEOR_ARRIVE_PROGRESS_START = 0.8;  // handoff progress where the rock begins its approach
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
const SHARD_TINT        = 0x1c2530; // darker than the body so the mark reads as the subject
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
const KEY_LIGHT_COLOR      = 0xdfe7ff; // cool key so the stone reads blue-grey, not warm — this is
                                       // what makes the mark's amber geode read as heat
const KEY_LIGHT_INTENSITY  = 2.1;
const FILL_LIGHT_COLOR     = 0x2a3550;
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
const BLOOM_MSAA_SAMPLES = 4;

const MAX_FRAME_SECONDS = 0.05; // clamp dt so a tab-restore doesn't fling the animation
const LOW_POWER_MAX_WIDTH = 760;

export interface FieldStatus {
  isLoading: boolean;
  /** 0–100 while the textures stream in, 100 when the field is built. */
  percent: number;
}

interface FieldOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** The focused project — read live from the render loop / handlers via a ref. */
  activeIndex: number;
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

export function useWorksField({ canvasRef, activeIndex, onStatus }: FieldOptions) {
  // The render loop + handlers read the freshest focus through a ref, so the persistent setup
  // effect never re-runs when the active project changes.
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  // Set up inside the persistent effect; called from the selection effect below so a focus change
  // re-stages the existing scene instead of rebuilding it.
  const setFocusRef = useRef<(index: number) => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduceMotion = prefersReducedMotion();
    const lowPower =
      window.matchMedia('(pointer: coarse)').matches || window.innerWidth < LOW_POWER_MAX_WIDTH;

    // ── Renderer ──
    // ⚠ `antialias: false` is deliberate and is NOT a quality cut — see the same note on the fleet's
    // renderer. Every pixel here reaches the canvas through `screenComposer`, whose last pass is a
    // fullscreen quad, so a multisampled default framebuffer would be resolving a rectangle. The AA
    // that matters is `samples` on the two composer targets and the SMAAPass below.
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    // Shared adaptive resolution (drops under load, climbs back when smooth) — see applyRendererSize.
    renderer.setPixelRatio(getPixelRatio());
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
      samples: lowPower ? 0 : BLOOM_MSAA_SAMPLES,
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
    const tuning = getWorksTuning();
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
    // Resolved by id against whatever `prepareMarks` actually returned, because a mark whose file
    // failed to load is simply absent — matching by position would quietly shift every later project
    // onto its neighbour's logo, which looks like a content mistake rather than a load failure.
    // Filled in by buildMark; until then every project points at mark 0.
    let markIndexOfProject: number[] = WORKS_PROJECTS.map(() => 0);

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
      const marks = await prepareMarks();
      if (disposed || marks.length === 0) return;
      reportAssetProgress('works', WORKS_OUTLINES_DONE);

      markIndexOfProject = WORKS_PROJECTS.map((project) => {
        const found = marks.findIndex((mark) => mark.id === project.markId);
        return found >= 0 ? found : 0;
      });

      const strategy = await createAccretionMark(marks, {
        targetSize: tuning.markTargetSize,
        depth: tuning.markDepth,
        performanceTier: lowPower ? 'low' : 'high',
      });
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
      if (process.env.NODE_ENV === 'development') {
        const { buildMilliseconds, bufferBytes, perMarkBytes } = strategy.metrics;
        console.debug(
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

    const buildField = async () => {
      await buildMark();
      if (disposed) return;

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
    let lazyWarmupFrame = 0;
    const warmWhenIdle = (target: THREE.Object3D, targetCamera: THREE.Camera) => {
      lazyWarmupFrame = requestAnimationFrame(() => {
        if (disposed) return;
        warmSceneMaterials(renderer, target, targetCamera);
      });
    };

    // ── The chamber (built lazily; see ensureChamber) ──
    let chamber: ChamberScene | null = null;
    let chamberReady = false;
    const ensureChamber = () => {
      if (chamber) return;
      chamber = createChamberScene({
        environment: scene.environment,
        onReady: () => {
          chamberReady = true;
          // The room's walls, ground grid, plinth, display shader and the table's maps — none of which
          // exist on the GPU until something draws them, and the first thing that does is the reveal.
          if (chamber) warmWhenIdle(chamber.scene, chamber.camera);
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
    const ensureSingularity = () => {
      if (singularity) return;
      singularity = createSingularityScene({
        pixelRatio: renderer.getPixelRatio(),
        lowPower,
        // The star, its rings, the accretion spiral and `black_hole.glb`'s maps all come into existence
        // hidden and stay that way until the return fades them up — so without this they would compile
        // and upload on the frame the camera swings back onto the star, which is the frame the whole
        // finale is built to deliver. Warmed through the SPACE scene, because that is where the group
        // now lives; recompiling the rest of it is cached and costs nothing.
        onReady: () => warmWhenIdle(scene, camera),
      });
      scene.add(singularity.group);
    };
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

    let warmupStarted = false;
    const warmUpField = async () => {
      if (warmupStarted || disposed) return;
      warmupStarted = true;
      // Restored in `finally`, not inline, so an early return on teardown or a throw mid-probe cannot
      // leave the works section running a pass it is supposed to have off.
      const smaaWasEnabled = smaaPass.enabled;
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
        drawWarmupFrame();

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
      } catch {
        // A failed compile is not a reason to trap the loader — the section degrades to compiling
        // whatever failed on first draw, exactly as it did before any of this existed.
      } finally {
        smaaPass.enabled = smaaWasEnabled;
        if (!disposed) reportWarmupDone('works'); // the intro holds the reveal until this fires
      }
    };

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
    let appliedPixelRatio = getPixelRatio();
    // The canvas's CSS size, which the chamber needs in full — not just as an aspect. Its display wears
    // the aspect (that's what makes the cover distance exact), and its hologram's anchor is projected
    // into these pixels (see lib/hologramPose.ts). Measured here rather than read off `window` on the
    // other side, so nothing has to assume the canvas fills the viewport.
    let viewportWidth = 1;
    let viewportHeight = 1;
    const applyRendererSize = () => {
      const width  = canvas.clientWidth  || canvas.offsetWidth;
      const height = canvas.clientHeight || canvas.offsetHeight;
      if (!width || !height) return;
      const aspect = width / height;
      const ratio = getPixelRatio();
      appliedPixelRatio = ratio;
      viewportWidth = width;
      viewportHeight = height;
      hud.setSize(width, height, ratio);
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      // Portrait → pull the camera back so the meteor doesn't overflow the narrow frame.
      distanceScale = aspect < 1 ? THREE.MathUtils.clamp(1 / aspect, 1, 1.9) : 1;
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
    const clock = new THREE.Clock();
    let frameId = 0;
    // Warp state — read from the camera's own speed each frame so the streaks + FOV follow the exact
    // launch/arrive curve of the travel tween (longer hops naturally streak harder).
    const previousCameraPosition = new THREE.Vector3();
    const streakDirection = new THREE.Vector3(0, 0, 1);
    let hasPreviousCameraPosition = false;
    let warp = 0;
    const renderFrame = () => {
      frameId = requestAnimationFrame(renderFrame);
      const deltaSeconds = Math.min(clock.getDelta(), MAX_FRAME_SECONDS);
      const elapsed = clock.elapsedTime;

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
        camera.position.copy(flightPose.cameraPosition).sub(meteorOffset);
        flightLookTarget.copy(flightPose.cameraTarget).sub(meteorOffset);
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
        feedTotal: WORKS_PROJECTS.length,
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
      if (isDrawing) {
        // Geometry AA follows the room, because the room is the only thing stage 2 ever draws that has
        // geometry. Toggling `enabled` is all this needs: EffectComposer recomputes which pass is the
        // last ENABLED one on every render, so `OutputPass` takes over drawing to the canvas by itself
        // whenever this is off. See the note where the pass is built.
        smaaPass.enabled = revealing;

        // Stage 1 into the texture, stage 2 out to the canvas. Never one without the other — the
        // screen pipeline paints whatever the space pipeline last produced.
        spaceComposer.render();
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
          // anchored in. Said out loud, because the chamber's `update` (the only thing that publishes a
          // pose) simply stops running here, and a stale pose would leave the panel hanging over the
          // meteor field looking perfectly valid.
          hideHologram();
        }
        screenComposer.render();
      }

      // ── Adaptive resolution: only ever re-sized while this scene is NOT being drawn ──
      // Same rule as the deck (see useServicesDeck). Applying a new pixel ratio reallocates the whole
      // composer (bloom pyramid + SMAA buffers) and blocks for a frame or more. It must NOT be hidden
      // behind motion: the warp hop between two meteors is a real-time tween, so a stall mid-hop makes
      // the camera skip straight to the far end — the hop reads as a freeze then a jump. So we only
      // ever do it on a genuinely idle frame: the field off screen (services / the fill) or the tab
      // backgrounded. Also frozen entirely through either crossing.
      if (!handoffActive && !revealScrubbing) {
        const targetRatio = getPixelRatio();
        if (targetRatio === appliedPixelRatio) {
          // In sync → measure this frame. Only frames we actually DREW, so idle frames can't fake
          // headroom and trick the controller into ramping the resolution up.
          if (isDrawing) sampleFrame(deltaSeconds);
        } else if (!isDrawing) {
          applyRendererSize();
        }
        // Else: a change is queued but we're on screen — hold it, and deliberately STOP sampling
        // until it lands, so the controller never measures at one ratio while believing it's at another.
      }
    };
    renderFrame();

    // ── Resize ──
    applyRendererSize();
    const resizeObserver = new ResizeObserver(applyRendererSize);
    resizeObserver.observe(canvas.parentElement ?? canvas);

    // No authoring surface: every value this scene runs on is a constant in `worksTuning.ts` and
    // `ACCRETION_TUNING`, edited in the file like any other. The panel that used to author them —
    // along with its free-fly camera and its mark rebuild — is in git if it is ever wanted back.

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener(HANDOFF_PROGRESS_EVENT, onHandoffProgress);
      window.removeEventListener(CHAMBER_PROGRESS_EVENT, onChamberProgress);
      window.removeEventListener(CONTACT_PROGRESS_EVENT, onContactProgress);
      window.removeEventListener(ASSETS_WARMUP_EVENT, onWarmupRequested);
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
