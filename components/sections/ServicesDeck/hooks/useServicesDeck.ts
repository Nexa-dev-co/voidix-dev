import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { detectKtx2Support, getSharedDracoLoader, getSharedKtx2Loader } from '@/lib/modelLoading';
import { isLowPowerDevice } from '@/lib/deviceTier';
import { createFrameTimer } from '@/lib/frameTimer';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { HANDOFF_PROGRESS_EVENT, readHandoffProgress } from '@/lib/handoffEvents';
import {
  SERVICES_ASSEMBLY_EVENT,
  readServicesAssembly,
} from '@/lib/servicesAssemblyEvents';
import { LOOP_RESET_EVENT } from '@/lib/loopEvents';
import { computeFlightPose, createFlightPose } from '@/lib/handoffFlightPath';
import { flightPullbackScale, flightRamp, portraitPullbackScale } from '@/lib/portraitPullback';
import { DECK_SERVICES, VESSEL_MODEL_PATH, VESSEL_MODEL_ROTATION } from '../deckServices';
import { DECK_REVEAL_EVENT, DECK_HIDE_EVENT } from '../deckEvents';
import { applyHullMaterials } from '../hullMaterial';
import { VESSEL_WAVE_COUNT } from '../vesselParts';
import {
  createVesselAssembly,
  resolveHoldingPoses,
  updateVesselAssembly,
  type VesselAssembly,
} from '../vesselAssembly';
import {
  reportAssetProgress,
  reportWarmupDone,
  isStageQuiet,
  ASSETS_WARMUP_EVENT,
} from '@/lib/assetLoadProgress';
import {
  getControllerFps,
  getPixelRatio,
  noteRatioApplied,
  RATIO_APPLY_GRACE_SECONDS,
  sampleFrame,
} from '@/lib/adaptivePixelRatio';
import {
  profileGauge,
  profileMeasure,
  profileNow,
  profileSpan,
} from '@/lib/frameProfiler';
import { telemetryEnabled } from '@/lib/telemetryEnabled';
import { INTRO_MARKER_SELECTOR } from '@/components/effects/IntroSequence/introEvents';
import { getDeckTuning } from '../deckTuning';
import { SLATE_600 } from '@/lib/coolPalette';
import { HEAT_600 } from '@/lib/heatPalette';

// ── Framing ─────────────────────────────────────────────────────────────
// The camera's pose is AUTHORED — it lives in deckTuning.ts and is pushed onto the scene every frame.
// Where the vessel's parts sit is not authored here either: a socket is baked into vessel.glb and a
// holding position is a fraction of the live frame (see vesselParts.ts / deckFrame.ts). Only the
// things that were never authored stay in this file.

// ── Starfield ───────────────────────────────────────────────────────────
const STAR_COUNT         = 1200;
const STAR_INNER_RADIUS  = 18;  // a spherical shell so stars wrap the scene without crowding the craft
const STAR_OUTER_RADIUS  = 60;
const STAR_SIZE          = 0.16;
const STAR_DRIFT         = 0.011; // radians/second of yaw drift — the "floating through space" feel

// ── The vessel ──────────────────────────────────────────────────────────
const TARGET_SIZE = 2.3;  // largest dimension the assembled hull is normalised to
const BASE_YAW    = -0.6; // resting 3/4 view so the hull doesn't read flat-on
const SHIP_HOVER  = 0.05; // resting height the vessel sits above the stage plane
/**
 * How far the craft drops, in world units, when the frame is taller than it is wide.
 *
 * ⚠ It is the SHIP that moves, never the camera and never the sun.
 *
 * ⚠ And the hull's screen position is NOT what its 2.3 normalisation suggests. The hull is normalised
 * on its LARGEST dimension, and on this vessel that is the WINGSPAN — so it is a wide flat thing whose
 * vertical extent is small and whose centre sits close to the stage plane, not a 2.3-tall tower
 * standing on it. At rest that puts the hull's centre a little BELOW the camera's 0.75 aim line.
 *
 * −0.35 lands it around 66% down: below the headline, above the keys and the stepper. This is the
 * number to retune if the framing wants adjusting — it is the only thing that moves the craft, and the
 * frame is ~2.5 world units from centre to edge, so 0.1 here is about 13px on a 780px phone.
 *
 * It is faded out across the handoff on `flightRamp`, because the flight's ship path is authored in
 * world coordinates: left standing, it would carry the sag all the way to the works field.
 */
const PORTRAIT_SHIP_DROP = -0.35;
const FLOAT_AMPLITUDE = 0.1;   // vertical hover bob (up + down) on the hull
const FLOAT_SPEED     = 1.1;
const AUTO_ROTATE_SPEED = 0.35; // radians/sec — slow showroom turntable spin

// ── Third-person flight idle (the parked/flying chase ship) ──
// A gentle weave layered on the ship while the flight is engaged, so the third-person chase reads as
// actively flying — banking + swaying — instead of a frozen pose. Ramped in by flight progress so
// normal browsing stays a calm turntable.
const FLIGHT_WEAVE_ROLL_AMP    = 0.11; // radians of banking roll
const FLIGHT_WEAVE_ROLL_SPEED  = 0.7;
const FLIGHT_WEAVE_PITCH_AMP   = 0.05; // radians of nose bob
const FLIGHT_WEAVE_PITCH_SPEED = 0.5;
const FLIGHT_WEAVE_SWAY_AMP    = 0.13; // world units of side-to-side drift
const FLIGHT_WEAVE_SWAY_SPEED  = 0.45;

// ── Lighting (shared stage rig) ──
const KEY_LIGHT_COLOR      = 0xfff2e2; // warm key so the hull reads with its own colour, not washed cold
const KEY_LIGHT_INTENSITY  = 2.4;      // directional → reveals the surface/normal detail
const FILL_LIGHT_COLOR     = SLATE_600; // neutral cool fill
const FILL_LIGHT_INTENSITY = 0.5;
const AMBIENT_INTENSITY    = 0.16;     // low so the directional key carves out contrast/texture
// ── The rim: the only light that is actually on ──
// It IS the sun. `--heat-600`, placed behind and above the stage — where the cracked sun in the DOM
// layer behind this canvas actually sits — so the edge it draws is the edge the sun would draw. On a
// hull whose albedo is 97% black with no shading in it, this and the shader's fresnel are between them
// the entire read of the ship's form. See the note in deckTuning.
const RIM_LIGHT_COLOR      = HEAT_600;
const RIM_LIGHT_INTENSITY  = 3.4;

// ── Powered-on look ──
// Each part wears the vessel skin (see hullMaterial.ts), which splits the albedo into HULL and TRIM by
// SATURATION — the texture is ~97% black with thin saturated circuit lines and carries no shading of
// its own, so the body is a constant dark metal and the lines are that wave's circuit colour. Trim
// level and hull brightness are driven per part by vesselAssembly: a loose part is cold and dim, a
// seated one warms up over the following stretch of scroll, and the whole hull surges at ignition.

// ── Selective bloom — BACK ON (2026-08-11), and the old reason for switching it off no longer holds ──
//
// It was disabled 2026-07-28, and the reason recorded was real for the fleet it was written about:
//
//   "with every stage light at 0 the ships are lit only by the cracked sun behind them, and blooming
//    their accents on top of that read as haze rather than as glowing engines."
//
// That is a judgement about BROAD accents spread over four mid-tone hulls. This vessel's emissive is
// thin circuit lines on a near-black hull, which is the one thing bloom is unambiguously good at — and
// the threshold does the discriminating for us: the hull and the rim light both sit far below it, so
// there is no large bright area for a halo to form over — and a halo over a large bright area is what
// haze actually is.
//
// ⚠ It remains the most expensive pass on the site and this is a real cost. It is affordable now for a
// reason that did not exist before: the deck is the CHEAPEST scene on the page (9 draw calls, 1,980
// triangles, one 30 KB model) rather than the four-hull, 5.15 MB section it used to be. If it ever
// reads as haze again, this constant is still the one line.
// ⚠ Pulled down hard on 2026-08-11 (strength 0.62 → 0.34) — the first pass was, in one word, "super
// bloomy". Three things were compounding: the strength itself, an over-eager threshold, and per-part
// `trimGlow` values that all came up to full the instant a part locked. All three moved; see also
// LOCKED_TRIM_LEVEL in vesselAssembly, which is what stops a part blooming AT the moment of contact.
const BLOOM_ENABLED        = true;
const BLOOM_STRENGTH       = 0.34;
const BLOOM_STRENGTH_LOW   = 0.22; // gentler on low-power devices
const BLOOM_RADIUS         = 0.38;
// ⚠ 1.15, not 0.7. This is what makes the bloom SELECTIVE rather than a glow filter: the hull and the
// rim light both land well below it, so only circuitry that has actually WARMED UP pushes past. A part
// at the instant it locks sits just underneath — which is the whole "it doesn't bloom right away".
const BLOOM_THRESHOLD      = 1.15;
/**
 * ⚠ NO MSAA ON THIS COMPOSER — because `SMAAPass` below is already doing the job.
 *
 * This was `4`, justified by a comment reading "antialias:true is ignored once a composer renders, so
 * SMAA is the only geometry AA on the final image". The first half is true. The conclusion was not:
 * the composer's TARGET carried `samples: 4`, three resolves a multisampled target automatically on
 * read, and the deck was therefore running true geometric MSAA **and then** a post-process edge pass
 * over the resolved result. Two antialiasers on one image, the second re-detecting edges the first had
 * already smoothed.
 *
 * Dropping the samples rather than the SMAA pass, because the memory is where the problem is.
 * `EffectComposer` CLONES the target it is handed and `RenderTarget.copy` carries `samples` across, so
 * every sample count is paid TWICE. On a 1512×982 panel at ratio 1:
 *
 *     samples 4   11.9 MB resolved + 47.5 MB MSAA colour + 23.8 MB MSAA depth  =  83 MB  × 2 targets
 *     samples 0   11.9 MB resolved                                             =  12 MB  × 2 targets
 *
 * ~142 MB back, and the edges are still antialiased — by the pass that was always there.
 *
 * ── Why this is 0 for EVERYONE, when the works field earns 4× ────────────────────────────────────
 * The works field raises its samples from a real measurement — `gpuProbe` runs inside its warm-up, so
 * by the time it decides, it knows. This hook has no such number: the probe is taken once, in that
 * hook, and `reportProbedFrameCost` deliberately ignores second callers so two scenes cannot argue.
 * Reading the works field's answer from here would work usually and not always, and antialiasing that
 * differs between two loads of the same page is worse than not having it. If MSAA is ever wanted here,
 * the honest way is to give this hook its OWN probe.
 *
 * ⚠ Whatever happens, this and the `SMAAPass` below must never both be on.
 */
const BLOOM_MSAA_SAMPLES = 0;

// ── The assembly scrub ──
// The hero pin publishes the build's progress; the render loop eases toward it every frame so the
// choreography stays smooth whether the visitor creeps, flicks, or a covered jump glides through.
//
// ⚠ THIS IS NOT THE TRAVEL TIME, and a previous revision of this comment claimed it was. The scrub
// target is NOT a step function: `useHeroAnimation` pins with `scrub: 1.8`, so pin progress already
// takes ~1.8 s to walk from one stop to the next, and this exponential ease (~0.6 s to settle) is a lag
// on top of a motion that is mostly over by the time it matters. Retuning it moves the total by a tenth
// of what the arithmetic suggests — which is exactly what happened when it went 0.12 → 0.08 to buy
// "50 % longer" and bought nearer 10 %.
//
// What actually sets the travel time is ASSEMBLY_WAVE_TRAVEL_SECONDS below. This is now only the soft
// landing at the end of it.
const ASSEMBLY_SMOOTHING = 0.08;
/**
 * How long one wave takes to fly in, in SECONDS — the real knob, and the only honest one.
 *
 * The follow below is speed-capped at `waveSpan ÷ this`, so a wave's travel takes at least this long no
 * matter how fast the scroll moved or how the pin's scrub is tuned. That is the property the exponential
 * ease could never give: with a plain ease the duration is a function of the scrub, so it changes
 * whenever anyone touches a constant in another file.
 *
 * ⚠ It is deliberately LONGER than `STAGE_STEP_HOLD_MS` (2,900 ms), so a determined visitor can start
 * the next step while the current wave is still seating. That is fine here and was not fine for the
 * portal swap this replaces: overlapping waves is what an assembly actually looks like, and every part
 * is a pure function of progress, so an interrupted wave cannot land wrong — it just keeps going.
 */
const ASSEMBLY_WAVE_TRAVEL_SECONDS = 3.6;
/**
 * Backlog, in waves, past which the speed cap gets out of the way.
 *
 * A navbar jump or a scroll-back can leave the eased value most of a build behind the scrub. Capped,
 * that would take fifteen seconds to reconcile; this is the point at which we stop pretending it is a
 * wave being built and let the ease catch up.
 */
const ASSEMBLY_CATCHUP_WAVES = 1.25;
/**
 * Longest frame the speed cap will honour, in seconds.
 *
 * ⚠ This loop's `frameTimer` is deliberately UNCLAMPED (see its note), so a tab-restore hands it the
 * whole backgrounded gap in one delta. Fed straight into the cap that would authorise a step of any
 * size — the one frame the cap exists to prevent — and the ship would snap together on the frame the
 * tab came back. Clamped only HERE, so the shared timer keeps the behaviour the rest of the loop
 * expects.
 */
const ASSEMBLY_MAX_STEP_SECONDS = 1 / 30;
/**
 * A beat of stillness when the section opens, before anything commits.
 *
 * You arrive on a stage of drifting parts and they should stay drifting for a moment — starting the
 * build on the same frame the deck appears gives the visitor nothing to arrive AT. Held on the eased
 * value only: the scrubbed target keeps tracking the scroll throughout, so this can delay the build but
 * can never desync it, and the catch-up on the far side is the ordinary ease.
 */
const ASSEMBLY_ENTRY_HOLD_MS = 700;

// ── Departure — the services → works flight (the vessel you just watched being built flies you in) ──
// Scrubbed by the hero pin via HANDOFF_PROGRESS_EVENT. The ship's motion + the camera come from the
// shared choreography in lib/handoffFlightPath.ts; here we own only the deck-local anchors: the sun
// STAYS put (the camera leaves it behind by moving) and the deck starfield fades out during the
// fly-left so the works field's streaking stars take over. Each value reverses cleanly when scrolled
// back.
const DECK_STAR_FADE_WINDOW: [number, number] = [0.30, 0.55]; // deck stars fade out during the fly-left
const DEPART_SMOOTHING = 0.09;   // per-frame ease toward the scrubbed target
const TURNTABLE_SETTLE = 0.12;   // how quickly the accumulated showroom spin settles for the flight
const DEPART_GRIP_SPAN = 0.25;   // handoff fraction over which the flight takes over the turntable

// ── Exit — the ship whooshes off-screen as the flight completes (scrubbed by handoff progress) ──
// Driven by the handoff progress itself, NOT a free time-based tween: so it can never desync from the
// scroll or be outrun. At progress 1 the ship is always fully gone, and scrolling back flies it
// cleanly on again.
const EXIT_PROGRESS_START = 0.88;
const EXIT_PROGRESS_END   = 1.0;
const EXIT_DELTA = new THREE.Vector3(-2, -3.5, 9); // dives down-left and PAST the camera → off-screen
const EXIT_SCALE_GAIN = 0.25; // a touch bigger as it powers past
// Fully parked at works browsing (handoff at 1): the ship has whooshed off-screen and the camera has
// tracked so far left (near x=−15) that the origin sits well outside its frustum — so the deck draws
// nothing. Stop paying for its bloom pipeline past this; it resumes the instant a scroll-back eases
// the handoff below 1.
const DECK_PARKED_THRESHOLD = 0.999;

// ── Heading — the nose points where the ship is actually going ──
// Yaw is derived from the ship's own per-frame velocity, so the nose tracks its travel: screen-left as
// it flies across, then toward the CAMERA as it dives off. (Pitch + bank stay authored from
// SHIP_ROTATION_KEYS.) Eased frame-rate-independently and speed-capped so a scroll-back reversal eases
// round instead of whipping.
const HEADING_SPEED_THRESHOLD = 0.006;
const HEADING_EASE_RATE       = 7;
const HEADING_MAX_RAD_PER_SEC = 8;
/**
 * `atan2(velX, velZ) + this` → nose parallel to travel.
 *
 * ⚠ TURNED 180° ON 2026-08-11 — that is what the trailing `+ Math.PI` is. The `2.0` datum was measured
 * empirically against the OLD FLEET ("depart.y ≈ 2.0 → nose screen-left") and this is a different ship
 * whose forward axis points the other way, so the vessel flew to Works showing its right flank while
 * travelling left, and its left flank travelling right. This is the calibration for THIS hull.
 *
 * ⚠ Fixed here rather than in `VESSEL_MODEL_ROTATION`, which is the other constant that could turn the
 * ship around, and which is where the plan expected the fix to land. It cannot go there: the holding
 * angles in `vesselParts.ts` are authored in FRAME space against the side each socket currently sits
 * on, so rotating the model 180° would move every socket across the centreline while leaving its
 * holding pose behind — and the mirror pairs would fly straight through each other on their way in.
 * A model-space flip would have to swap the hold angles in the same change.
 */
const HEADING_PHASE           = 2.0 + Math.PI / 2 + Math.PI;
const REST_BLEND_START = 0.0;
const REST_BLEND_END   = 0.12;

// ── Drag-to-rotate + flick ──
// A small drag on the vessel rotates it (springs back on release); a big horizontal flick switches the
// carousel via onFlick. Distances are in CSS pixels of pointer travel.
const DRAG_YAW_SENSITIVITY   = 0.006; // radians of yaw per pixel dragged
const DRAG_PITCH_SENSITIVITY = 0.004;
const DRAG_YAW_CLAMP         = 1.0;
const DRAG_PITCH_CLAMP       = 0.45;
const SPRING_DURATION        = 0.9;   // ease back to the resting view on release
const FLICK_DISTANCE_PX      = 110;   // horizontal travel past this (and horizontally dominant) = a switch

export interface DeckStatus {
  isLoading: boolean;
  /** 0–100 while loading, 100 when the vessel is in. */
  percent: number;
}

interface DeckOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** A horizontal flick on the vessel asks to switch stop: +1 = next, -1 = previous. */
  onFlick: (direction: number) => void;
  onStatus: (status: DeckStatus) => void;
}

// A spherical shell of faint points wrapping the scene — the "stars in the section". Additive so they
// glint against the black without lighting the craft.
function createStarfield(): THREE.Points {
  const positions = new Float32Array(STAR_COUNT * 3);
  for (let starIndex = 0; starIndex < STAR_COUNT; starIndex += 1) {
    // Random direction (uniform on the sphere) × a random radius within the shell.
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const radius = STAR_INNER_RADIUS + Math.random() * (STAR_OUTER_RADIUS - STAR_INNER_RADIUS);
    positions[starIndex * 3]     = radius * Math.sin(phi) * Math.cos(theta);
    positions[starIndex * 3 + 1] = radius * Math.cos(phi);
    positions[starIndex * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0xffffff,
    size: STAR_SIZE,
    sizeAttenuation: true,
    transparent: true,
    opacity: getDeckTuning().starOpacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}

export function useServicesDeck({ canvasRef, onFlick, onStatus }: DeckOptions) {
  // Latest onFlick, so the drag handlers (set up once, in a `[]` effect) always call the current
  // closure rather than the one captured on mount.
  const onFlickRef = useRef(onFlick);
  onFlickRef.current = onFlick;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduceMotion = prefersReducedMotion();
    // The lighter path: keeps clearcoat/iridescence and strong bloom off the devices least able to
    // afford them. One authority for it — see lib/deviceTier.ts.
    const lowPower = isLowPowerDevice();

    // The authored stage: camera and rig intensities.
    const tuning = getDeckTuning();

    // ── Renderer ──
    // ⚠ `antialias: false` is deliberate and is NOT a quality cut. Everything here draws through an
    // EffectComposer, and a composer's final pass is a fullscreen quad — so the multisampled default
    // framebuffer that `antialias: true` allocates has no geometry edges to resolve. The real AA is
    // the SMAAPass below.
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    // Which compressed texture formats this GPU accepts. Must happen before any KTX2 model loads —
    // the loader throws rather than guessing. See lib/modelLoading.ts.
    detectKtx2Support(renderer);
    renderer.setPixelRatio(getPixelRatio());
    if (telemetryEnabled) renderer.info.autoReset = false;
    // Neutral tone mapping holds the hull colours instead of desaturating highlights the way ACES
    // does. OutputPass applies this after the composer.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = tuning.exposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(tuning.cameraFov, 1, 0.1, 100);
    // Re-applied every frame from the tuning rather than once at build: it keeps the authored stage and
    // the animated state on one code path, and all of it is plain property writes.
    const applyCameraFromTuning = () => {
      camera.position.set(0, tuning.cameraHeight, tuning.cameraDistance);
      camera.lookAt(0, tuning.cameraLookY, 0);
      if (Math.abs(camera.fov - tuning.cameraFov) > 0.001) {
        camera.fov = tuning.cameraFov;
        camera.updateProjectionMatrix();
      }
    };
    applyCameraFromTuning();

    // Image-based lighting gives the metal real reflections without shipping an HDR.
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnvironment = new RoomEnvironment();
    scene.environment = pmremGenerator.fromScene(roomEnvironment, 0.04).texture;

    // Warm key + neutral fill + a rim that traces the hull's edge. All at intensity 0 through the
    // tuning's multipliers (see deckTuning) — they exist so the stage CAN be lit, not because it is.
    const keyLight = new THREE.DirectionalLight(KEY_LIGHT_COLOR, KEY_LIGHT_INTENSITY);
    keyLight.position.set(4, 7, 5);
    const fillLight = new THREE.DirectionalLight(FILL_LIGHT_COLOR, FILL_LIGHT_INTENSITY);
    fillLight.position.set(-6, -1, 2);
    // Behind and above, which is where the sun is. Steeply back (−z) so the light rakes across the
    // silhouette rather than filling the faces the camera can see.
    const rimLight = new THREE.DirectionalLight(RIM_LIGHT_COLOR, RIM_LIGHT_INTENSITY);
    rimLight.position.set(-2.5, 5, -9);
    const ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
    scene.add(keyLight, fillLight, rimLight, ambientLight);

    // ── Post-processing ──
    // HalfFloat keeps the bloom precise — it must bleed on HDR values, before the tone curve compresses
    // them. No MSAA: the SMAA pass at the end of this chain is the antialiasing, and running both is
    // the bug BLOOM_MSAA_SAMPLES describes.
    const composerTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: BLOOM_MSAA_SAMPLES,
    });
    const composer = new EffectComposer(renderer, composerTarget);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(1, 1),
      lowPower ? BLOOM_STRENGTH_LOW : BLOOM_STRENGTH,
      BLOOM_RADIUS,
      BLOOM_THRESHOLD,
    );
    bloomPass.enabled = BLOOM_ENABLED;
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    const smaaPass = new SMAAPass();
    composer.addPass(smaaPass);

    // ── Starfield ──
    const starfield = createStarfield();
    const starfieldMaterial = starfield.material as THREE.PointsMaterial;
    scene.add(starfield);

    // ── The vessel's rig ──
    // depart → lift → { spin, parts }. `depart` owns the services→works departure scrub (identity
    // outside the handoff) and `lift` owns the hover height and the float bob. `spin` and `parts` are
    // SIBLINGS — see vesselAssembly.ts for why the hull's yaw must not reach a part that is still
    // adrift.
    //
    // ⚠ One level shorter than the fleet's rig, which opened with a `stage` group. That existed for the
    // carousel's fly-on/off and then for the portal swap's flight into a gate; with one vessel nothing
    // writes to it, and a pass-through group in a rig is the kind of thing the next person tries to
    // drive something with.
    const depart = new THREE.Group();
    const lift   = new THREE.Group();
    lift.position.y = SHIP_HOVER;
    depart.add(lift);
    scene.add(depart);

    let assembly: VesselAssembly | null = null;
    let hullMaterials: THREE.Material[] = [];

    // ── The assembly scrub ──
    // The build's progress, 0..1 across the four waves. `current` eases toward `target` every frame so
    // a flicked scroll still reads as parts flying rather than as parts teleporting.
    const assemblyState = { target: 0, current: 0 };
    /** `performance.now()` before which the eased value does not advance — see ASSEMBLY_ENTRY_HOLD_MS. */
    let assemblyHoldUntil = 0;
    /**
     * Whether the section has ever actually been on screen.
     *
     * ⚠ Without this the arrival beat does nothing. The render loop runs through the whole hero fill
     * with the draw gated off, so the eased value tracks the scrub the entire way down — and wave 1
     * rides the FILL, which means the frame was already fully assembled by the time the deck first
     * appeared. Holding the build at 0 until the deck has been revealed once is what lets the visitor
     * watch it happen instead of arriving after it.
     */
    let hasRevealedDeck = false;
    const onAssemblyProgress = (event: Event) => {
      assemblyState.target = readServicesAssembly(event);
    };
    window.addEventListener(SERVICES_ASSEMBLY_EVENT, onAssemblyProgress);

    // Gate the expensive draw to when the deck is actually on screen. The deck reveals on
    // DECK_REVEAL_EVENT (fill → vessel) and hides back on DECK_HIDE_EVENT; it stays on screen through
    // the whole services → works handoff (the ship flies you in). The render loop keeps running
    // regardless — we skip only the composer draw — so the assembly scrub stays perfectly live, and the
    // first frame after it reveals is already in pose.
    //
    // ⚠ There is no entrance to replay any more. The old fleet re-ran a portal swap on every
    // DECK_REVEAL_EVENT because a hard cut between two models needed hiding. The vessel's entrance is
    // wave 1 arriving, which is a pure function of scroll position — so scrolling away and back simply
    // lands on whatever the scrollbar says, correctly, with no cue to fire.
    let deckShouldRender = false;
    const showDeck = () => {
      deckShouldRender = true;
      // The arrival beat. Re-armed on every entry, so scrolling back into services always gives you the
      // swarm before the build rather than a ship already mid-assembly.
      if (!reduceMotion) assemblyHoldUntil = performance.now() + ASSEMBLY_ENTRY_HOLD_MS;
      hasRevealedDeck = true;
    };
    const hideDeck = () => { deckShouldRender = false; };
    window.addEventListener(DECK_REVEAL_EVENT, showDeck);
    window.addEventListener(DECK_HIDE_EVENT, hideDeck);

    // ── Departure state (the services → works handoff) ──
    // The hero pin scrubs the raw target; the render loop eases toward it every frame, so the
    // choreography stays smooth whether the user creeps, flicks, or the snap glides through.
    // `engaged` keeps the scrub's writes off the rig entirely until the handoff is first touched, and
    // hands the rig back to the idle systems once it has fully reversed out.
    const departState = { target: 0, current: 0, engaged: false };
    // Reusable output for the shared flight choreography — filled each engaged frame, never allocated
    // in the render loop.
    const flightPose = createFlightPose();
    // Heading state: the eased yaw the nose points, plus last position to measure velocity from.
    const prevShipPosition = new THREE.Vector3();
    let hasPrevShipPosition = false;
    let headingYaw = 0;
    const onHandoffProgress = (event: Event) => {
      departState.target = readHandoffProgress(event);
      departState.engaged = true;
    };
    window.addEventListener(HANDOFF_PROGRESS_EVENT, onHandoffProgress);

    // ── Rotation state ──
    // The showroom turntable and the drag are kept apart so they can compose onto `spin` every frame.
    // Writing either straight onto `spin.rotation` would make the other one's value unreadable — and
    // the flight needs to settle the turntable specifically, without cancelling a drag spring.
    let turntableYaw = 0;
    const dragRotation = { yaw: 0, pitch: 0 };

    // ⚠ The teleport at the bottom of the loop throws the scrollbar to the top under cover of the black
    // hole's own shadow. Everything that EASES toward a target has to be told to stop easing and BE
    // there now, or the ship visibly un-builds itself behind the cream hero while the visitor is
    // looking at it. Registered here, below every value it touches, rather than beside the assembly
    // scrub it is mostly about — the listener reads five separate pieces of eased state and all of them
    // have to exist first.
    const onLoopReset = () => {
      assemblyState.target = 0;
      assemblyState.current = 0;
      assemblyHoldUntil = 0;
      hasRevealedDeck = false;
      departState.target = 0;
      departState.current = 0;
      departState.engaged = false;
      hasPrevShipPosition = false;
      headingYaw = 0;
      turntableYaw = 0;
      depart.position.set(0, 0, 0);
      depart.rotation.set(0, 0, 0);
      depart.scale.setScalar(1);
    };
    window.addEventListener(LOOP_RESET_EVENT, onLoopReset);

    // ── Warm-up: build every program and allocate every buffer while the deck is off screen ──
    //
    // Two beats, ONE PER FRAME. `compileAsync` is not a free ride: it runs `renderer.compile()`
    // SYNCHRONOUSLY before it awaits anything, so program creation and uploads still block — only the
    // wait for the driver to finish linking is offloaded. And the `composer.render()` after it is the
    // more expensive half anyway, because that is where the composer's two full-resolution targets are
    // ALLOCATED.
    //
    // Both are GPU-process work, and while the GPU process is busy the compositor cannot present
    // anyone's frames — including the loader's worker-rendered dust. Given a frame each they are two
    // short hitches rather than one long one.
    //
    // ⚠ Run when the VESSEL is in (see emitStatus), not when the whole page has finished downloading.
    // ASSETS_WARMUP_EVENT remains as a backstop; `warmupStarted` makes the two idempotent.
    let disposed = false;
    let warmupStarted = false;
    let warmupFrame = 0;
    /** Program cache keys present at the end of the warm-up — see the diagnostic below. */
    let warmedProgramKeys: Set<string> | null = null;
    /** Latches after the first drawn frame has been compared against them. */
    let programDiffReported = false;
    const nextWarmupFrame = () =>
      new Promise<void>((resolve) => {
        warmupFrame = requestAnimationFrame(() => resolve());
      });
    const prewarmPipeline = async () => {
      if (warmupStarted || disposed) return;
      warmupStarted = true;
      try {
        // Out of the caller's tick first — this is reached from inside a GLTFLoader `onLoad`, straight
        // after a Draco decode and a full material re-skin. `compileAsync` runs `renderer.compile()`
        // synchronously, so without this it stacks on top of that rather than getting its own frame.
        await nextWarmupFrame();
        if (disposed) return;

        await renderer.compileAsync(scene, camera);
        if (disposed) return;
        await nextWarmupFrame();
        if (disposed) return;
        // Forces the bloom + SMAA passes to compile, and — the expensive part — allocates the
        // composer's targets, so neither lands on the frame the vessel is first revealed.
        composer.render();

        // ── ⚠ DIAGNOSTIC: did this warm-up actually cover the frame the reveal will draw? ──
        //
        // A Chrome trace of the hero → services boundary once found a 69 ms task blocked inside
        // `getProgramInfoLog` — a shader program being LINKED on the deck's first real render despite
        // everything above. The cause was the portal gates' POINT LIGHTS: the warm-up opened the gates,
        // so everything compiled with two point lights in the scene, and the first real frame drew with
        // zero. three keys programs on the COUNT of visible lights (`WebGLPrograms.js`), so every
        // program missed.
        //
        // ⚠ The gates are gone (2026-08-11) and the point lights went with them, which removes the
        // cause — and makes this instrument MORE useful, not less: it is now the check that no new
        // light-count difference has crept in between the warm-up and the first drawn frame. It should
        // report `added NONE` on every load.
        //
        // Gated on telemetry: three's cache keys are long concatenations of every program parameter, so
        // holding ~9 of them for the whole session is pointless in a build that can never print them.
        if (telemetryEnabled) {
          warmedProgramKeys = new Set(
            (renderer.info.programs ?? []).map((program) => program.cacheKey),
          );
        }
      } catch {
        // A failed compile is not a reason to trap the loader; whatever failed compiles on first draw.
      } finally {
        if (!disposed) reportWarmupDone('deck'); // the intro holds the reveal until this fires
      }
    };
    // ── When it runs: BOTH the vessel itself AND a quiet loader ──
    // Own-assets-in keeps this off the tail of the page's last byte. The quiet-stage half is what keeps
    // it off the loader's wordmark: five Syne 800 glyphs at up to 256 px animating through an overshoot
    // is the most expensive thing the loader draws, and a compile landing on it is visible.
    //
    // `stageQuiet` starts TRUE when no loader is on the page — under reduced motion the intro skips its
    // timeline and never dispatches, so waiting on it would mean never warming. Read from the DOM
    // because this hook is behind a dynamic import and mounts after INTRO_ACTIVE_EVENT has gone.
    let vesselIn = false;
    let stageQuiet =
      isStageQuiet() || document.querySelector(INTRO_MARKER_SELECTOR) === null;
    const warmWhenBothReady = () => {
      if (vesselIn && stageQuiet) void prewarmPipeline();
    };
    const onWarmupRequested = () => {
      stageQuiet = true;
      warmWhenBothReady();
    };
    window.addEventListener(ASSETS_WARMUP_EVENT, onWarmupRequested);

    // ── Model loading ──
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(getSharedDracoLoader());
    gltfLoader.setKTX2Loader(getSharedKtx2Loader());

    const emitStatus = (fraction: number) => {
      const isDone = fraction >= 1;
      // Feed the intro's honest loader (combined with the works field) so the reveal can wait for the
      // vessel to actually be in.
      reportAssetProgress('deck', fraction);
      onStatus({ isLoading: !isDone, percent: isDone ? 100 : Math.round(fraction * 100) });
      if (isDone) {
        vesselIn = true;
        warmWhenBothReady();
      }
    };
    emitStatus(0);

    // ⚠ No `yieldToStarDownload` any more, and its removal is the point rather than an oversight. The
    // fleet held its four vessels behind `fractured_sun.glb` because they were 5.15 MB against the
    // star's 1.3 MB, and started together they simply shared the pipe — the site would open with no sun
    // and the star would fade in 30–60 s later on a slow connection. The vessel is 30 KB. There is
    // nothing left to starve the star with, and holding it back would only delay this scene's warm-up
    // for no gain.
    gltfLoader.load(
      VESSEL_MODEL_PATH,
      (gltf) => {
        if (disposed) return;
        assembly = createVesselAssembly(
          gltf.scene,
          TARGET_SIZE,
          BASE_YAW,
          VESSEL_MODEL_ROTATION,
        );
        lift.add(assembly.spin, assembly.parts);

        // Skin each cluster with ITS WAVE's accent.
        //
        // ⚠ The clone is mandatory. All nine clusters reference the same glTF material, and GLTFLoader
        // hands out one shared THREE.Material instance for it — so re-skinning in place would give the
        // whole ship whichever wave's accent was applied last. (The low-power path in hullMaterial
        // mutates the source material rather than upgrading it, which is what makes this bite.)
        assembly.members.forEach((member) => {
          member.group.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            child.material = Array.isArray(child.material)
              ? child.material.map((material) => material.clone())
              : child.material.clone();
          });
          const profile = DECK_SERVICES[member.spec.wave - 1].profile;
          hullMaterials.push(
            ...applyHullMaterials(
              member.group,
              profile,
              { brightness: member.brightness, emitPulse: member.emitPulse },
              lowPower,
            ),
          );
        });

        resolveHoldingPoses(assembly, tuning, camera.aspect || 1);
        emitStatus(1);
      },
      (progressEvent) => {
        if (progressEvent.total > 0) {
          emitStatus(progressEvent.loaded / progressEvent.total);
        }
      },
      (error) => {
        console.error(`Failed to load vessel: ${VESSEL_MODEL_PATH}`, error);
        emitStatus(1);
      },
    );

    // ── Drag-to-rotate + flick ──
    // Pointer down on the canvas grabs the vessel. Dragging rotates it; on release a big horizontal
    // travel is read as a flick (switch stop), otherwise it springs back.
    //
    // ⚠ The drag reaches `spin`, which is the frame every SOCKET resolves through — so it moves a part
    // exactly as much as that part has locked in. A wing half way home follows your drag half way.
    // Nobody will name that; everybody will feel it.
    const drag = { active: false, startX: 0, startY: 0 };

    const handlePointerDown = (event: PointerEvent) => {
      // Drag only rotates the resting vessel — it's disabled during the flight (the camera is scripted
      // there, so a drag would fight it).
      if (reduceMotion || departState.engaged) return;
      drag.active = true;
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      gsap.killTweensOf(dragRotation);
      canvas.setPointerCapture?.(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!drag.active) return;
      dragRotation.yaw = THREE.MathUtils.clamp(
        (event.clientX - drag.startX) * DRAG_YAW_SENSITIVITY,
        -DRAG_YAW_CLAMP,
        DRAG_YAW_CLAMP,
      );
      dragRotation.pitch = THREE.MathUtils.clamp(
        (event.clientY - drag.startY) * DRAG_PITCH_SENSITIVITY,
        -DRAG_PITCH_CLAMP,
        DRAG_PITCH_CLAMP,
      );
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!drag.active) return;
      drag.active = false;
      canvas.releasePointerCapture?.(event.pointerId);

      const totalX = event.clientX - drag.startX;
      const totalY = event.clientY - drag.startY;
      const isFlick = Math.abs(totalX) > FLICK_DISTANCE_PX && Math.abs(totalX) > Math.abs(totalY);

      // Always ease back to the resting view; if it was a flick, also ask to switch.
      gsap.to(dragRotation, {
        yaw: 0, pitch: 0, duration: SPRING_DURATION, ease: 'elastic.out(1, 0.5)', overwrite: true,
      });
      if (isFlick) {
        // Dragging left pushes the vessel away → move to the next stop (and vice-versa).
        onFlickRef.current(totalX < 0 ? 1 : -1);
      }
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    // Push the shared adaptive pixel ratio + current CSS size onto BOTH the renderer and the composer.
    // The composer caches its own pixel ratio (captured at construction), so it must be told separately
    // or the bloom targets stay at the old density.
    let appliedPixelRatio = getPixelRatio();
    /** How long the controller's ratio has differed from the one actually allocated. */
    let ratioPendingSeconds = 0;
    /** Mirrors the `.is-uncomposited` class, so the DOM is touched only when it changes. */
    let canvasUncomposited = false;
    // How far the flight's camera pulls back on a narrow frame, at its far end.
    let portraitScale = 1;
    // The vessel's portrait drop, in world units — 0 on any landscape frame.
    let portraitShipDrop = 0;
    const applyRendererSize = () => {
      const width  = canvas.clientWidth  || canvas.offsetWidth;
      const height = canvas.clientHeight || canvas.offsetHeight;
      if (!width || !height) return;
      const ratio = getPixelRatio();
      if (ratio !== appliedPixelRatio) noteRatioApplied();
      appliedPixelRatio = ratio;
      camera.aspect = width / height;
      portraitScale = portraitPullbackScale(camera.aspect);
      portraitShipDrop = camera.aspect < 1 ? PORTRAIT_SHIP_DROP : 0;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      composer.setPixelRatio(ratio);
      composer.setSize(width, height);
      // ⚠ The ONLY place the viewport enters the assembly. Every loose part waits on a ring measured in
      // fractions of what this camera can now see, so the swarm reframes itself rather than stretching
      // — parts round the sides of a desktop, over the top and bottom of a phone.
      if (assembly) resolveHoldingPoses(assembly, tuning, camera.aspect);
    };

    // ── Render loop ──
    // Unclamped, which is what this loop has always had. ⚠ It is the only one of the three without a
    // max delta, so a tab-restore integrates the whole gap in a single step here. Left as-is rather
    // than quietly changed — see lib/frameTimer.ts.
    const frameTimer = createFrameTimer();
    let frameId = 0;
    // 0..1 inside a departure window, clamped flat outside it — keeps each beat in sequence.
    const departWindow = (curveWindow: [number, number], value: number) =>
      THREE.MathUtils.clamp((value - curveWindow[0]) / (curveWindow[1] - curveWindow[0]), 0, 1);

    const renderFrame = () => {
      frameId = requestAnimationFrame(renderFrame);
      const loopStartedAt = profileNow();
      // three resets `info` on every `render()`, so a composer's many passes all vanish except the last
      // unless it is accumulated by hand.
      if (telemetryEnabled) renderer.info.reset();

      const deltaSeconds = frameTimer.tick();
      const elapsed = frameTimer.elapsed();
      starfield.rotation.y = elapsed * STAR_DRIFT;

      // ── Push the authored stage onto the scene ──
      renderer.toneMappingExposure = tuning.exposure;
      keyLight.intensity = KEY_LIGHT_INTENSITY * tuning.keyMultiplier;
      fillLight.intensity = FILL_LIGHT_INTENSITY * tuning.fillMultiplier;
      rimLight.intensity = RIM_LIGHT_INTENSITY * tuning.rimMultiplier;
      ambientLight.intensity = tuning.ambientIntensity;
      // The flight owns the camera once it engages; before that the resting shot is the tuning's.
      if (!departState.engaged) applyCameraFromTuning();

      // At rest the departure isn't driving this, so the authored value applies directly.
      if (!departState.engaged) starfieldMaterial.opacity = tuning.starOpacity;

      // Ease toward the scrubbed handoff target (instant under reduced motion — the scroll position
      // itself is then the only animator).
      if (departState.engaged) {
        departState.current +=
          (departState.target - departState.current) * (reduceMotion ? 1 : DEPART_SMOOTHING);
        if (Math.abs(departState.target - departState.current) < 0.001) {
          departState.current = departState.target;
        }
      }
      const departure = departState.current;
      // How firmly the departure holds the vessel — ramps in over the first beats so the turntable spin
      // settles instead of snapping.
      const departGrip = THREE.MathUtils.clamp(departure / DEPART_GRIP_SPAN, 0, 1);

      // ── The assembly ──
      // Held until the section has been on screen and the arrival beat has passed, then followed with a
      // SPEED CAP. `target` is untouched throughout, so none of this can let the build drift away from
      // the scroll — it only governs how fast the ship is allowed to chase it.
      const assemblyRunning =
        reduceMotion || (hasRevealedDeck && performance.now() >= assemblyHoldUntil);
      if (assemblyRunning) {
        const gap = assemblyState.target - assemblyState.current;
        const eased = gap * (reduceMotion ? 1 : ASSEMBLY_SMOOTHING);
        const waveSpan = 1 / VESSEL_WAVE_COUNT;
        const stepCap =
          (waveSpan / ASSEMBLY_WAVE_TRAVEL_SECONDS) *
          Math.min(deltaSeconds, ASSEMBLY_MAX_STEP_SECONDS);
        // Capped while a wave is being built; uncapped once the backlog is too big to be one (a jump).
        // Near the end of a wave the eased term falls under the cap on its own, which is what gives the
        // travel a constant speed and then a soft landing rather than a linear stop.
        assemblyState.current +=
          reduceMotion || Math.abs(gap) > waveSpan * ASSEMBLY_CATCHUP_WAVES
            ? eased
            : THREE.MathUtils.clamp(eased, -stepCap, stepCap);
        if (Math.abs(assemblyState.target - assemblyState.current) < 0.0005) {
          assemblyState.current = assemblyState.target;
        }
      }

      // 1. The turntable, wound down as the departure takes its grip so the ship can hold a heading,
      //    and paused while dragging so manual rotation stays precise.
      if (!reduceMotion && !drag.active) {
        turntableYaw += AUTO_ROTATE_SPEED * deltaSeconds * (1 - departGrip);
      }
      // Settle the accumulated spin onto a whole turn as the flight takes over, so the bank and heading
      // below mean the same thing wherever the showroom spin happened to be.
      if (departState.engaged) {
        const settled = Math.round(turntableYaw / (Math.PI * 2)) * (Math.PI * 2);
        turntableYaw += (settled - turntableYaw) * departGrip * TURNTABLE_SETTLE;
      }
      if (assembly) {
        assembly.spin.rotation.set(dragRotation.pitch, BASE_YAW + turntableYaw + dragRotation.yaw, 0);
      }

      // 2. Float / hover bob — about the (possibly dropped) resting height. The portrait drop is
      //    released across the handoff so the flight's authored world path arrives exactly where it was
      //    written to (see PORTRAIT_SHIP_DROP).
      const shipDrop = portraitShipDrop * (1 - flightRamp(departure));
      lift.position.y =
        SHIP_HOVER + shipDrop + (reduceMotion ? 0 : Math.sin(elapsed * FLOAT_SPEED) * FLOAT_AMPLITUDE);

      // 3. Third-person flight weave — banks + sways the chase ship so it reads as actively flying.
      //    Ramped in by `departure` (0 during normal browsing → full at the parked chase view).
      const flightIdle = reduceMotion || !departState.engaged ? 0 : departure;
      lift.rotation.z = Math.sin(elapsed * FLIGHT_WEAVE_ROLL_SPEED) * FLIGHT_WEAVE_ROLL_AMP * flightIdle;
      lift.rotation.x = Math.sin(elapsed * FLIGHT_WEAVE_PITCH_SPEED + 1.3) * FLIGHT_WEAVE_PITCH_AMP * flightIdle;
      lift.position.x = Math.sin(elapsed * FLIGHT_WEAVE_SWAY_SPEED + 0.7) * FLIGHT_WEAVE_SWAY_AMP * flightIdle;

      // 4. The build itself — every part blended between where it waits and where it belongs.
      if (assembly) {
        updateVesselAssembly(assembly, {
          progress: assemblyState.current,
          elapsed,
          deltaSeconds,
          reduceMotion,
          dormantBrightness: tuning.dormantBrightness,
          activeBrightness: tuning.activeBrightness,
          emitPulseAmplitude: tuning.emitPulseAmplitude,
          emitPulseSpeed: tuning.emitPulseSpeed,
        });
      }

      // ── The services → works flight ──
      if (departState.engaged) {
        // One shared pose drives the ship + the camera swing (see lib/handoffFlightPath.ts). At
        // progress 0 it returns the exact resting camera + an identity ship, so entering/leaving the
        // flight is seamless with normal browsing.
        computeFlightPose(departure, flightPose);

        // Exit whoosh — scrubbed straight off the handoff progress (no time-based tween, no sentinel):
        // fully off-screen by progress 1, and it flies cleanly back on when scrubbed backward.
        const exitAmount = THREE.MathUtils.smoothstep(departure, EXIT_PROGRESS_START, EXIT_PROGRESS_END);

        depart.position.copy(flightPose.shipPosition).addScaledVector(EXIT_DELTA, exitAmount);
        depart.scale.setScalar(flightPose.shipScale * (1 + EXIT_SCALE_GAIN * exitAmount));

        // Keep the authored pitch + bank, but drive YAW from the ship's real velocity so the nose points
        // where it's going — screen-left across the field, then toward the camera as it dives off.
        depart.rotation.x = flightPose.shipRotation.x;
        depart.rotation.z = flightPose.shipRotation.z;
        if (hasPrevShipPosition) {
          const velocityX = depart.position.x - prevShipPosition.x;
          const velocityZ = depart.position.z - prevShipPosition.z;
          if (Math.hypot(velocityX, velocityZ) > HEADING_SPEED_THRESHOLD) {
            const desiredYaw = Math.atan2(velocityX, velocityZ) + HEADING_PHASE;
            // Shortest arc, so a reverse turns the nose the short way round.
            const shortest = Math.atan2(Math.sin(desiredYaw - headingYaw), Math.cos(desiredYaw - headingYaw));
            const eased = shortest * (1 - Math.exp(-deltaSeconds * HEADING_EASE_RATE));
            const maxStep = HEADING_MAX_RAD_PER_SEC * deltaSeconds;
            headingYaw += THREE.MathUtils.clamp(eased, -maxStep, maxStep);
          }
        }
        prevShipPosition.copy(depart.position);
        hasPrevShipPosition = true;
        depart.rotation.y = headingYaw * THREE.MathUtils.smoothstep(departure, REST_BLEND_START, REST_BLEND_END);

        // Drive the shared camera: holds through the launch, then tracks the ship left, then frames the
        // meteor.
        //
        // The portrait pull-back rides on top, off the SAME shared function the works field uses (see
        // lib/portraitPullback.ts). It is here for the field's benefit, not the deck's: the field's
        // browsing camera has always pulled back on a narrow frame, and until this existed the flight
        // handed it a camera at landscape distance — so the mark landed big and snapped small. The deck
        // has to apply the identical scale or the ship and the debris it is flying through stop being in
        // the same place, which is the one thing this crossing cannot survive.
        //
        // The ramp is exactly 1 until progress 0.3, which is where `CAMERA_POSITION_KEYS` stops holding
        // — so the resting shot, and the whole launch off the pad, are untouched at every viewport size.
        camera.position
          .copy(flightPose.cameraPosition)
          .sub(flightPose.cameraTarget)
          .multiplyScalar(flightPullbackScale(portraitScale, departure))
          .add(flightPose.cameraTarget);
        camera.lookAt(flightPose.cameraTarget);
        if (Math.abs(camera.fov - flightPose.cameraFov) > 0.001) {
          camera.fov = flightPose.cameraFov;
          camera.updateProjectionMatrix();
        }

        // The sun is the stationary anchor — it does NOT sink (the camera leaves it behind by tracking
        // away). The deck starfield fades out during the fly-left so the works field's streaking stars
        // take over.
        starfieldMaterial.opacity =
          tuning.starOpacity * (1 - departWindow(DECK_STAR_FADE_WINDOW, departure));

        // Fully home again → the last computed pose already restored the resting camera + rig, so just
        // hand back to the idle systems.
        if (departState.current === 0 && departState.target === 0) {
          departState.engaged = false;
          hasPrevShipPosition = false;
          headingYaw = 0;
          depart.position.set(0, 0, 0);
          depart.rotation.set(0, 0, 0);
          depart.scale.setScalar(1);
        }
      }

      // Only pay for the bloom pipeline when the deck is actually visible (and the tab is in the
      // foreground). Everything above still ran, so the pose is current — we just skipped the GPU draw
      // while it was hidden behind the hero. Once fully parked at works browsing the deck shows nothing
      // (see DECK_PARKED_THRESHOLD), so skip its whole pipeline there.
      const parkedAtWorks = departState.current >= DECK_PARKED_THRESHOLD;
      const handoffActive = departState.current > 0.001 && departState.current < 0.999;
      const isDrawing = deckShouldRender && !document.hidden && !parkedAtWorks;
      if (isDrawing) {
        profileMeasure('deck · render', () => composer.render(), true);
        // ── ⚠ DIAGNOSTIC, one shot: what did the warm-up miss? ──
        // Compared AFTER the draw, because a missing program is created BY that draw — checking before
        // it would compare the warmed set against itself and report nothing.
        if (!programDiffReported && warmedProgramKeys !== null && telemetryEnabled) {
          programDiffReported = true;
          const added = (renderer.info.programs ?? [])
            .map((program) => program.cacheKey)
            .filter((key) => !warmedProgramKeys!.has(key));
          console.log(
            added.length === 0
              ? `%c[voidix] deck programs%c first drawn frame added NONE — the ${warmedProgramKeys.size} warmed` +
                  ` programs covered it.`
              : `%c[voidix] deck programs%c first drawn frame added ${added.length} of ` +
                  `${renderer.info.programs?.length ?? 0} — THE WARM-UP MISSED THESE:\n` +
                  added.map((key) => `  ${key}`).join('\n'),
            'color:#e0b341;font-weight:700',
            'color:#888',
          );
        }
        profileGauge('deck draws', renderer.info.render.calls);
        // Also published here, not only from the works field — otherwise the whole services section
        // reports no ratio and no controller reading, which is exactly the span where the first step
        // down happens.
        profileGauge('ratio', renderer.getPixelRatio());
        profileGauge('fps(ctrl)', getControllerFps());
      }

      // ── Stop paying the compositor for a canvas nobody can see ──
      // Only while PARKED behind works, which is the longest span on the site and the one case where
      // this canvas is provably covered rather than merely faded. Deliberately not tied to `isDrawing`:
      // that also goes false on a hidden tab and during the fill, where the deck is mid-reveal and must
      // stay composited.
      if (parkedAtWorks !== canvasUncomposited) {
        canvasUncomposited = parkedAtWorks;
        canvas.classList.toggle('is-uncomposited', parkedAtWorks);
      }

      // ── Adaptive resolution: only ever re-sized while this scene is NOT being drawn ──
      // Applying a new pixel ratio reallocates the whole composer — it blocks for a frame or more.
      // Never do that on a scene the user is looking at, and ESPECIALLY not "hidden behind" some
      // motion: the tweens keep advancing in real time through the stall, so the motion visibly JUMPS
      // on the far side of it.
      //
      // ⚠ The freeze now covers the ASSEMBLY as well as the handoff, and for exactly the same reason.
      // A reallocation stall in the middle of a wave flying in lets the scrub advance behind it, and
      // the parts land somewhere other than where they were last drawn. (This replaces the old
      // `swapActive` freeze, which guarded the portal swap for the identical hazard.)
      // ⚠ "Still easing", not "anywhere inside the build". A first cut froze the ratio for the whole
      // services span, which is most of a minute — but at a STOP the scrub has settled exactly on a
      // quarter boundary, where one wave has finished and the next has not started, and every part is
      // motionless. There is nothing to jump. Reallocating is safe there and the section is long enough
      // that forbidding it outright would leave a struggling machine no chance to drop resolution
      // before the works field arrives.
      const assemblyMoving =
        Math.abs(assemblyState.target - assemblyState.current) > 0.0005;
      if (handoffActive || assemblyMoving) {
        // ⚠ The freeze must not BANK credit while it is frozen: a grace period that had almost run out
        // before the freeze began would come off it already spent and reallocate on that exact frame.
        // Restart the countdown on the far side instead.
        ratioPendingSeconds = 0;
      } else {
        const targetRatio = getPixelRatio();
        if (targetRatio === appliedPixelRatio) {
          ratioPendingSeconds = 0;
          // In sync with the controller → measure this frame. Only frames we actually DREW, so idle
          // (gated-off) frames can never fake headroom and trick it into ramping the resolution up.
          // Raw by name rather than by luck: this loop happens to be unclamped today, so `deltaSeconds`
          // would work — but the moment anyone adds a max delta here for the tab-restore reason, the
          // controller would go blind exactly as the works field did.
          if (isDrawing) sampleFrame(frameTimer.lastRawDelta(), 'deck');
        } else {
          // Queued. Sampling deliberately stops — measuring at the old ratio while the controller
          // believes it is already at the new one would feed it a lie and make it over-climb.
          ratioPendingSeconds += deltaSeconds;
          if (!isDrawing || ratioPendingSeconds >= RATIO_APPLY_GRACE_SECONDS) {
            applyRendererSize();
            ratioPendingSeconds = 0;
          }
        }
      }

      profileSpan('deck · loop', profileNow() - loopStartedAt);
    };
    renderFrame();

    // ── Resize ──
    applyRendererSize();
    const resizeObserver = new ResizeObserver(applyRendererSize);
    resizeObserver.observe(canvas.parentElement ?? canvas);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener(DECK_REVEAL_EVENT, showDeck);
      window.removeEventListener(DECK_HIDE_EVENT, hideDeck);
      window.removeEventListener(ASSETS_WARMUP_EVENT, onWarmupRequested);
      window.removeEventListener(SERVICES_ASSEMBLY_EVENT, onAssemblyProgress);
      window.removeEventListener(LOOP_RESET_EVENT, onLoopReset);
      window.removeEventListener(HANDOFF_PROGRESS_EVENT, onHandoffProgress);
      cancelAnimationFrame(warmupFrame);
      gsap.killTweensOf(dragRotation);
      // Dispose the loaded hull's geometry + materials.
      assembly?.parts.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
      hullMaterials.forEach((material) => material.dispose());
      hullMaterials = [];
      // No dracoLoader.dispose() — it is shared and page-lifetime (see lib/modelLoading.ts).
      starfield.geometry.dispose();
      starfieldMaterial.dispose();
      pmremGenerator.dispose();
      scene.environment?.dispose();
      // EffectComposer.dispose() only frees its own targets + copy pass, not added passes — so free the
      // bloom pass's render-target pyramid explicitly to avoid a GPU leak on unmount.
      bloomPass.dispose();
      smaaPass.dispose();
      composer.dispose();
      renderer.dispose();
    };
    // Setup runs once; everything that changes arrives as a scrubbed event.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
