'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  REVEAL_EVENT,
  SUN_ASSEMBLE_EVENT,
  SUN_ASSEMBLED_EVENT,
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
import { CHAMBER_PROGRESS_EVENT, readChamberProgress } from '@/lib/chamberEvents';
import { CONTACT_PROGRESS_EVENT, readContactProgress } from '@/lib/contactEvents';
import { createSunParticles } from './sunParticles';

// The shared sun — the real fractured_sun model, replacing the procedural plasma shader.
//
// This is the same sun authored in /sun-lab, so its presets can eventually drive the page as it scrolls
// (peaceful → cracks → collapse → singularity). The numbers below ARE the lab's "Peaceful" preset; keep
// them in step with `sunLabPresets.ts` rather than drifting a second copy of the look.
//
// It also ASSEMBLES, and that assembly is the loader's finale: when the load hits 100% the ten fracture
// shards sweep in from outside the frame and lock together, the star lights inside the closing shell, and
// only then does the intro hand over. See the assembly section below.

const MODEL_PATH = '/models/fractured_sun.glb';
const DRACO_DECODER_PATH = '/draco/';

// ── The lab's "Peaceful" preset ──
const MODEL_ROTATION = { x: 5, y: 106, z: -59 };
// Imported, NOT copied: the hero HUD's "orbital vector" readout displays this exact rate so the
// telemetry reads as synced to the sun. Hard-coding the lab's 16 deg/s here would spin the sun 2.6x
// faster than the number on screen claims. One source of truth, so they cannot drift.
const AUTO_ROTATE_DEGREES_PER_SECOND = VECTOR_DEG_PER_SECOND;
const FLARE_SPIN_DEGREES_PER_SECOND = 15;
/**
 * The magma's glow.
 *
 * This was raised to compensate for having no bloom pass — that reason is now GONE (see `sunBloom`),
 * so the hero sun is running a Cracks-level emissive through a bloom it was tuned without. If the
 * calm hero star reads too hot, this is the first number to pull down: the lab's Peaceful stage
 * leaves magma at the model's own default and lets bloom do the work, and 2.4 is the value its
 * CRACKS stage authors.
 */
const MAGMA_EMISSIVE = 2.4;
const EXPOSURE = 1.42;
const ENV_INTENSITY = 1.77;
const KEY_COLOR = 0xfff4e0;
const KEY_INTENSITY = 2.7;
const FILL_COLOR = 0x2a3550;
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
const MAX_FRAME_SECONDS = 0.05;

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
 * How far outside the visible frame the shards begin, as a multiple of the frame's own half-height at
 * their depth.
 *
 * Above 1 they start CLIPPED, which is the whole point: you never catch a piece appearing, it is simply
 * already sweeping in when it crosses the edge. Above ~1.42 clears the frame's corners too, so a shard
 * entering on a diagonal is hidden as reliably as one entering on an axis.
 */
const ASSEMBLY_ENTRY_MARGIN_MIN = 1.45;
/**
 * The furthest out any shard starts. Spreading the margin across a range staggers the entries — the
 * nearest piece edges into frame early, the furthest arrives last — instead of ten pieces crossing the
 * border on the same frame.
 */
const ASSEMBLY_ENTRY_MARGIN_MAX = 2.6;

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
 * When to start on our own if no cue ever arrives — measured from PAGE LOAD, not from mount.
 *
 * Only a backstop for an intro that never reaches its gate. It sits past the intro's own 12s asset
 * timeout so the two can't race; the normal no-intro case is handled immediately by INTRO_MARKER_SELECTOR
 * instead of by waiting this out.
 */
const ASSEMBLE_CUE_FALLBACK_MS = 14000;
/** An element only the loader renders — its presence means a cue is coming, so wait for it. */
const INTRO_MARKER_SELECTOR = '.intro-o-slot';

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

// ── Services: the lab's "Cracks" stage ──
// The sun's SECOND state, and the next beat of the site's spine (peaceful → cracks → collapse →
// singularity). Every number here mirrors CRACKS_STATE in `sunLabPresets.ts` — keep them in step
// rather than drifting a second copy of the look.
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
// The star the works section is lit by. Every number mirrors COLLAPSE_STATE in `sunLabPresets.ts` —
// keep them in step rather than drifting a second copy of the look.
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
   * when the star cracks open. Same construction as the lab's `computeCellSpread`, so the site and
   * `/sun-lab` open the shell identically.
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
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_DEVICE_PIXEL_RATIO));
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

    // Bloom — the lab's "Peaceful" glow, on a transparent canvas.
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

    // ── Sizing ──
    let forceRender = true;
    /**
     * The half-extent the particle rings are measured against: the SMALLER of the frame's half-width
     * and half-height, so a ring stays inside the canvas on a portrait aspect too. (Half-width is
     * half-height × aspect, so anything under 1:1 is the limiting dimension.)
     */
    const particleFrameExtent = () =>
      frameHalfHeightAtSun * Math.min(1, camera.aspect || 1);
    const applySize = () => {
      const width = canvas.clientWidth || canvas.offsetWidth;
      const height = canvas.clientHeight || canvas.offsetHeight;
      if (!width || !height) return;
      renderer.setSize(width, height, false);
      // The bloom's targets follow the canvas, or the glow is sampled at the wrong scale.
      bloom.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      // Re-fit the rings to the new frame — this is what keeps them from clipping on resize.
      sunParticles?.setFrameExtent(particleFrameExtent());
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
    let covered = false;
    // The two spans that decide it, kept apart because they say opposite things: the reveal hides the
    // star, and the return brings it back to die.
    let revealProgress = 0;
    let returnProgress = 0;
    const applyCovered = () => {
      const wasCovered = covered;
      // ⚠ The return VETOES the reveal, and this is not a tidy-up to fold into one comparison. The
      // reveal's progress stays pinned at 1 for the whole of the chamber AND the return, so on its own
      // it would keep the star frozen through the one beat it actually has to perform. Contact is where
      // it dies; a frozen star cannot die.
      covered = revealProgress >= SUN_COVERED_CHAMBER_PROGRESS && returnProgress <= 0;
      // Uncovering has to draw again: the sun stopped redrawing while it was hidden, so without this
      // scrolling back out of the room would reveal the stale frame it froze on.
      if (wasCovered && !covered) forceRender = true;
    };
    const onChamberProgress = (event: Event) => {
      revealProgress = readChamberProgress(event);
      applyCovered();
    };
    const onContactProgress = (event: Event) => {
      returnProgress = readContactProgress(event);
      applyCovered();
    };
    window.addEventListener(CHAMBER_PROGRESS_EVENT, onChamberProgress);
    window.addEventListener(CONTACT_PROGRESS_EVENT, onContactProgress);

    // ── Assembly ──
    // A one-shot flight, cued when the load reaches 100%. The dust carries the wait; this is the reward
    // for it ending, so it runs on its own clock and the intro holds its handoff until it finishes.
    // Gates more than the assembly, despite living here: it also kills the cracks' breathing pulse,
    // drops the orbital ring entirely, and snaps the state ramp instead of easing it.
    const reduceMotion = prefersReducedMotion();
    let assembly = 0;
    let modelReady = false;
    let assemblyCued = false;
    let forceAssembled = false;
    const cueAssembly = () => {
      assemblyCued = true;
    };
    // The intro cues this when the load hits 100%, and holds its own handoff until we answer with
    // SUN_ASSEMBLED_EVENT — so the flight is the loader's finale and is always watched start to finish.
    window.addEventListener(SUN_ASSEMBLE_EVENT, cueAssembly);
    // With no loader on the page there is no cue coming, so assemble as soon as the model lands. Checking
    // the DOM rather than listening for INTRO_ACTIVE_EVENT because this canvas is dynamically imported
    // and mounts well after the intro has already announced itself — the event would be long gone.
    const introOnPage = document.querySelector(INTRO_MARKER_SELECTOR) !== null;
    if (!introOnPage) cueAssembly();
    // Ultimate safety net: an intro that is on the page but never reaches its gate (a stalled asset it
    // gives up on at 12s) must not leave the sun in pieces forever.
    const cueFallbackTimer = window.setTimeout(
      cueAssembly,
      Math.max(0, ASSEMBLE_CUE_FALLBACK_MS - performance.now()),
    );
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

      shards.forEach(({ object, home, homeQuaternion, far, depth, tumble, phase }) => {
        const distance =
          1 / THREE.MathUtils.lerp(1 / (cameraDistance + depth), 1 / cameraDistance, arrival);
        const travelling = (distance - cameraDistance) / depth;
        // Drift and tumble stay on the eased clock, not on `travelling` — `travelling` collapses early
        // by design now, and hanging the float off it would stop the pieces moving well before they land.
        const drift = receding * ASSEMBLY_FLOAT * shardRadius;
        object.position.set(
          home.x + far.x * travelling + Math.sin(time * ASSEMBLY_FLOAT_SPEED + phase) * drift,
          home.y + far.y * travelling + Math.cos(time * ASSEMBLY_FLOAT_SPEED * 0.8 + phase) * drift,
          home.z + far.z * travelling + Math.sin(time * ASSEMBLY_FLOAT_SPEED * 1.2 + phase) * drift,
        );
        object.quaternion.slerpQuaternions(tumble, homeQuaternion, arrival);
      });
    };

    /**
     * Open the shell into the Cracks pose. Same construction as the lab's `positionShardsAt`: each
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

    // ── Load ──
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    let disposed = false;
    gltfLoader.load(MODEL_PATH, (gltf) => {
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
      modelRoot.traverse((object) => {
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

      // Put the model's centre ON the spinner's axis.
      //
      // Without this the idle spin does not turn the sun in place, it ORBITS it: spinner.rotation.y turns
      // about the world origin and the model's content is centred 0.174 units off it, which swings the
      // sun ±11px sideways over each 58-second turn. That slow drift is what reads as "not centred" —
      // the sun is only in the middle twice per minute.
      //
      // Measured in world space (Box3 always is) and converted back into the spinner's frame, because the
      // spinner has already been turning for however long the model took to download.
      spinner.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(modelRoot);
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      const centre = box.getCenter(new THREE.Vector3());
      spinner.worldToLocal(centre);
      modelRoot.position.sub(centre);

      // Frame it. The shards' entry points are expressed in terms of the visible frame — they have to
      // start outside it — so the camera has to be placed before they can be built.
      //
      // Panning (moving the camera and its aim point together) rather than rotating, so the sun shifts
      // across the frame without the perspective skewing.
      //
      // The nudge is not zero because the model is not visually symmetric about its own bounding box: the
      // big `sunouter` glow sphere sits at x≈0 while the fractured cells sit at x≈-0.25, so the bright
      // halo — which is what actually reads as the sun — sits right of the geometric centre the box
      // gives us. SUN_FRAMING_NUDGE_X corrects for that, and the dust reads the same constant.
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
        // Centred on the VISIBLE star, not on the model's geometric origin. The camera is panned by
        // SUN_FRAMING_NUDGE_X because the bright halo sits off the bounding box's centre, so the
        // thing that reads as the sun is at x = panX. Rings left at the origin would orbit a point
        // 5% of the frame off from the star they are supposed to be circling. The loader's dust
        // applies this same correction, for the same reason.
        sunParticles.object.position.x = panX;
        scene.add(sunParticles.object);
      }

      if (reduceMotion) {
        assembly = 1; // leave the shards home — no flight to reduce
        window.dispatchEvent(new Event(SUN_ASSEMBLED_EVENT)); // never make the intro wait for a flight
      } else {
        positionShards(0, 0); // parked off-frame, so the parts visibly travel in
      }
      modelReady = true; // the one-shot assembly starts on the next frame after the cue
      applySize();
      forceRender = true;
    });

    // ── Render loop ──
    const clock = new THREE.Clock();
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
    const animate = () => {
      animationFrame = requestAnimationFrame(animate);
      const delta = Math.min(clock.getDelta(), MAX_FRAME_SECONDS);

      // Ease our own copy of the scrubbed targets, so the choreography can't be outrun by a fast
      // flick and never steps between the pin's ticks and our own frames.
      const stateEase = reduceMotion ? 1 : 1 - Math.exp(-STATE_EASE_RATE * delta);
      cracks += (targetCracks - cracks) * stateEase;
      ringForm += (targetRingForm - ringForm) * stateEase;
      ringWorksForm += (targetRingWorks - ringWorksForm) * stateEase;
      collapse += (targetCollapse - collapse) * stateEase;
      const elapsed = clock.getElapsedTime();
      // The star always turns; it only stops once the works field has covered it completely.
    const moving = !covered;

      // Assembly: a one-shot flight in from deep space, run once the model is here AND the intro has
      // put the "o" on screen — whichever of those two lands last.
      let assembling = false;
      if (modelReady && assemblyCued && assembly < 1) {
        const rate = (forceAssembled ? ASSEMBLY_REVEAL_SPEEDUP : 1) / ASSEMBLY_SECONDS;
        // Checked before the increment, so the frame that reaches exactly 1 still places the pieces —
        // they land on their true home rather than a fraction short of it.
        assembly = Math.min(1, assembly + delta * rate);
        positionShards(assembly, elapsed);
        assembling = true;
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
      const animating =
        Math.abs(targetCracks - cracks) > STATE_SETTLE_EPSILON ||
        Math.abs(targetRingForm - ringForm) > STATE_SETTLE_EPSILON ||
        Math.abs(targetRingWorks - ringWorksForm) > STATE_SETTLE_EPSILON ||
        Math.abs(targetCollapse - collapse) > STATE_SETTLE_EPSILON ||
        moving ||
        assembling;
      if (!document.hidden && (animating || wasAnimating || forceRender)) {
        bloom.render(scene, camera);
        forceRender = false;
      }
      wasAnimating = animating;
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
      window.removeEventListener(CONTACT_PROGRESS_EVENT, onContactProgress);
      window.removeEventListener(REVEAL_EVENT, onReveal);
      window.removeEventListener(SUN_ASSEMBLE_EVENT, cueAssembly);
      window.clearTimeout(cueFallbackTimer);
      modelRoot?.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
      sunParticles?.dispose();
      bloom.dispose();
      environmentTexture.dispose();
      pmrem.dispose();
      dracoLoader.dispose();
      renderer.dispose();
    };
  }, []);

  return <canvas ref={canvasRef} className="sun-canvas" />;
}
