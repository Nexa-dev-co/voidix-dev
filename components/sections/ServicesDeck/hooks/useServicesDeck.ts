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
import { computeFlightPose, createFlightPose } from '@/lib/handoffFlightPath';
import { flightPullbackScale, flightRamp, portraitPullbackScale } from '@/lib/portraitPullback';
import { DECK_CRAFT, DECK_SERVICES } from '../deckServices';
import { DECK_REVEAL_EVENT, DECK_HIDE_EVENT } from '../deckEvents';
import { applyHullMaterials, rimColorOf } from '../hullMaterial';
import {
  reportAssetProgress,
  reportWarmupDone,
  isStageQuiet,
  ASSETS_WARMUP_EVENT,
} from '@/lib/assetLoadProgress';
import { yieldToStarDownload } from '@/lib/yieldToStarDownload';
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
import {
  createFleetDrawing,
  materialisePhases,
  type DrawingState,
  type FleetDrawing,
} from '../fleetDrawing';
import { fetchFleetDrawings, type FleetDrawings } from '../deckDrawings';
import { DECK_HERO_INDEX, DECK_PLAN_DORSAL, DECK_PLAN_NOSE } from '../deckDrawingsManifest';

// ── Framing ─────────────────────────────────────────────────────────────
// The camera's pose and each hull's placement are all AUTHORED — they live
// in deckTuning.ts and are pushed onto the scene every frame. Only the things
// that were never authored stay here.

// ── Starfield ───────────────────────────────────────────────────────────
const STAR_COUNT         = 1200;
const STAR_INNER_RADIUS  = 18;  // a spherical shell so stars wrap the scene without crowding the craft
const STAR_OUTER_RADIUS  = 60;
const STAR_SIZE          = 0.16;
const STAR_DRIFT         = 0.011; // radians/second of yaw drift — the "floating through space" feel

// ── Fleet ───────────────────────────────────────────────────────────────
const TARGET_SIZE = 2.3;  // largest dimension every vessel is normalised to
const BASE_YAW    = -0.6; // resting 3/4 view so hulls don't read flat-on
const SHIP_HOVER  = 0.05; // resting height the centred craft sits above the stage plane
/**
 * How far the craft drops, in world units, when the frame is taller than it is wide.
 *
 * ⚠ It is the SHIP that moves, never the camera and never the sun.
 *
 * ⚠ And the hull's screen position is NOT what its 2.3 normalisation suggests. Hulls are normalised on
 * their LARGEST dimension, and on every craft in this fleet that is the LENGTH — so a ship is a long
 * flat thing whose vertical extent is small and whose centre sits close to the stage plane, not a
 * 2.3-tall tower standing on it. At rest that puts the hull's centre a little BELOW the camera's 0.75
 * aim line, around 59% down the frame. (A first pass at this assumed the tower and dropped the ship
 * nearly a full unit too far, straight through the capability keys.)
 *
 * −0.35 lands it around 66% down: below the headline, above the keys and the stepper. This is the
 * number to retune if the framing wants adjusting — it is the only thing that moves the craft, and the
 * frame is ~2.5 world units from centre to edge, so 0.1 here is about 13px on a 780px phone.
 *
 * It is faded out across the handoff on `flightRamp`, because the flight's ship path is authored in
 * world coordinates: left standing, it would carry the sag all the way to the works field.
 */
const PORTRAIT_SHIP_DROP = -0.35;
const FLOAT_AMPLITUDE = 0.1;   // vertical hover bob (up + down) on the centred craft
const FLOAT_SPEED     = 1.1;
const AUTO_ROTATE_SPEED = 0.35; // radians/sec — slow showroom turntable spin on the centred craft

// ── Third-person flight idle (the parked/flying chase ship) ──
// A gentle weave layered on the ship while the flight is engaged, so the third-person chase reads as
// actively flying — banking + swaying — instead of a frozen pose. Ramped in by flight progress so
// normal fleet browsing stays a calm turntable.
const FLIGHT_WEAVE_ROLL_AMP    = 0.11; // radians of banking roll
const FLIGHT_WEAVE_ROLL_SPEED  = 0.7;
const FLIGHT_WEAVE_PITCH_AMP   = 0.05; // radians of nose bob
const FLIGHT_WEAVE_PITCH_SPEED = 0.5;
const FLIGHT_WEAVE_SWAY_AMP    = 0.13; // world units of side-to-side drift
const FLIGHT_WEAVE_SWAY_SPEED  = 0.45;

// ── Lighting (shared stage rig; the centred craft is always powered) ──
const KEY_LIGHT_COLOR      = 0xfff2e2; // warm key so the hull reads with its own colour, not washed cold
const KEY_LIGHT_INTENSITY  = 2.4;      // directional → reveals the surface/normal detail
const FILL_LIGHT_COLOR     = SLATE_600; // neutral cool fill
const FILL_LIGHT_INTENSITY = 0.5;
const RIM_LIGHT_INTENSITY  = 0.8;      // a cyan-ish edge by default; recoloured per ship (see applyRimColor)
const AMBIENT_INTENSITY    = 0.16;     // low so the directional key carves out contrast/texture
// The active ship's edge light eases to the ship's own rim colour, so each craft feels lit for itself.
const RIM_LIGHT_TWEEN = 0.5;

// ── Powered-on look ──
// Each hull wears a graded-palette shader (see hullMaterial.ts): the model's own albedo luminance
// is mapped onto the ship's shadow/hull/highlight tones, so it stays multi-tonal. The centred craft
// sits bright; a craft leaving the stage dims back as it fades. The accent glow + rim live in the
// shader; here we only drive the shared brightness uniform + the native emissive intensity.
//
// The levels themselves are AUTHORED — brightness, emissive strength and the engine pulse all live in
// deckTuning, and are applied every frame.

// ── Selective bloom — OFF ──
// Removed from the fleet 2026-07-28: with every stage light at 0 (see deckTuning) the ships are lit
// only by the cracked sun behind them, and blooming their accents on top of that read as haze rather
// than as glowing engines.
//
// The pass is still CONSTRUCTED, so it is one constant away — but
// it ships `enabled = false`, which makes EffectComposer skip it entirely rather than run the full
// blur pyramid for a zero result. UnrealBloom is the most expensive pass on the site; a disabled one
// costs nothing, a strength-0 one costs everything.
const BLOOM_ENABLED        = false;
const BLOOM_STRENGTH       = 0.85;
const BLOOM_STRENGTH_LOW   = 0.5;  // gentler on low-power devices
const BLOOM_RADIUS         = 0.5;
const BLOOM_THRESHOLD      = 0.7;
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
 * That is the same fault `docs/lag-and-freeze-diagnosis.md` §2 found on the works field's screen stage,
 * in the other scene, hidden behind a comment that asserted the opposite.
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
 *
 * Reading the works field's answer from here would work *usually* — its assets are ~0.95 MB against
 * this fleet's ~5.15 MB, and `yieldToStarDownload` holds the vessels behind the star, so works almost
 * always warms first. But on a fully cached reload both scenes warm on the same stage-quiet signal and
 * the order is whichever effect registered first. That would make the fleet's antialiasing differ
 * between two loads of the same page on the same machine, which is worse than not having it.
 *
 * SMAA is genuine antialiasing and costs ~12 MB of lookup textures rather than ~142 MB of buffers, so
 * the fleet is not going without. If MSAA is ever wanted here, the honest way is to give this hook its
 * OWN probe — its warm-up already draws a real frame, which is the whole reason the works one was
 * nearly free — not to read a number that may or may not have arrived.
 *
 * ⚠ Whatever happens, this and the `SMAAPass` below must never both be on. That is the bug the top of
 * this comment is about.
 */
const BLOOM_MSAA_SAMPLES = 0;

// ── The beat ──
// Four craft, four drawings, and only the last one is ever built. A stop change is a MORPH between
// two drawings; arriving at the hero adds a materialise on the end of it; leaving the hero adds a
// de-materialise to the front.
//
// ⚠ WHICH PHASE RUNS WHEN LIVES IN fleetDrawing.ts, not here. The rig's pose and the field's grains
// have to agree about how far through the build they are, so there is exactly one definition of it
// (`materialisePhases`) and both read it. What this file owns is how LONG each beat takes.
//
// ⚠ THE LONGEST PATH MUST FIT THE PIN'S INPUT LOCK, which is `STAGE_STEP_HOLD_MS` in
// useHeroAnimation and is 2900 ms. That constant was sized to the portal swap this replaces (~2.77 s
// end to end), and its own comment records what happens when a transition outgrows it: a second
// gesture lands mid-cinematic and cuts it in half.
//
// The longest path is ARRIVING AT THE HERO — a crossing then a build — at 1.05 + 1.55 = 2.60 s. The
// ordinary stop change is only the crossing, which is why the carousel feels quicker than the swap
// did everywhere except the one place it should not.
const MORPH_DURATION         = 1.05; // one drawing crosses into the next
const MATERIALISE_DURATION   = 1.55; // the hero turns, wireframes and skins
const DEMATERIALISE_DURATION = 0.80; // …and dissolves back into its own drawing on the way out
const GATHER_DURATION        = 1.15; // dust arriving out of the dark, on entering the section
/** How long the turntable stays suppressed after a beat lands, before the showroom spin resumes. */
const BEAT_GRIP_RELEASE = 0.4;
/**
 * The point of the hero's build the field is held at while the shaders are pre-compiled.
 *
 * ⚠ Mid-build, and it has to be: `compileAsync` walks only VISIBLE objects, and the grains and the
 * lines each switch themselves off at the ends of the beat (see `apply`). This is the one value where
 * the dust, the wireframe and the hull are all on screen together, so all three programs get built.
 * A uniform's value never changes which program is compiled, so nothing else here needs a pose.
 */
const BEAT_PREWARM_POINT = 0.7;

// ── Departure — the services → works flight (the ship no longer exits; it flies you in) ──
// Scrubbed by the hero pin via HANDOFF_PROGRESS_EVENT. The ship's motion + the camera come from the
// shared choreography in lib/handoffFlightPath.ts (see docs/services-to-works-flight.md); here we own
// only the deck-local anchors: the gates + sun STAY put (the camera leaves them behind by moving),
// the contact shadow fades as the ship lifts off, and the deck starfield fades out during the fly-left
// so the works field's streaking stars take over. Each value reverses cleanly when scrolled back.
const DECK_STAR_FADE_WINDOW: [number, number] = [0.30, 0.55]; // deck stars fade out during the fly-left (Phase B)
const DEPART_SMOOTHING = 0.09;   // per-frame ease toward the scrubbed target
const TURNTABLE_SETTLE = 0.12;   // how quickly the accumulated showroom spin settles for the flight
const DEPART_GRIP_SPAN = 0.25;   // handoff fraction over which the flight takes over the turntable

// ── Exit — the ship whooshes off-screen as the flight completes (scrubbed by handoff progress) ──
// The whoosh is driven by the handoff progress itself (via departState), NOT a free time-based tween:
// so it can never desync from the scroll or be outrun. At progress 1 the ship is always fully gone,
// and scrolling back flies it cleanly on again. The offset rides on TOP of the (parked) flight pose.
// The window starts late enough that the ship has flown left across the frame before it dives out —
// and the works meteor's arrival window (see useWorksField) begins only once the ship is clearing,
// so the departing ship and the incoming meteor never share the centre of the screen.
const EXIT_PROGRESS_START = 0.88; // handoff progress where the off-screen whoosh begins
const EXIT_PROGRESS_END   = 1.0;  // …fully off-screen by progress 1 (parked on project 01's stop)
const EXIT_DELTA = new THREE.Vector3(-2, -3.5, 9); // dives down-left and PAST the camera → off-screen
const EXIT_SCALE_GAIN = 0.25; // a touch bigger as it powers past
// Fully parked at works browsing (handoff at 1): the ship has whooshed off-screen and the camera has
// tracked so far left (near x=−15) that the origin sits well outside its frustum — so the
// deck draws nothing. Stop paying for its bloom pipeline past this; it resumes the instant a
// scroll-back eases the handoff below 1 and the ship flies back on. (Verified from the flight-path
// geometry in lib/handoffFlightPath.ts, not guessed.)
const DECK_PARKED_THRESHOLD = 0.999;

// ── Heading — the nose points where the ship is actually going ──
// Yaw is derived from the ship's own per-frame velocity, so the nose tracks its travel: screen-left
// as it flies across, then toward the CAMERA as it dives off toward the screen on the exit. (Pitch +
// bank stay authored from SHIP_ROTATION_KEYS.) The turn used to snap because the old time-based whoosh
// spiked the velocity; now the exit is a smooth progress scrub, so the velocity — and thus the nose —
// is smooth, and we additionally ease it frame-rate-independently and speed-cap it so a scroll-back
// reversal eases round instead of whipping.
const HEADING_SPEED_THRESHOLD = 0.006;      // min per-frame horizontal move before the heading updates
const HEADING_EASE_RATE       = 7;          // fps-independent ease toward the travel heading: 1 - exp(-dt*rate)
const HEADING_MAX_RAD_PER_SEC = 8;          // cap the turn so a scrub-reversal eases round instead of snapping
const HEADING_PHASE           = 2.0 + Math.PI / 2; // atan2(velX, velZ)+this → nose ∥ velocity (2.0 = nose screen-left datum)
const REST_BLEND_START = 0.0;
const REST_BLEND_END   = 0.12;              // ease the heading back to the resting pose near progress 0

// ── Drag-to-rotate + flick (replaces the old passive mouse-track) ──
// A small drag on the craft rotates it (springs back on release); a big horizontal flick switches
// the carousel via onFlick. Distances are in CSS pixels of pointer travel.
const DRAG_YAW_SENSITIVITY   = 0.006; // radians of yaw per pixel dragged
const DRAG_PITCH_SENSITIVITY = 0.004;
const DRAG_YAW_CLAMP         = 1.0;   // most the craft can be turned by a drag
const DRAG_PITCH_CLAMP       = 0.45;
const SPRING_DURATION        = 0.9;   // ease back to the resting view on release
const FLICK_DISTANCE_PX      = 110;   // horizontal travel past this (and horizontally dominant) = a switch

export interface DeckStatus {
  isLoading: boolean;
  /** 0–100 while loading, 100 when the fleet is in. */
  percent: number;
}

interface DeckOptions {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Index of the craft currently centre stage. Read live from the render loop / handlers. */
  activeIndex: number;
  /** A horizontal flick on the craft asks to switch: +1 = next, -1 = previous. */
  onFlick: (direction: number) => void;
  onStatus: (status: DeckStatus) => void;
}

/** The craft's nested rig. stage → depart → lift → spin → vessel lets each transform stay
 *  independent: stage owns the leave-the-stop flight, depart owns the services→works departure
 *  scrub (identity outside the handoff), lift owns the hover height + float bob, spin owns
 *  yaw/pitch (base view, drag rotation, and the assembly's plan→resting turn).
 *
 *  ⚠ There is exactly ONE of these now. The deck used to hold four, one per service, and swap them
 *  through portal gates; it holds one craft that is re-drawn at every stop. The four services are
 *  still four stops — what changes between them is the palette, the light and the drawing, not the
 *  geometry. */
interface DeckShip {
  stage: THREE.Group;
  depart: THREE.Group;
  lift: THREE.Group;
  spin: THREE.Group;
  /** Carries the authored placement, so the hull and its drawing are nudged together. */
  place: THREE.Group;
  /** The loaded hull itself. Authored placement is applied here, on top of the normalised pose. */
  vessel: THREE.Group | null;
  /** Every switchable mesh of this hull, by positional id — what `hiddenParts` in the tuning switches off. */
  parts: Map<string, THREE.Mesh>;
  /** …and which of them the tuning switched off, so presence can't switch one back on. */
  hiddenPartIds: Set<string>;
  materials: THREE.Material[];
  /** The dust + wireframe that draw this craft into being. Null until its bake lands. */
  drawing: FleetDrawing | null;
  /** Shared across this ship's hull materials → driven by litState (dim when leaving, bright when centred). */
  brightnessUniform: { value: number };
  /** Shared engine-glow breathing — modulated on the centred craft each frame. */
  emitPulseUniform: { value: number };
  /** 0 = dim (leaving), 1 = fully powered (centred). GSAP tweens this → brightness + emissive. */
  litState: { value: number };
  /** 0 = off-stage/invisible, 1 = centre stage. GSAP tweens this → material opacity. */
  presence: { value: number };
}

// A spherical shell of faint points wrapping the scene — the "stars in the section". Additive so
// they glint against the black without lighting the craft.
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

// Centre the model, scale so every hull reads at the same size, and rest its base on y = 0 (origin
// at the base, not the centre) so a craft sits ON the stage plane when its rig is at y = 0.
function prepareVessel(
  loadedScene: THREE.Group,
  rotationDegrees?: { x?: number; y?: number; z?: number },
): THREE.Group {
  // Apply any per-ship base rotation BEFORE measuring, so the bounding box (and the base-on-ground
  // placement below) accounts for the new orientation — a flipped hull still sits right on the stage.
  if (rotationDegrees) {
    loadedScene.rotation.set(
      THREE.MathUtils.degToRad(rotationDegrees.x ?? 0),
      THREE.MathUtils.degToRad(rotationDegrees.y ?? 0),
      THREE.MathUtils.degToRad(rotationDegrees.z ?? 0),
    );
    loadedScene.updateMatrixWorld(true);
  }

  const boundingBox = new THREE.Box3().setFromObject(loadedScene);
  const size   = boundingBox.getSize(new THREE.Vector3());
  const center = boundingBox.getCenter(new THREE.Vector3());
  loadedScene.position.sub(center);

  const largestDimension = Math.max(size.x, size.y, size.z) || 1;
  const normalisedScale  = TARGET_SIZE / largestDimension;

  const inner = new THREE.Group();
  inner.scale.setScalar(normalisedScale);
  inner.add(loadedScene);
  // Shift the (centred) hull up by half its scaled height so its base lands at y = 0.
  inner.position.y = (size.y * normalisedScale) / 2;

  const group = new THREE.Group();
  group.add(inner);
  return group;
}

export function useServicesDeck({ canvasRef, activeIndex, onFlick, onStatus }: DeckOptions) {
  // The render loop and the swap logic read the freshest selection through a ref, so the
  // persistent setup effect never re-runs when the carousel index changes.
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  // Latest onFlick, so the drag handlers (set up once) always call the current closure.
  const onFlickRef = useRef(onFlick);
  onFlickRef.current = onFlick;

  // Set up inside the persistent effect; called from the selection effect below so an index
  // change re-stages the existing scene instead of rebuilding it.
  const setStageRef = useRef<(index: number) => void>(() => {});

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const reduceMotion = prefersReducedMotion();
    // The lighter path: keeps clearcoat/iridescence and strong bloom off the devices least able to
    // afford them. One authority for it now, rather than a viewport test copied into two scene hooks —
    // see lib/deviceTier.ts.
    const lowPower = isLowPowerDevice();

    // The authored stage: camera, rig intensities, and where each hull sits.
    const tuning = getDeckTuning();

    // ── Renderer ──
    // ⚠ `antialias: false` is deliberate and is NOT a quality cut. Everything here draws through an
    // EffectComposer, and a composer's final pass is a fullscreen quad — so the multisampled default
    // framebuffer that `antialias: true` allocates has no geometry edges to resolve. It costs memory
    // and a resolve every frame to antialias a rectangle. The real AA is `samples` on the composer
    // target (MSAA, where the geometry actually is) plus the SMAAPass below.
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    // Which compressed texture formats this GPU accepts. Must happen before any KTX2 model loads —
    // the loader throws rather than guessing. See lib/modelLoading.ts.
    detectKtx2Support(renderer);
    // Shared adaptive resolution (drops under load, climbs back when smooth) — see applyRendererSize.
    renderer.setPixelRatio(getPixelRatio());
    if (telemetryEnabled) renderer.info.autoReset = false;
    // Neutral tone mapping holds the hull colours instead of desaturating highlights the way ACES
    // does — the fleet read flat/grey under ACES. OutputPass applies this after the composer.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = tuning.exposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(tuning.cameraFov, 1, 0.1, 100);
    // Re-applied every frame from the tuning rather than once at build, so there is one code path for the
    // shot. Cheap: three writes and a lookAt on a camera that isn't otherwise animated at rest.
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

    // Warm key + neutral fill + a rim that traces the hull's edge (recoloured per ship below).
    const keyLight = new THREE.DirectionalLight(KEY_LIGHT_COLOR, KEY_LIGHT_INTENSITY);
    keyLight.position.set(4, 7, 5);
    const fillLight = new THREE.DirectionalLight(FILL_LIGHT_COLOR, FILL_LIGHT_INTENSITY);
    fillLight.position.set(-6, -1, 2);
    const rimLight = new THREE.DirectionalLight(0xffffff, RIM_LIGHT_INTENSITY);
    rimLight.position.set(-3, 3, -6);
    const ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
    scene.add(keyLight, fillLight, rimLight, ambientLight);

    // The PER-SHIP light levels, tweened by applyShipLighting as the carousel moves. Kept separate from
    // the lights themselves so the rig's multipliers can scale them every frame without the two writers
    // fighting — an absolute per-frame write would simply overwrite the tween and flatten every craft
    // to the same key.
    const shipLightLevels = {
      key: KEY_LIGHT_INTENSITY,
      fill: FILL_LIGHT_INTENSITY,
      rim: RIM_LIGHT_INTENSITY,
    };

    // ── Post-processing: selective bloom ──
    // HalfFloat keeps the bloom precise — it must bleed on HDR values, before the tone curve compresses
    // them — and the bloom threshold means only the bright accents/highlights bleed, so it reads as
    // glowing engines rather than a haze. No MSAA: the SMAA pass at the end of this chain is the
    // antialiasing, and running both is the bug BLOOM_MSAA_SAMPLES describes.
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
    // Smooth the hull edges the bloom pipeline leaves rough. A composer ignores the renderer's own
    // `antialias` flag, so now that the target carries no samples this genuinely IS the only geometry
    // AA on the final image — which it was previously claimed to be while 4x MSAA ran underneath it.
    // Runs last, on the LDR result after tone mapping. Sized by the composer, so it follows the
    // adaptive resolution.
    const smaaPass = new SMAAPass();
    composer.addPass(smaaPass);

    // ── Starfield ──
    const starfield = createStarfield();
    const starfieldMaterial = starfield.material as THREE.PointsMaterial;
    scene.add(starfield);

    // ── The craft's rig (created empty up-front so status works before the model arrives) ──
    const ship: DeckShip = (() => {
      const stage  = new THREE.Group();
      const depart = new THREE.Group(); // written only by the handoff scrub in the render loop
      const lift   = new THREE.Group();
      const spin   = new THREE.Group();
      // ⚠ `place` exists so the authored placement moves the hull AND its drawing together. It used
      // to be applied to the hull object itself, which was harmless while the hull was the only thing
      // in the rig — but the hero's drawing has to coincide with its geometry exactly, and a nudge
      // applied to one and not the other would show up as the model sliding out of the wireframe at
      // the moment it appears. Every placement is currently identity, so this changes nothing today;
      // it is here so that it still changes nothing if one ever isn't.
      const place  = new THREE.Group();
      spin.rotation.y = BASE_YAW;
      lift.position.y = SHIP_HOVER;
      spin.add(place);
      lift.add(spin);
      depart.add(lift);
      stage.add(depart);
      scene.add(stage);

      return {
        stage,
        depart,
        lift,
        spin,
        place,
        vessel: null,
        parts: new Map<string, THREE.Mesh>(),
        hiddenPartIds: new Set<string>(),
        materials: [],
        drawing: null,
        brightnessUniform: { value: tuning.activeBrightness },
        emitPulseUniform: { value: 1 },
        litState: { value: 0 },
        presence: { value: 0 },
      };
    })();

    /** The craft's resting three-quarter pose — what the plan-view turn lands on. */
    const restingPose = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, BASE_YAW, 0));
    /** …and the plan-view pose, solved against the live camera once the model is in (see below). */
    const planPose = new THREE.Quaternion().copy(restingPose);

    // Push the craft's lit value (0..1) onto its (shared) hull brightness + native emissive strength.
    const applyLitState = () => {
      ship.brightnessUniform.value = THREE.MathUtils.lerp(
        tuning.dormantBrightness, tuning.activeBrightness, ship.litState.value,
      );
      ship.materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.emissiveIntensity = ship.litState.value * tuning.litEmissiveIntensity;
        }
      });
    };

    // Fold the craft's presence (0 = not yet skinned → 1 = solid) into its material opacity.
    const applyOpacity = () => {
      // Stop DRAWING the hull once it has faded out, rather than leaving it at opacity 0: the hull
      // materials are `transparent` but keep three's default `depthWrite: true`, so an invisible one
      // still stamps its shape into the depth buffer — which would punch a craft-shaped hole through
      // the dust and the wireframe standing exactly where it is.
      //
      // ⚠ On the MESHES, not on `ship.stage` (which is what this did while four hulls stacked at the
      // origin and occluded each other). The dust and the wireframe are children of the vessel, so
      // hiding any group above them would hide the very drawing that has to be on screen while the
      // hull is not. `hiddenPartIds` is honoured so a part the tuning culled cannot come back on.
      const solid = ship.presence.value > 0.001;
      ship.parts.forEach((mesh, partId) => {
        mesh.visible = solid && !ship.hiddenPartIds.has(partId);
      });
      ship.materials.forEach((material) => {
        const baseOpacity = (material.userData.baseOpacity as number | undefined) ?? 1;
        material.opacity = baseOpacity * ship.presence.value;
      });
    };

    /**
     * Tint the DUST for a service. The hull is never touched.
     *
     * ⚠ THE HULL IS NOT RE-GRADED, AND MUST NOT BE. It is only ever on screen at the hero stop, so it
     * wears exactly one palette for its whole life — its own, applied once when the materials are
     * built, straight from the profile that service authored.
     *
     * There was a version of this that re-graded the hull through `material.userData.hullUniforms` on
     * every stop change. It existed because an earlier cut had ONE hull standing in for all four
     * services, and it forced the AI craft's flat two-tone `legacy` profile to be rewritten as a
     * graded one just so its colours could live in uniforms. None of that is needed now that three of
     * the four stops are drawings: the hull can keep the look it was authored with, in the treatment
     * it was authored in, and the four stops are told apart by their DRAWING instead.
     *
     * Which is the better answer anyway — the dust is what the visitor is actually looking at for
     * three quarters of this section.
     */
    const applyServicePalette = (index: number) => {
      const profile = DECK_SERVICES[index].profile;
      // Grains run from the palette's deepest tone to its brightest, so the dust reads as the craft's
      // own light before there is a craft to emit it.
      const [hot, cool] = profile.kind === 'legacy'
        ? [profile.colorEdge, profile.colorCore]
        : [profile.accent, profile.shadow];
      ship.drawing?.setPalette(hot, cool);
    };

    // Light the active craft to match its vibe: the rim light eases to the ship's rim colour, and the
    // key light eases to its per-ship colour + intensity (default warm key when the ship omits `light`).
    // Instant on the first stage / under reduced motion.
    const applyShipLighting = (index: number, instant = false) => {
      const service = DECK_SERVICES[index];
      const rimTarget = new THREE.Color(rimColorOf(service.profile));
      const keyTarget = new THREE.Color(service.light?.color ?? KEY_LIGHT_COLOR);
      const fillTarget = new THREE.Color(service.light?.fill ?? FILL_LIGHT_COLOR);
      const keyIntensity = service.light?.intensity ?? KEY_LIGHT_INTENSITY;
      if (instant || reduceMotion) {
        rimLight.color.copy(rimTarget);
        keyLight.color.copy(keyTarget);
        shipLightLevels.key = keyIntensity;
        fillLight.color.copy(fillTarget);
        return;
      }
      gsap.to(rimLight.color, {
        r: rimTarget.r, g: rimTarget.g, b: rimTarget.b,
        duration: RIM_LIGHT_TWEEN, ease: 'power2.out', overwrite: true,
      });
      gsap.to(keyLight.color, {
        r: keyTarget.r, g: keyTarget.g, b: keyTarget.b,
        duration: RIM_LIGHT_TWEEN, ease: 'power2.out', overwrite: true,
      });
      gsap.to(shipLightLevels, {
        key: keyIntensity,
        duration: RIM_LIGHT_TWEEN, ease: 'power2.out', overwrite: true,
      });
      gsap.to(fillLight.color, {
        r: fillTarget.r, g: fillTarget.g, b: fillTarget.b,
        duration: RIM_LIGHT_TWEEN, ease: 'power2.out', overwrite: true,
      });
    };

    // Which service is currently staged. Initialised to the mount index so the first selection
    // effect (same index) is a no-op rather than a phantom swap.
    let stagedIndex = activeIndexRef.current;
    applyShipLighting(stagedIndex, true);

    // ── The beat ──
    //
    // ⚠ FOUR DRAWINGS, ONE SHIP. Stops 01–03 are drawings and never anything else — there is no hull
    // to send away and none to bring on, so a stop change is a MORPH: one grain travelling from its
    // place in one craft to its place in the next. Only the hero stop goes further, and only it has a
    // model at all.
    //
    // Everything below is derived per frame from these four numbers; none of them is tweened onto the
    // scene directly. `materialise` in particular has two consumers that must not disagree — the
    // hull's presence and the craft's pose — so both read it through `materialisePhases`.
    const beat = {
      /** Dust arriving out of the dark. Replayed whenever the section is entered. */
      gather: 0,
      /** The crossing between two drawings. */
      shapeFrom: stagedIndex,
      shapeTo: stagedIndex,
      shapeMorph: 1,
      /** The hero's build: turn → wireframe → hull. Zero at every other stop. */
      materialise: 0,
      /** Holds the showroom turntable still while any of the above is running. */
      grip: 0,
    };
    let beatTimeline: gsap.core.Timeline | null = null;
    let beatActive = false;

    // One reused carrier, so pushing the beat onto the field allocates nothing per frame.
    const drawingState: DrawingState = {
      gather: 0, shapeFrom: 0, shapeTo: 0, shapeMorph: 1, materialise: 0, elapsed: 0,
    };
    const pushBeat = (elapsed: number, materialise = beat.materialise) => {
      drawingState.gather = beat.gather;
      drawingState.shapeFrom = beat.shapeFrom;
      drawingState.shapeTo = beat.shapeTo;
      drawingState.shapeMorph = beat.shapeMorph;
      drawingState.materialise = materialise;
      drawingState.elapsed = elapsed;
      ship.drawing?.apply(drawingState);
    };

    // ── The plan-view pose ──
    //
    // Every drawing lives in one plane, and that plane has to face the camera or a drawing is a line.
    // So the craft's rig sits at the PLAN POSE for the whole of the section, and only turns out of it
    // as the hero materialises.
    //
    // Solved rather than authored: a hand-written euler would be wrong the moment the camera, the
    // portrait drop or the turntable's accumulated yaw moved, and all three do.
    const planDorsal = new THREE.Vector3(...DECK_PLAN_DORSAL);
    const planNose = new THREE.Vector3(...DECK_PLAN_NOSE);

    // Scratch, so a per-frame solve allocates nothing.
    const toCamera = new THREE.Vector3();
    const screenUp = new THREE.Vector3();
    const parentQuaternion = new THREE.Quaternion();
    const sourceBasis = new THREE.Matrix4();
    const targetBasis = new THREE.Matrix4();
    const basisThird = new THREE.Vector3();

    const solvePlanPose = () => {
      const parent = ship.spin.parent;
      if (!parent) return;
      parent.updateWorldMatrix(true, false);
      // ⚠ The camera's world matrix is otherwise a frame stale — three only refreshes it inside
      // `render()`, which runs AFTER this. At rest that costs nothing because the deck camera does not
      // move, but the handoff flies it, and a pose solved against last frame's camera would lag the
      // shot by exactly one frame for the whole turn.
      camera.updateMatrixWorld();

      // Both target directions expressed in the space `spin` rotates within, so the solve accounts
      // for the hover, the portrait drop and whatever yaw the turntable had accumulated.
      toCamera.copy(camera.position);
      parent.worldToLocal(toCamera).normalize();
      screenUp.setFromMatrixColumn(camera.matrixWorld, 1);
      parent.getWorldQuaternion(parentQuaternion);
      screenUp.applyQuaternion(parentQuaternion.invert());
      // Orthonormalised against the view direction, or the basis below is a shear rather than a
      // rotation and `setFromRotationMatrix` reads nonsense out of it.
      screenUp.addScaledVector(toCamera, -screenUp.dot(toCamera)).normalize();

      sourceBasis.makeBasis(planDorsal, planNose, basisThird.crossVectors(planDorsal, planNose));
      targetBasis.makeBasis(toCamera, screenUp, basisThird.crossVectors(toCamera, screenUp));
      // target · sourceᵀ — both are orthonormal, so the transpose is the inverse.
      planPose.setFromRotationMatrix(targetBasis.multiply(sourceBasis.transpose()));
    };

    /**
     * The one timeline a stop change runs on.
     *
     * Three beats, and which of them run depends on where you are coming from and going to:
     *
     *   · leaving the hero  → it DE-materialises first, back into its own drawing, before crossing
     *   · any stop change   → the drawings cross
     *   · arriving at hero  → it materialises once the crossing has landed
     *
     * ⚠ Sized so the longest path (arriving at the hero) stays inside the pin's input lock. See the
     * constants at the top of this file.
     */
    const runStopChange = (nextIndex: number, previousIndex: number) => {
      beatTimeline?.kill();
      beatActive = true;
      beat.grip = 1;
      const timeline = gsap.timeline({
        onComplete: () => {
          beatActive = false;
          beatTimeline = null;
        },
      });
      beatTimeline = timeline;

      const leavingHero = previousIndex === DECK_HERO_INDEX && beat.materialise > 0.001;
      const crossAt = leavingHero ? DEMATERIALISE_DURATION : 0;

      if (leavingHero) {
        timeline.to(beat, {
          materialise: 0, duration: DEMATERIALISE_DURATION, ease: 'power2.inOut',
        }, 0);
      }

      // The palette changes ON the crossing rather than before it, so the dust warms into the new
      // service's colour as it takes the new craft's shape.
      timeline.call(() => {
        beat.shapeFrom = previousIndex;
        beat.shapeTo = nextIndex;
        beat.shapeMorph = 0;
        applyServicePalette(nextIndex);
      }, undefined, crossAt);

      // ⚠ Linear, deliberately. The per-grain stagger inside the shader is what shapes this crossing;
      // an ease here would fight it.
      timeline.to(beat, { shapeMorph: 1, duration: MORPH_DURATION, ease: 'none' }, crossAt);

      if (nextIndex === DECK_HERO_INDEX) {
        timeline.to(beat, {
          materialise: 1, duration: MATERIALISE_DURATION, ease: 'none',
        }, crossAt + MORPH_DURATION);
      }

      timeline.to(beat, {
        grip: 0, duration: BEAT_GRIP_RELEASE, ease: 'power2.out',
      }, timeline.duration());
    };

    /** Straight to a finished stop, no drawing (reduced motion). */
    const snapToStop = (index: number) => {
      beatTimeline?.kill();
      beatTimeline = null;
      beatActive = false;
      beat.gather = 1;
      beat.shapeFrom = index;
      beat.shapeTo = index;
      beat.shapeMorph = 1;
      beat.materialise = index === DECK_HERO_INDEX ? 1 : 0;
      beat.grip = 0;
      gsap.killTweensOf([beat, ship.spin.rotation]);
      // ⚠ Solved here rather than relied on. Under reduced motion the render loop never runs the
      // solve (it is gated on `animate`), so `planPose` would still be its initial copy of the
      // resting pose — and every drawing would be edge-on to the camera, i.e. invisible.
      solvePlanPose();
      ship.spin.quaternion.copy(index === DECK_HERO_INDEX ? restingPose : planPose);
    };

    const setStage = (nextIndex: number) => {
      if (nextIndex === stagedIndex) return;
      const previousIndex = stagedIndex;
      stagedIndex = nextIndex;
      applyShipLighting(nextIndex);

      if (reduceMotion) {
        applyServicePalette(nextIndex);
        snapToStop(nextIndex);
        return;
      }
      runStopChange(nextIndex, previousIndex);
    };
    setStageRef.current = setStage;

    // Replay the entrance — fired by DECK_REVEAL_EVENT every time the section scrolls back into view,
    // so "scroll away then back" draws the fleet again. Nothing is being left behind, so this is the
    // gather rather than a crossing.
    const replayEntrance = () => {
      const index = activeIndexRef.current;
      stagedIndex = index;
      applyShipLighting(index);
      applyServicePalette(index);

      beatTimeline?.kill();
      if (reduceMotion) {
        snapToStop(index);
        return;
      }

      beat.gather = 0;
      beat.shapeFrom = index;
      beat.shapeTo = index;
      beat.shapeMorph = 1;
      beat.materialise = 0;
      beat.grip = 1;
      beatActive = true;

      const timeline = gsap.timeline({
        onComplete: () => {
          beatActive = false;
          beatTimeline = null;
        },
      });
      beatTimeline = timeline;
      timeline.to(beat, { gather: 1, duration: GATHER_DURATION, ease: 'none' }, 0);
      if (index === DECK_HERO_INDEX) {
        timeline.to(beat, { materialise: 1, duration: MATERIALISE_DURATION, ease: 'none' }, GATHER_DURATION);
      }
      timeline.to(beat, { grip: 0, duration: BEAT_GRIP_RELEASE, ease: 'power2.out' }, timeline.duration());
    };
    window.addEventListener(DECK_REVEAL_EVENT, replayEntrance);

    // Gate the expensive bloom draw to when the deck is actually on screen. The deck reveals on
    // DECK_REVEAL_EVENT (fill → fleet) and hides back on DECK_HIDE_EVENT (fleet → fill); it stays on
    // screen through the whole services → works handoff (the craft flies you in). The render loop
    // keeps running regardless — we skip only the composer draw — so ship state, tweens and the
    // handoff scrub stay perfectly live, and the first frame after it reveals is already in pose.
    let deckShouldRender = false;
    const showDeck = () => { deckShouldRender = true; };
    const hideDeck = () => { deckShouldRender = false; };
    window.addEventListener(DECK_REVEAL_EVENT, showDeck);
    window.addEventListener(DECK_HIDE_EVENT, hideDeck);

    // ── Departure state (the services → works handoff) ──
    // The hero pin scrubs the raw target; the render loop eases toward it every frame, so the
    // choreography stays smooth whether the user creeps, flicks, or the snap glides through.
    // `engaged` keeps the scrub's writes off the rig entirely until the handoff is first touched,
    // and hands the rig back to the swap/idle systems once it has fully reversed out.
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
      // ⚠ The crossing finishes the drawing outright if it catches one running.
      //
      // Both want the craft's orientation — the assembly is turning it out of plan view while the
      // flight is steering its nose along a path — and there is no sensible blend of the two. The pin
      // holds input for the whole assembly so this needs a nav jump or a very fast scroll to happen at
      // all, and jumping the timeline to its end lands the craft solid, in its resting pose, which is
      // exactly the state the flight expects to depart from. (Under a jump it happens behind the
      // cover; on a fast scroll a snap is far better than a half-drawn craft flying you to works.)
      //
      // Through `snapToCenter` rather than `beatTimeline.progress(1)`: GSAP suppresses callbacks
      // on `seek` but not on `progress`, and a beat that ended without its `onComplete` would leave
      // `drawingActive` true — the render loop would then keep slerping the craft toward plan view
      // for the whole flight. The grade is re-applied first because an assembly interrupted during
      // its DEPARTURE has not reached the call that changes the palette.
      if (beatActive && departState.target > 0.001) {
        applyServicePalette(stagedIndex);
        snapToStop(stagedIndex);
      }
    };
    window.addEventListener(HANDOFF_PROGRESS_EVENT, onHandoffProgress);

    // ── Warm-up: build every program and allocate every buffer while the deck is off screen ──
    //
    // Two beats, ONE PER FRAME. `compileAsync` is not the free ride an earlier version of this comment
    // claimed: it runs `renderer.compile()` SYNCHRONOUSLY before it awaits anything (three's own
    // source), so program creation and uploads still block — only the wait for the driver to finish
    // linking is offloaded. And the `composer.render()` after it is the more expensive half anyway,
    // because that is where the composer's two full-resolution multisampled targets are ALLOCATED.
    //
    // Both are GPU-process work, and while the GPU process is busy the compositor cannot present
    // anyone's frames — including the loader's worker-rendered dust. Given a frame each they are two
    // short hitches rather than one long one. See `warmUpField` in useWorksField for the full note.
    //
    // ⚠ Run when the FLEET's own vessels are in (see emitStatus), not when the whole page has finished
    // downloading. ASSETS_WARMUP_EVENT remains as a backstop; `warmupStarted` makes the two idempotent.
    let disposed = false;
    let warmupStarted = false;
    let warmupFrame = 0;
    /** Program cache keys present at the end of the warm-up — see the diagnostic in `prewarmPipeline`. */
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
      // Pose the beat mid-assembly first. `compileAsync` walks only VISIBLE objects, and both the
      // dust and the wireframe switch themselves off at the ends of the beat (see `apply` in
      // fleetDrawing) — so without this neither program is built until the craft is first drawn,
      // which is the exact stall this whole warm-up exists to prevent.
      //
      // ⚠ That premise does not hold for MATERIALS on three r184: `compile` gathers lights with
      // `traverseVisible` but materials with plain `traverse`, so a hidden object is compiled
      // regardless. Kept anyway — it costs nothing, it is correct on either behaviour, and the hull
      // needs showing here in any case. Do NOT cite it as evidence that hiding an object defers its
      // compile; the sun's corona freeze (see `warmStarMaterials` in SunModelCanvas) was a
      // first-DRAW problem, not a visibility one, and needed an explicit `initTexture` pass that this
      // does not do.
      // The deck is off screen throughout, and the render loop's own draw is gated off, so nothing
      // is on screen to see it. Cleared on every exit path below.
      pushBeat(0, BEAT_PREWARM_POINT);
      // The hull is not drawn at all while its presence is 0 (see applyOpacity), so it has to be
      // shown for the compile; the `finally` puts it back where its presence says it belongs.
      ship.parts.forEach((mesh, partId) => {
        mesh.visible = !ship.hiddenPartIds.has(partId);
      });
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
        // composer's targets, so neither lands on the frame the fleet is first revealed.
        composer.render();
        // ── ⚠ DIAGNOSTIC: did this warm-up actually cover the frame the reveal will draw? ──
        //
        // A Chrome trace of the hero → services boundary found ONE real hitch: a 69 ms task, 67 ms of
        // it inside `FunctionCall`, and the sampler charged 55 % of what it could sample to
        // `getProgramInfoLog` — reached through `renderFrame` → `RenderPass.render` → `setProgram`.
        // That call blocks the main thread until the driver finishes LINKING a shader program, so a
        // program is being built on the deck's first real render despite everything above.
        //
        // Which program is not known. `applyShipLighting` only tweens light colours and intensities,
        // which are not part of three's program cache key; there are no shadows, no `onBeforeCompile`
        // and no material swaps. So rather than guess a fourth time, record the key set here and diff
        // it against the first drawn frame — three keys every program by a string that spells out
        // exactly which features it was built for, so the diff names the cause outright.
        //
        // ⚠ Gated on telemetry. three's cache keys are long concatenations of every program
        // parameter, so ~9 of them is several KB held for the whole session — pointless in a build
        // that can never print them.
        if (telemetryEnabled) {
          warmedProgramKeys = new Set(
            (renderer.info.programs ?? []).map((program) => program.cacheKey),
          );
        }
      } catch {
        // A failed compile is not a reason to trap the loader; whatever failed compiles on first draw.
      } finally {
        pushBeat(0);
        applyOpacity();
        if (!disposed) reportWarmupDone('deck'); // the intro holds the reveal until this fires
      }
    };
    // ── When it runs: BOTH the fleet's own vessels AND a quiet loader ──
    // Own-assets-in keeps this off the tail of the page's last byte (see above). The quiet-stage half is
    // what keeps it off the loader's wordmark: five Syne 800 glyphs at up to 256 px animating transform
    // and opacity through an overshoot is the most expensive thing the loader draws, and a compile
    // landing on it is visible. ASSETS_WARMUP_EVENT now fires once that animation has resolved.
    //
    // `stageQuiet` starts TRUE when no loader is on the page — under reduced motion the intro skips its
    // timeline and never dispatches, so waiting on it would mean never warming. Read from the DOM
    // because this hook is behind a dynamic import and mounts after INTRO_ACTIVE_EVENT has gone.
    let vesselsIn = false;
    // State as well as event, because this hook is dynamically imported and its chunk can land after
    // the intro has already dispatched. See `isStageQuiet` for why an event alone is a race.
    let stageQuiet =
      isStageQuiet() || document.querySelector(INTRO_MARKER_SELECTOR) === null;
    const warmWhenBothReady = () => {
      if (vesselsIn && stageQuiet) void prewarmPipeline();
    };
    const onWarmupRequested = () => {
      stageQuiet = true;
      warmWhenBothReady();
    };
    window.addEventListener(ASSETS_WARMUP_EVENT, onWarmupRequested);

    // ── Model loading (Draco-compressed) ──
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(getSharedDracoLoader());
    gltfLoader.setKTX2Loader(getSharedKtx2Loader());

    // ── Load the craft, and the drawing of it ──
    //
    // Two assets, weighted by their bytes: the hull is 411 KB and its feature-edge bake is 65 KB. The
    // bake is not optional decoration — it is what the section opens with — so the loader's counter
    // has to wait for both, and `reportAssetProgress` is fed their blend rather than the hull alone.
    const HULL_SHARE = 0.86;
    const DRAWINGS_SHARE = 1 - HULL_SHARE;
    const loadProgress = { hull: 0, drawings: 0 };
    const emitStatus = () => {
      const fraction = loadProgress.hull * HULL_SHARE + loadProgress.drawings * DRAWINGS_SHARE;
      const isDone = loadProgress.hull >= 1 && loadProgress.drawings >= 1;
      // Feed the intro's honest loader (combined with the works field) so the reveal can wait for
      // the craft to actually be in.
      reportAssetProgress('deck', fraction);
      onStatus({ isLoading: !isDone, percent: isDone ? 100 : Math.round(fraction * 100) });
      // Arm the warm-up on THIS section's own assets, rather than on the whole page. It still waits
      // for the loader's stage to go quiet — see `warmWhenBothReady`.
      if (isDone) {
        vesselsIn = true;
        warmWhenBothReady();
      }
    };
    emitStatus();

    // ── The craft yields the wire to the star ──
    //
    // ⚠ This mattered far more when it was four vessels and 5.3 MB. It is 476 KB now, so on any
    // ordinary connection the star was never going to be starved by it — but the hold costs a fast
    // connection nothing and the failure it prevents (the site opening with no sun for 30–60 s on a
    // slow link, because the browser split the pipe evenly and the star finished last) is severe
    // enough that removing a working guard for tidiness would be a poor trade.
    let vesselsStarted = false;
    const startVesselLoads = () => {
      if (vesselsStarted || disposed) return;
      vesselsStarted = true;
      loadCraft();
      void loadDrawings();
    };
    // Held until the star is in, stalls, or fails — see lib/yieldToStarDownload.ts, which also
    // covers the already-cached case and why this is a stall detector rather than the flat 6 s
    // deadline it replaces (that deadline expired mid-download on exactly the connections it
    // existed to protect, and the fleet then starved the star the rest of the way).
    const stopYieldingToStar = yieldToStarDownload(startVesselLoads);

    /**
     * The fleet's drawings.
     *
     * ⚠ Attached to `spin` directly, NOT to the loaded hull — three of the four craft have no hull to
     * attach to. It carries its own deck-unit scale and base-on-ground lift (see createFleetDrawing),
     * which reproduce exactly what prepareVessel does to the model, so the hero's drawing and the
     * hero's geometry occupy the same space without either depending on the other having arrived.
     *
     * That independence is the point: the drawings can be on screen while the hull is still
     * downloading, and they are — stops 01 to 03 never need it at all.
     */
    const attachDrawings = (drawings: FleetDrawings) => {
      if (ship.drawing) return;
      const drawing = createFleetDrawing(drawings, TARGET_SIZE);
      ship.place.add(drawing.object);
      drawing.setViewportHeight(renderer.getDrawingBufferSize(new THREE.Vector2()).y);
      ship.drawing = drawing;
      applyServicePalette(activeIndexRef.current);
      // Whatever point of the beat we are already at — a bake that lands mid-beat must not restart
      // it, and one that lands after must not draw dust over a finished hull.
      pushBeat(0);
    };

    async function loadDrawings() {
      const drawings = await fetchFleetDrawings();
      if (disposed) return;
      // ⚠ A failed fetch is not recoverable in the way a failed model load is — three of the four
      // stops ARE this file. The hero stop still shows its hull (the render loop derives presence
      // from the beat either way) and the others show an empty stage. Bad, but not a crash, and the
      // loader's counter still completes rather than trapping the visitor on the intro.
      if (drawings) attachDrawings(drawings);
      loadProgress.drawings = 1;
      emitStatus();
    }

    function loadCraft() {
      gltfLoader.load(
        DECK_CRAFT.path,
        (gltf) => {
          const group = prepareVessel(gltf.scene, DECK_CRAFT.rotation);
          ship.place.add(group);
          ship.vessel = group;
          // Catalogue every mesh by positional id, and honour whatever is already baked into the
          // tuning as hidden. Switched off rather than culled: a hidden piece has to be able to come
          // back on, and a hull is small enough that a hidden mesh costs nothing to keep around.
          //
          // ⚠ The ids stay `<serviceIndex>:<meshIndex>` with the service index pinned to 0. There is
          // one hull, so a per-service cull would be a cull of the same geometry under four names.
          let partIndex = 0;
          group.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            const partId = `0:${partIndex}`;
            partIndex += 1;
            ship.parts.set(partId, child);
            if (tuning.ships[0]?.hiddenParts.includes(partId)) ship.hiddenPartIds.add(partId);
          });
          // Skin the hull, from the HERO service's own profile — the one this model belongs to.
          //
          // ⚠ Built once and never re-graded. This craft is only on screen at its own stop, so it has
          // exactly one palette for its whole life and can wear whatever treatment that service
          // authored: the AI craft's flat two-tone `legacy` fresnel, in this case, with the colours
          // compiled into the program the way it was always written. Nothing here has to be
          // expressible as a uniform, which is what an earlier one-hull-for-four-services cut forced.
          ship.materials = applyHullMaterials(
            group,
            DECK_SERVICES[DECK_HERO_INDEX].profile,
            { brightness: ship.brightnessUniform, emitPulse: ship.emitPulseUniform },
            lowPower,
          );

          // Materials only exist now, so the initial pose has to be applied after the model arrives.
          ship.stage.position.set(0, 0, 0);
          applyOpacity();
          applyLitState();

          loadProgress.hull = 1;
          emitStatus();
        },
        (progressEvent) => {
          if (progressEvent.total > 0) {
            loadProgress.hull = progressEvent.loaded / progressEvent.total;
            emitStatus();
          }
        },
        (error) => {
          console.error(`Failed to load craft: ${DECK_CRAFT.path}`, error);
          loadProgress.hull = 1;
          emitStatus();
        },
      );
    }

    // ── Drag-to-rotate + flick ──
    // Pointer down on the canvas grabs the centred craft. Dragging rotates it; on release a big
    // horizontal travel is read as a flick (switch carousel), otherwise the craft springs back.
    const drag = { active: false, startX: 0, startY: 0, startTime: 0 };

    const handlePointerDown = (event: PointerEvent) => {
      // Drag only rotates the resting craft — it's disabled during the flight (the camera is
      // scripted there, so a drag would fight it) and during the assembly, where the render loop
      // owns the craft's whole orientation as it turns out of plan view.
      if (reduceMotion || departState.engaged || beatActive) return;
      drag.active = true;
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      drag.startTime = performance.now();
      gsap.killTweensOf(ship.spin.rotation);
      canvas.setPointerCapture?.(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!drag.active) return;
      const deltaX = event.clientX - drag.startX;
      const deltaY = event.clientY - drag.startY;
      ship.spin.rotation.y = BASE_YAW + THREE.MathUtils.clamp(
        deltaX * DRAG_YAW_SENSITIVITY, -DRAG_YAW_CLAMP, DRAG_YAW_CLAMP,
      );
      ship.spin.rotation.x = THREE.MathUtils.clamp(
        deltaY * DRAG_PITCH_SENSITIVITY, -DRAG_PITCH_CLAMP, DRAG_PITCH_CLAMP,
      );
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (!drag.active) return;
      drag.active = false;
      canvas.releasePointerCapture?.(event.pointerId);

      const totalX = event.clientX - drag.startX;
      const totalY = event.clientY - drag.startY;
      const isFlick = Math.abs(totalX) > FLICK_DISTANCE_PX && Math.abs(totalX) > Math.abs(totalY);

      // Always ease the craft back to its resting view; if it was a flick, also ask to switch.
      gsap.to(ship.spin.rotation, {
        x: 0, y: BASE_YAW, duration: SPRING_DURATION, ease: 'elastic.out(1, 0.5)', overwrite: true,
      });
      if (isFlick) {
        // Dragging the craft left pushes it away → reveal the next craft (and vice-versa).
        onFlickRef.current(totalX < 0 ? 1 : -1);
      }
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    // Push the shared adaptive pixel ratio + current CSS size onto BOTH the renderer and the
    // composer. The composer caches its own pixel ratio (captured at construction), so it must be
    // told separately or the bloom targets stay at the old density. Used for real window resizes and
    // whenever the adaptive controller shifts the ratio. Defined before the render loop so the loop
    // can call it without a forward reference.
    let appliedPixelRatio = getPixelRatio();
    /** How long the controller's ratio has differed from the one actually allocated. */
    let ratioPendingSeconds = 0;
    /** Mirrors the `.is-uncomposited` class, so the DOM is touched only when it changes. */
    let canvasUncomposited = false;
    // How far the flight's camera pulls back on a narrow frame, at its far end. Held here beside the
    // aspect it is derived from rather than recomputed in the loop, so the two can't disagree — and
    // read ONLY by the handoff below. The fleet's own resting shot is deliberately not touched by it
    // (see the flight branch for why the ramp has to start at exactly 1).
    let portraitScale = 1;
    // The craft's portrait drop, in world units — 0 on any landscape frame, so nothing below it costs
    // a desktop anything. See PORTRAIT_SHIP_DROP.
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
      // The dust sizes its sprites the way three's own PointsMaterial does — against the DRAWING
      // BUFFER's height, not the CSS height — so it has to be re-told on a resize AND whenever the
      // adaptive controller moves the pixel ratio, which is exactly when this runs.
      ship.drawing?.setViewportHeight(height * ratio);
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
      // See the works field: three resets `info` on every `render()`, so a composer's many passes all
      // vanish except the last unless it is accumulated by hand.
      if (telemetryEnabled) renderer.info.reset();

      const deltaSeconds = frameTimer.tick();
      const elapsed = frameTimer.elapsed();
      starfield.rotation.y = elapsed * STAR_DRIFT;

      // ── Push the authored stage onto the scene ──
      // Applied every frame rather than once at build: it keeps the authored stage and the animated state
      // on one code path, and all of it is plain property writes.
      renderer.toneMappingExposure = tuning.exposure;
      // Multiplied, not assigned — see shipLightLevels.
      keyLight.intensity = shipLightLevels.key * tuning.keyMultiplier;
      fillLight.intensity = shipLightLevels.fill * tuning.fillMultiplier;
      rimLight.intensity = shipLightLevels.rim * tuning.rimMultiplier;
      ambientLight.intensity = tuning.ambientIntensity;
      // The flight owns the camera once it engages; before that the resting shot is the tuning's.
      if (!departState.engaged) applyCameraFromTuning();

      // At rest the departure isn't driving this, so the authored value applies directly.
      if (!departState.engaged) starfieldMaterial.opacity = tuning.starOpacity;

      const placement = tuning.ships[activeIndexRef.current];
      if (placement) {
        ship.place.position.set(placement.x, placement.y, placement.z);
        ship.place.rotation.set(
          THREE.MathUtils.degToRad(placement.rotX),
          THREE.MathUtils.degToRad(placement.rotY),
          THREE.MathUtils.degToRad(placement.rotZ),
        );
        ship.place.scale.setScalar(placement.scale);
      }

      // Ease toward the scrubbed handoff target (instant under reduced motion — the scroll
      // position itself is then the only animator).
      if (departState.engaged) {
        departState.current +=
          (departState.target - departState.current) * (reduceMotion ? 1 : DEPART_SMOOTHING);
        if (Math.abs(departState.target - departState.current) < 0.001) {
          departState.current = departState.target;
        }
      }
      const departure = departState.current;
      // How firmly the departure holds the craft — ramps in over the first beats so the turntable
      // spin settles instead of snapping.
      const departGrip = THREE.MathUtils.clamp(departure / DEPART_GRIP_SPAN, 0, 1);

      // The portrait drop, released across the handoff so the flight's authored world path arrives
      // exactly where it was written to (see PORTRAIT_SHIP_DROP).
      const shipDrop = portraitShipDrop * (1 - flightRamp(departure));
      const animate = !reduceMotion;
      // 1. Float / hover bob — drifts up and down, about the (possibly dropped) resting height.
      ship.lift.position.y =
        SHIP_HOVER + shipDrop + (animate ? Math.sin(elapsed * FLOAT_SPEED) * FLOAT_AMPLITUDE : 0);
      // 2. Slow turntable spin — paused while dragging so manual rotation stays precise, wound down
      //    as the departure takes its grip so the craft can hold a heading, and gripped by the
      //    assembly too: a craft being drawn has to hold the pose it is being drawn in, and the
      //    turntable underneath would rotate it out of plan view before the turn does.
      if (animate && !drag.active) {
        ship.lift.rotation.y +=
          AUTO_ROTATE_SPEED * deltaSeconds * (1 - departGrip) * (1 - beat.grip);
      }
      // 3. Engine-glow breathing.
      ship.emitPulseUniform.value = animate
        ? 1 + Math.sin(elapsed * tuning.emitPulseSpeed) * tuning.emitPulseAmplitude
        : 1;
      // 4. Third-person flight weave — banks + sways the chase ship so it reads as actively flying.
      //    Ramped in by `departure` (0 during normal browsing → full at the parked chase view).
      const flightIdle = animate && departState.engaged ? departure : 0;
      ship.lift.rotation.z = Math.sin(elapsed * FLIGHT_WEAVE_ROLL_SPEED) * FLIGHT_WEAVE_ROLL_AMP * flightIdle;
      ship.lift.rotation.x = Math.sin(elapsed * FLIGHT_WEAVE_PITCH_SPEED + 1.3) * FLIGHT_WEAVE_PITCH_AMP * flightIdle;
      ship.lift.position.x = Math.sin(elapsed * FLIGHT_WEAVE_SWAY_SPEED + 0.7) * FLIGHT_WEAVE_SWAY_AMP * flightIdle;

      // ── The beat: dust → drawing → wireframe → hull ──
      //
      // Everything here is derived from the beat, every frame — none of it is tweened onto the scene
      // directly, so the hull's presence, the field's grains and the craft's pose cannot disagree
      // about how far through the build they are.
      const phases = materialisePhases(beat.materialise);
      pushBeat(elapsed);

      // ⚠ The hull exists only at the hero stop, and only as far as its skin has closed. At every
      // other stop `materialise` is 0, so this is 0, so the model is not drawn at all — which is the
      // whole point: three of the four craft are drawings and have no geometry to show.
      const presence = phases.skin;
      if (Math.abs(ship.presence.value - presence) > 0.0005) {
        ship.presence.value = presence;
        ship.litState.value = presence;
        applyOpacity();
        applyLitState();
      }

      // The craft's rig sits at the PLAN POSE for the whole section — that is what holds the drawing
      // plane square to the camera — and turns out of it only as the hero materialises.
      //
      // ⚠ Solved every frame rather than once. The hover, the portrait drop and the turntable's
      // accumulated yaw all move the pose that would reproduce the drawing, and the handoff moves the
      // camera as well.
      if (animate) {
        solvePlanPose();
        ship.spin.quaternion.slerpQuaternions(planPose, restingPose, phases.solid);
      }

      // ── The services → works flight ──
      if (departState.engaged) {
        // One shared pose drives the ship + the camera swing (see lib/handoffFlightPath.ts). At
        // progress 0 it returns the exact resting camera + an identity ship, so entering/leaving the
        // flight is seamless with normal fleet browsing.
        computeFlightPose(departure, flightPose);

        // Exit whoosh — scrubbed straight off the handoff progress (no time-based tween, no sentinel):
        // fully off-screen by progress 1, and it flies cleanly back on when scrubbed backward.
        const exitAmount = THREE.MathUtils.smoothstep(departure, EXIT_PROGRESS_START, EXIT_PROGRESS_END);

        {
          // Settle the accumulated turntable yaw onto a full turn, so the flight bank/heading below
          // means the same thing no matter where the showroom spin happened to be.
          const settledYaw = Math.round(ship.lift.rotation.y / (Math.PI * 2)) * (Math.PI * 2);
          ship.lift.rotation.y += (settledYaw - ship.lift.rotation.y) * departGrip * TURNTABLE_SETTLE;

          // Scrubbed flight pose + the exit off-screen offset on top.
          ship.depart.position.copy(flightPose.shipPosition).addScaledVector(EXIT_DELTA, exitAmount);
          ship.depart.scale.setScalar(flightPose.shipScale * (1 + EXIT_SCALE_GAIN * exitAmount));

          // Keep the authored pitch + bank, but drive YAW from the ship's real velocity so the nose
          // points where it's going — screen-left across the field, then toward the camera as it dives
          // off toward the screen. Eased frame-rate-independently + speed-capped so the turn never snaps.
          ship.depart.rotation.x = flightPose.shipRotation.x;
          ship.depart.rotation.z = flightPose.shipRotation.z;
          if (hasPrevShipPosition) {
            const velocityX = ship.depart.position.x - prevShipPosition.x;
            const velocityZ = ship.depart.position.z - prevShipPosition.z;
            if (Math.hypot(velocityX, velocityZ) > HEADING_SPEED_THRESHOLD) {
              const desiredYaw = Math.atan2(velocityX, velocityZ) + HEADING_PHASE;
              // Shortest arc, so a reverse turns the nose the short way round.
              const shortest = Math.atan2(Math.sin(desiredYaw - headingYaw), Math.cos(desiredYaw - headingYaw));
              const eased = shortest * (1 - Math.exp(-deltaSeconds * HEADING_EASE_RATE));
              const maxStep = HEADING_MAX_RAD_PER_SEC * deltaSeconds;
              headingYaw += THREE.MathUtils.clamp(eased, -maxStep, maxStep);
            }
          }
          prevShipPosition.copy(ship.depart.position);
          hasPrevShipPosition = true;
          ship.depart.rotation.y = headingYaw * THREE.MathUtils.smoothstep(departure, REST_BLEND_START, REST_BLEND_END);
        }

        // Drive the shared camera: holds through the launch, then tracks the ship left, then frames
        // the meteor.
        //
        // The portrait pull-back rides on top, off the SAME shared function the works field uses (see
        // lib/portraitPullback.ts). It is here for the field's benefit, not the deck's: the field's
        // browsing camera has always pulled back on a narrow frame, and until this existed the flight
        // handed it a camera at landscape distance — so the mark landed big and snapped small. The
        // deck has to apply the identical scale or the ship and the debris it is flying through stop
        // being in the same place, which is the one thing this crossing cannot survive.
        //
        // The ramp is exactly 1 until progress 0.3, which is where `CAMERA_POSITION_KEYS` stops
        // holding — so the fleet's resting shot, and the whole launch off the pad, are untouched at
        // every viewport size.
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

        // The gates + sun are the stationary anchors — they do NOT sink (the camera leaves them
        // behind by tracking away). The deck starfield fades out during the fly-left so the works
        // field's streaking stars take over.
        starfieldMaterial.opacity =
          tuning.starOpacity * (1 - departWindow(DECK_STAR_FADE_WINDOW, departure));

        // Fully home again → the last computed pose already restored the resting camera + rig, so
        // just hand back to the swap/idle systems.
        if (departState.current === 0 && departState.target === 0) {
          departState.engaged = false;
          hasPrevShipPosition = false;
          headingYaw = 0;
        }
      }

      // Only pay for the bloom pipeline when the deck is actually visible (and the tab is in the
      // foreground). Everything above still ran, so the pose is current — we just skipped the GPU
      // draw while it was hidden behind the hero.
      // Once fully parked at works browsing the deck shows nothing (see DECK_PARKED_THRESHOLD), so
      // skip its whole bloom pipeline there — halving the GPU cost while the user browses projects.
      const parkedAtWorks = departState.current >= DECK_PARKED_THRESHOLD;
      const handoffActive = departState.current > 0.001 && departState.current < 0.999;
      const isDrawing = deckShouldRender && !document.hidden && !parkedAtWorks;
      if (isDrawing) {
        profileMeasure('deck · render', () => composer.render(), true);
        // ── ⚠ DIAGNOSTIC, one shot: what did the warm-up miss? ──
        // Compared AFTER the draw, because the missing program is created BY that draw — checking
        // before it would compare the warmed set against itself and report nothing. See the snapshot
        // in `prewarmPipeline` for what this is chasing.
        if (!programDiffReported && warmedProgramKeys !== null && telemetryEnabled) {
          programDiffReported = true;
          const added = (renderer.info.programs ?? [])
            .map((program) => program.cacheKey)
            .filter((key) => !warmedProgramKeys!.has(key));
          console.log(
            added.length === 0
              ? `%c[voidix] deck programs%c first drawn frame added NONE — the ${warmedProgramKeys.size} warmed` +
                  ` programs covered it, so the link stall is coming from somewhere else.`
              : `%c[voidix] deck programs%c first drawn frame added ${added.length} of ` +
                  `${renderer.info.programs?.length ?? 0} — THE WARM-UP MISSED THESE:\n` +
                  added.map((key) => `  ${key}`).join('\n'),
            'color:#e0b341;font-weight:700',
            'color:#888',
          );
        }
        profileGauge('deck draws', renderer.info.render.calls);
        // Also published here, not only from the works field — otherwise the whole fleet section
        // reports no ratio and no controller reading, which is exactly the span where the first step
        // down happens and where the last log left us guessing.
        profileGauge('ratio', renderer.getPixelRatio());
        profileGauge('fps(ctrl)', getControllerFps());
      }

      // ── Stop paying the compositor for a canvas nobody can see ──
      // Only while PARKED behind works, which is the longest span on the site (works → chamber →
      // contact) and the one case where this canvas is provably covered rather than merely faded.
      // Deliberately not tied to `isDrawing`: that also goes false on a hidden tab and during the
      // fill, where the deck is mid-reveal and must stay composited. See `.is-uncomposited`.
      if (parkedAtWorks !== canvasUncomposited) {
        canvasUncomposited = parkedAtWorks;
        canvas.classList.toggle('is-uncomposited', parkedAtWorks);
      }

      // ── Adaptive resolution: only ever re-sized while this scene is NOT being drawn ──
      // Applying a new pixel ratio reallocates the whole composer (the UnrealBloom target pyramid +
      // the SMAA buffers) — it blocks for a frame or more. Never do that on a scene the user is
      // looking at, and ESPECIALLY not "hidden behind" some motion: the tweens keep advancing in real
      // time through the stall, so the motion visibly JUMPS on the far side of it. So we wait for a
      // genuinely idle moment — the deck off screen (the fill phase, or parked behind works) or the
      // tab backgrounded. Also frozen entirely through the handoff — and through an assembly, which
      // is the same hazard for the same reason: ~3s of tweened motion the user is watching, where a
      // reallocation stall would let the timeline advance behind it and land the craft somewhere else.
      if (!handoffActive && !beatActive) {
        const targetRatio = getPixelRatio();
        if (targetRatio === appliedPixelRatio) {
          ratioPendingSeconds = 0;
          // In sync with the controller → measure this frame. Only frames we actually DREW, so idle
          // (gated-off) frames can never fake headroom and trick it into ramping the resolution up.
          // Raw by name rather than by luck: this loop happens to be unclamped today (see its
          // frameTimer), so `deltaSeconds` would work — but the moment anyone adds a max delta here
          // for the tab-restore reason, the controller would go blind exactly as the works field did.
          if (isDrawing) sampleFrame(frameTimer.lastRawDelta(), 'deck');
        } else {
          // Queued. Sampling deliberately stops — measuring at the old ratio while the controller
          // believes it is already at the new one would feed it a lie and make it over-climb.
          ratioPendingSeconds += deltaSeconds;
          // The fleet does get idle frames (it parks behind works), but not while it is being
          // browsed — four stops with wide crossings between them is a long time to hold a queued
          // change. Same rule as the works field; see RATIO_APPLY_GRACE_SECONDS.
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
      window.removeEventListener(DECK_REVEAL_EVENT, replayEntrance);
      window.removeEventListener(DECK_REVEAL_EVENT, showDeck);
      window.removeEventListener(DECK_HIDE_EVENT, hideDeck);
      window.removeEventListener(ASSETS_WARMUP_EVENT, onWarmupRequested);
      cancelAnimationFrame(warmupFrame);
      stopYieldingToStar();
      window.removeEventListener(HANDOFF_PROGRESS_EVENT, onHandoffProgress);
      // Stop any running tweens, then dispose the hull's geometry + materials.
      gsap.killTweensOf(ship.litState);
      gsap.killTweensOf(ship.presence);
      gsap.killTweensOf(ship.stage.position);
      gsap.killTweensOf(ship.stage.rotation);
      gsap.killTweensOf(ship.stage.scale);
      gsap.killTweensOf(ship.spin.rotation);
      gsap.killTweensOf(beat);
      // Before the traverse, so the assembly's own buffers are freed by their owner rather than by
      // the mesh sweep below — which would not have found them anyway (they are Points and
      // LineSegments, not Meshes).
      ship.drawing?.dispose();
      ship.spin.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const meshMaterials = Array.isArray(child.material) ? child.material : [child.material];
          meshMaterials.forEach((material) => material.dispose());
        }
      });
      gsap.killTweensOf(rimLight.color);
      gsap.killTweensOf(keyLight.color);
      gsap.killTweensOf(keyLight);
      gsap.killTweensOf(fillLight.color);
      // No dracoLoader.dispose() — it is shared and page-lifetime (see lib/modelLoading.ts).
      starfield.geometry.dispose();
      starfieldMaterial.dispose();
      beatTimeline?.kill();
      pmremGenerator.dispose();
      scene.environment?.dispose();
      // EffectComposer.dispose() only frees its own targets + copy pass, not added passes —
      // so free the bloom pass's render-target pyramid explicitly to avoid a GPU leak on unmount.
      bloomPass.dispose();
      smaaPass.dispose();
      composer.dispose();
      renderer.dispose();
    };
    // Setup runs once; selection changes are read live via activeIndexRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // React to carousel index changes: re-stage the existing scene (fly current off, next on).
  useEffect(() => {
    setStageRef.current(activeIndex);
  }, [activeIndex]);
}
