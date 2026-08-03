import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
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
import { DECK_SERVICES } from '../deckServices';
import { DECK_REVEAL_EVENT, DECK_HIDE_EVENT } from '../deckEvents';
import { applyHullMaterials, rimColorOf, type HullShaderUniforms } from '../hullMaterial';
import { reportAssetProgress, reportWarmupDone, ASSETS_WARMUP_EVENT } from '@/lib/assetLoadProgress';
import { getPixelRatio, sampleFrame } from '@/lib/adaptivePixelRatio';
import { getDeckTuning } from '../deckTuning';
import {
  createPortalGate,
  PORTAL_GATE_RADIUS_X,
  PORTAL_GATE_RADIUS_Y,
} from '../portalGate';

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
const DRACO_DECODER_PATH = '/draco/';
const TARGET_SIZE = 2.3;  // largest dimension every vessel is normalised to
const BASE_YAW    = -0.6; // resting 3/4 view so hulls don't read flat-on
const SHIP_HOVER  = 0.05; // resting height the centred craft sits above the stage plane
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
const FILL_LIGHT_COLOR     = 0x9aa7bb; // neutral cool fill
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
const BLOOM_MSAA_SAMPLES   = 4;    // MSAA on the composer target (antialias:true is ignored once a composer renders)

// ── The portal swap ──
// Two gates form; the craft turns to face one, flies through it, and its replacement comes out of the
// other. See docs/services-portal-swap-plan.md.
//
// All beats are absolute seconds on ONE timeline, so the sequencing is readable in one place rather
// than as a chain of delays. The gates reach "ready" (PORTAL_FORM_DURATION) just as the craft
// arrives at one, so it flies WHILE they finish forming.
//
// The hero pin holds its input lock (STAGE_STEP_HOLD_MS) across the whole of this. Lengthen the swap
// and that constant has to follow, or a second gesture cuts the gate in half.
const PORTAL_FORM_DURATION     = 1.25; // gates: nothing → ready
const PORTAL_AIM_DURATION      = 0.55; // the craft swings its nose onto the gate
const PORTAL_LAUNCH_AT         = 0.75; // …holds a beat, then goes
const PORTAL_FLIGHT_DURATION   = 0.55; // craft → gate (ends at 1.30, just past "ready")
const SWAP_GAP                 = 0.12; // empty beat, so one gate never reads as two ships in one hole
const PORTAL_ARRIVE_DURATION   = 0.65; // replacement → centre stage
const PORTAL_COLLAPSE_DURATION = 0.70; // gates un-form through the same stages, in reverse
/** How long the turntable stays suppressed after the craft lands, before the showroom spin resumes. */
const PORTAL_GRIP_RELEASE      = 0.4;
/** Scale a craft shrinks to as it passes through the gate, and grows from as it comes out. */
const PORTAL_THROUGH_SCALE     = 0.12;
/** Residual roll as the craft peels away — a fraction of the old slide-off bank, not a full barrel. */
const PORTAL_BANK              = 0.22;

// ── Gate placement ──
// Derived from the LIVE frame, never from world constants: at portrait the visible half-width at the
// stage collapses to ~1.2 world units while every hull is normalised to 2.3, so a fixed lateral offset
// is off-screen by ~3× (see the plan doc §2).
/**
 * How far BEHIND centre stage the gates stand.
 *
 * Not scenery depth — it is what makes the craft fly *through* a gate rather than slide sideways into
 * it. A gate is billboarded to face the camera, so at the stage's own plane the craft's travel is 71
 * degrees off the gate's normal: it grazes the face instead of passing through it. Setting the gates
 * back swings the travel round to ~23 degrees, and everything below is measured at THIS depth so the
 * push costs nothing in framing (see computePortalLayout).
 *
 * Perfect alignment is only possible for a gate directly behind the craft, which is exactly what the
 * narrow layout gets — the reason it reads better there.
 */
const GATE_DEPTH           = 5.0;
/**
 * Quad height as a fraction of the frame's half-height AT THE GATE'S DEPTH — so the gate's on-screen
 * size is the same wherever GATE_DEPTH is set.
 *
 * This sizes the QUAD, not the visible ring: the quad now carries a wide fade margin around the ring
 * (PORTAL_GATE_RADIUS_* are derived through it), so this number is larger than the ring looks. Raised
 * from 1.05 alongside that margin purely to leave the ring the same size on screen.
 */
const GATE_SIZE_FRACTION   = 1.51;
/** Where the pair sits, as a fraction of the frame's half-width, before the clearances clamp it. */
const GATE_X_FRACTION      = 0.62;
/**
 * Where the gates sit vertically, as a fraction of the frame's half-height at their depth, measured
 * from the camera's own aim line. Negative is below it — this is the knob that puts them low in the
 * frame rather than standing at eye level.
 */
const GATE_Y_FRACTION      = -0.22;
/** Half of TARGET_SIZE — the room a hull needs before a gate can sit beside it. */
const SHIP_HALF_EXTENT     = TARGET_SIZE / 2;
// Clearances are SCREEN fractions, not world units. The hull and the gates now sit at different
// depths, so their world x tells you nothing about whether they overlap in frame — only where they
// land on screen does.
const GATE_SHIP_CLEARANCE  = 0.12; // clear air between the hull's edge and a gate's near edge
const GATE_FRAME_MARGIN    = 0.04; // …and between a gate's far edge and the edge of frame
// ── The narrow-viewport layout ──
// Below the aspect at which a pair still fits (~0.97 with these clearances) it collapses to ONE gate
// directly behind the craft. Depth is not constrained by aspect, so that gate is in frame at any
// width with the camera exactly where it is.
/** Where the lone gate sits, as a fraction of the frame's half-width — just off the axis, so the
 *  hull does not stand squarely in front of it. */
const GATE_SINGLE_X        = 0.18;
/**
 * A formation the gates are held at while the shaders are pre-compiled. Any non-zero value builds the
 * same program — every stage is a runtime branch inside one shader — it just has to clear the
 * visibility cut-off, because `compileAsync` walks only visible objects.
 */
const PORTAL_PREWARM_FORMATION = 0.5;

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

// Coarse pointer or a small viewport → the lighter render path (no clearcoat/iridescence, softer bloom).
const LOW_POWER_MAX_WIDTH = 760;

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

/** One craft's nested rig. stage → depart → lift → spin → vessel lets each transform stay
 *  independent: stage owns the carousel fly-on/off, depart owns the services→works departure
 *  scrub (identity outside the handoff), lift owns the hover height + float bob, spin owns
 *  yaw/pitch (base view + drag rotation). */
interface DeckShip {
  stage: THREE.Group;
  depart: THREE.Group;
  lift: THREE.Group;
  spin: THREE.Group;
  /** The loaded hull itself. Authored placement is applied here, on top of the normalised pose. */
  vessel: THREE.Group | null;
  /** Every switchable mesh of this hull, by positional id — what `hiddenParts` in the tuning switches off. */
  parts: Map<string, THREE.Mesh>;
  materials: THREE.Material[];
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
    // The lighter path: coarse pointer (touch) or a narrow viewport. Keeps clearcoat/iridescence +
    // strong bloom + MSAA off the devices least able to afford them.
    const lowPower =
      window.matchMedia('(pointer: coarse)').matches || window.innerWidth < LOW_POWER_MAX_WIDTH;

    // The authored stage: camera, rig intensities, and where each hull sits.
    const tuning = getDeckTuning();

    // ── Renderer ──
    // ⚠ `antialias: false` is deliberate and is NOT a quality cut. Everything here draws through an
    // EffectComposer, and a composer's final pass is a fullscreen quad — so the multisampled default
    // framebuffer that `antialias: true` allocates has no geometry edges to resolve. It costs memory
    // and a resolve every frame to antialias a rectangle. The real AA is `samples` on the composer
    // target (MSAA, where the geometry actually is) plus the SMAAPass below.
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true });
    // Shared adaptive resolution (drops under load, climbs back when smooth) — see applyRendererSize.
    renderer.setPixelRatio(getPixelRatio());
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
    // A HalfFloat + MSAA target keeps the bloom precise and the edges clean; the bloom threshold
    // means only the bright accents/highlights bleed, so it reads as glowing engines, not a haze.
    const composerTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: lowPower ? 0 : BLOOM_MSAA_SAMPLES,
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
    // Smooth the hull edges the bloom pipeline leaves rough — a composer ignores the renderer's own
    // `antialias` flag, so this is the only geometry AA on the final image. Runs last, on the LDR
    // result after tone mapping. Sized by the composer, so it follows the adaptive resolution.
    const smaaPass = new SMAAPass();
    composer.addPass(smaaPass);

    // ── Starfield ──
    const starfield = createStarfield();
    const starfieldMaterial = starfield.material as THREE.PointsMaterial;
    scene.add(starfield);

    // ── Ship rigs (created empty up-front so status works before models arrive) ──
    const ships: DeckShip[] = DECK_SERVICES.map(() => {
      const stage  = new THREE.Group();
      const depart = new THREE.Group(); // written only by the handoff scrub in the render loop
      const lift   = new THREE.Group();
      const spin   = new THREE.Group();
      spin.rotation.y = BASE_YAW;
      lift.position.y = SHIP_HOVER;
      lift.add(spin);
      depart.add(lift);
      stage.add(depart);
      scene.add(stage);

      return {
        stage,
        depart,
        lift,
        spin,
        vessel: null,
        parts: new Map<string, THREE.Mesh>(),
        materials: [],
        brightnessUniform: { value: tuning.activeBrightness },
        emitPulseUniform: { value: 1 },
        litState: { value: 0 },
        presence: { value: 0 },
      };
    });

    // Push a ship's lit value (0..1) onto its (shared) hull brightness + native emissive strength.
    const applyLitState = (ship: DeckShip) => {
      ship.brightnessUniform.value = THREE.MathUtils.lerp(
        tuning.dormantBrightness, tuning.activeBrightness, ship.litState.value,
      );
      ship.materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.emissiveIntensity = ship.litState.value * tuning.litEmissiveIntensity;
        }
      });
    };

    // Fold a ship's presence (0 off-stage → 1 centre stage) into its material opacity.
    const applyOpacity = (ship: DeckShip) => {
      // Stop drawing a craft entirely once it has faded out, rather than leaving it at opacity 0.
      //
      // The hulls are `transparent` but keep three's default `depthWrite: true`, so an invisible one
      // still STAMPS ITS SHAPE INTO THE DEPTH BUFFER. That was harmless while parked craft sat off to
      // the side; the moment they park at the origin (they leave through a gate now, so there is no
      // off-stage spot) three of them stack on the visible craft, all at the same view depth, and
      // whichever happens to draw first wins — punching a ship-shaped hole through the one you can
      // see, and through any gate standing behind it. Not drawing it at all is both the fix and
      // cheaper than drawing a fully transparent hull.
      ship.stage.visible = ship.presence.value > 0.001;
      ship.materials.forEach((material) => {
        const baseOpacity = (material.userData.baseOpacity as number | undefined) ?? 1;
        material.opacity = baseOpacity * ship.presence.value;
      });
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

    // Snap a ship out of play: invisible, at rest. Where it sits no longer matters once presence is 0
    // (applyOpacity takes its materials to zero), so it does not need an off-stage parking spot the
    // way the old side-to-side carousel did — a craft leaves through a gate now.
    const parkShip = (ship: DeckShip) => {
      gsap.killTweensOf([
        ship.stage.position, ship.stage.rotation, ship.stage.scale,
        ship.lift.rotation, ship.presence, ship.litState,
      ]);
      ship.stage.position.set(0, 0, 0);
      ship.stage.rotation.set(0, 0, 0);
      ship.stage.scale.setScalar(1);
      ship.lift.rotation.y = 0;
      ship.presence.value = 0;
      ship.litState.value = 0;
      applyOpacity(ship);
      applyLitState(ship);
    };

    // Which craft is currently staged. Initialised to the mount index so the first selection
    // effect (same index) is a no-op rather than a phantom swap.
    let stagedIndex = activeIndexRef.current;
    applyShipLighting(stagedIndex, true);

    // ── The gates ──
    // Two are always built. A narrow frame simply never shows the second and routes both halves of
    // the swap through the one standing behind the craft (see computePortalLayout).
    const exitGate = createPortalGate();
    const entryGate = createPortalGate();
    scene.add(exitGate.object, entryGate.object);
    // `formation` 0..1 drives both gates through all ten stages; `grip` holds the showroom turntable
    // still so the craft can actually keep a heading. Both are plain tweened numbers, so an
    // interrupted swap re-tweens from wherever it had got to instead of snapping.
    const portalState = { formation: 0, grip: 0 };
    let singleGateLayout = false;
    let swapActive = false;
    let swapTimeline: gsap.core.Timeline | null = null;

    /** Where the gates stand, how big they are, and whether the frame can hold a pair. */
    interface PortalLayout {
      exitPosition: THREE.Vector3;
      entryPosition: THREE.Vector3;
      gateSize: number;
      singleGate: boolean;
    }

    // Derived from the LIVE frame on every swap, never from world constants — and measured at the
    // GATE'S OWN DEPTH rather than the stage's, which is what lets GATE_DEPTH be a free choice: push the
    // gates back for a better entry angle and they keep the same size and the same place on screen.
    //
    // At portrait the visible half-width at the stage collapses to ~1.2 world units while every hull is
    // normalised to 2.3, so a fixed lateral offset puts both gates off-screen by roughly 3x.
    const computePortalLayout = (direction: number): PortalLayout => {
      const viewDistance = Math.hypot(
        tuning.cameraDistance,
        tuning.cameraHeight - tuning.cameraLookY,
      );
      const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(tuning.cameraFov / 2));
      // The camera looks slightly DOWN, so a world-z offset is not quite a depth offset. This is the
      // z component of its forward axis — ~0.993 at the resting shot, but it stays honest if the
      // camera is ever raised.
      const forwardZ = tuning.cameraDistance / viewDistance;
      const frameAt = (depth: number) => {
        const halfHeight = (viewDistance - depth * forwardZ) * tanHalfFov;
        return { halfHeight, halfWidth: halfHeight * (camera.aspect || 1) };
      };

      const stageFrame = frameAt(0);
      const gateFrame = frameAt(-GATE_DEPTH);

      const gateSize = gateFrame.halfHeight * GATE_SIZE_FRACTION;
      // The quad spans +/- gateSize/2, and the visible ring fills these fractions of it.
      const gateHalfWidth = (gateSize * PORTAL_GATE_RADIUS_X) / 2;

      // Vertically the gate is placed in the FRAME, like it is horizontally — not stood on the ground.
      // There is no ground five units behind the stage to stand it on, and what actually matters is
      // where it lands in shot. This is the camera's aim line at the gate's depth, offset by
      // GATE_Y_FRACTION.
      const aimY =
        tuning.cameraHeight +
        (tuning.cameraLookY - tuning.cameraHeight) *
          ((tuning.cameraDistance + GATE_DEPTH) / tuning.cameraDistance);
      const gateCentreY = aimY + GATE_Y_FRACTION * gateFrame.halfHeight;

      // Whether a pair fits is a SCREEN question: the hull is centre stage and the gates are five units
      // behind it, so comparing their world x would say nothing about whether they overlap in frame.
      const hullScreenHalf = SHIP_HALF_EXTENT / stageFrame.halfWidth;
      const gateScreenHalf = gateHalfWidth / gateFrame.halfWidth;
      const nearestScreenX = hullScreenHalf + gateScreenHalf + GATE_SHIP_CLEARANCE;
      const furthestScreenX = 1 - gateScreenHalf - GATE_FRAME_MARGIN;
      const singleGate = furthestScreenX < nearestScreenX;

      if (singleGate) {
        // One gate, directly behind the craft — which is also the only placement a craft can fly
        // through dead square, since the gate faces the camera and so does the craft's exit path.
        const behind = new THREE.Vector3(
          GATE_SINGLE_X * gateFrame.halfWidth * direction,
          gateCentreY,
          -GATE_DEPTH,
        );
        return { exitPosition: behind, entryPosition: behind.clone(), gateSize, singleGate };
      }

      // The old carousel convention, kept: next (+1) leaves screen-left, arrives from screen-right.
      const screenX = THREE.MathUtils.clamp(GATE_X_FRACTION, nearestScreenX, furthestScreenX);
      const gateX = screenX * gateFrame.halfWidth;
      return {
        exitPosition: new THREE.Vector3(-direction * gateX, gateCentreY, -GATE_DEPTH),
        entryPosition: new THREE.Vector3(direction * gateX, gateCentreY, -GATE_DEPTH),
        gateSize,
        singleGate,
      };
    };

    // The yaw that points the nose along a travel direction. HEADING_PHASE is this file's own datum —
    // the same one the services to works flight steers by — so the two agree about which way a hull
    // faces instead of each carrying its own guess at it.
    const aimYawTowards = (deltaX: number, deltaZ: number) =>
      Math.atan2(deltaX, deltaZ) + HEADING_PHASE;

    // Turn onto the gate, hold while it builds, then fly through it.
    const flyShipIntoGate = (
      ship: DeckShip,
      gate: THREE.Vector3,
      timeline: gsap.core.Timeline,
    ) => {
      gsap.killTweensOf([
        ship.stage.position, ship.stage.rotation, ship.stage.scale,
        ship.lift.rotation, ship.presence, ship.litState,
      ]);
      // Settle the accumulated showroom spin onto a whole turn as the craft aims, so the aim below
      // means the same thing wherever the turntable happened to be. Same trick the handoff uses.
      const settledYaw = Math.round(ship.lift.rotation.y / (Math.PI * 2)) * (Math.PI * 2);
      timeline.to(ship.lift.rotation, {
        y: settledYaw, duration: PORTAL_AIM_DURATION, ease: 'power2.inOut',
      }, 0);
      timeline.to(ship.stage.rotation, {
        y: aimYawTowards(gate.x, gate.z), duration: PORTAL_AIM_DURATION, ease: 'power2.inOut',
      }, 0);

      timeline.to(ship.stage.position, {
        x: gate.x, y: gate.y, z: gate.z,
        duration: PORTAL_FLIGHT_DURATION, ease: 'power2.in',
      }, PORTAL_LAUNCH_AT);
      timeline.to(ship.stage.rotation, {
        z: PORTAL_BANK, duration: PORTAL_FLIGHT_DURATION, ease: 'power2.in',
      }, PORTAL_LAUNCH_AT);
      timeline.to(ship.stage.scale, {
        x: PORTAL_THROUGH_SCALE, y: PORTAL_THROUGH_SCALE, z: PORTAL_THROUGH_SCALE,
        duration: PORTAL_FLIGHT_DURATION, ease: 'power2.in',
      }, PORTAL_LAUNCH_AT);
      // Presence drops late and fast: the craft is swallowed BY the gate rather than fading out on
      // the way there, which would read as it giving up half way.
      timeline.to(ship.presence, {
        value: 0, duration: PORTAL_FLIGHT_DURATION * 0.45, ease: 'power2.in',
        onUpdate: () => applyOpacity(ship),
      }, PORTAL_LAUNCH_AT + PORTAL_FLIGHT_DURATION * 0.55);
    };

    // Come out of a gate and settle centre stage, straightening into the resting three-quarter view.
    const flyShipOutOfGate = (
      ship: DeckShip,
      gate: THREE.Vector3,
      timeline: gsap.core.Timeline,
      at: number,
    ) => {
      gsap.killTweensOf([
        ship.stage.position, ship.stage.rotation, ship.stage.scale,
        ship.lift.rotation, ship.presence, ship.litState,
      ]);
      // Posed in a callback rather than up front: the craft has to stay parked until its moment, and
      // on the single-gate layout that moment is after the outgoing one has cleared the same hole.
      timeline.call(() => {
        ship.stage.position.copy(gate);
        ship.stage.rotation.set(0, aimYawTowards(-gate.x, -gate.z), -PORTAL_BANK);
        ship.stage.scale.setScalar(PORTAL_THROUGH_SCALE);
        ship.spin.rotation.set(0, BASE_YAW, 0);
        ship.lift.rotation.y = 0; // off-stage and invisible, so this snap costs nothing to look at
        ship.presence.value = 0;
        ship.litState.value = 0;
        applyOpacity(ship);
        applyLitState(ship);
      }, undefined, at);

      timeline.to(ship.stage.position, {
        x: 0, y: 0, z: 0, duration: PORTAL_ARRIVE_DURATION, ease: 'power3.out',
      }, at);
      timeline.to(ship.stage.rotation, {
        y: 0, z: 0, duration: PORTAL_ARRIVE_DURATION, ease: 'power3.out',
      }, at);
      timeline.to(ship.stage.scale, {
        x: 1, y: 1, z: 1, duration: PORTAL_ARRIVE_DURATION, ease: 'power2.out',
      }, at);
      timeline.to(ship.presence, {
        value: 1, duration: PORTAL_ARRIVE_DURATION * 0.5, ease: 'power2.out',
        onUpdate: () => applyOpacity(ship),
      }, at);
      timeline.to(ship.litState, {
        value: 1, duration: PORTAL_ARRIVE_DURATION, ease: 'power2.out',
        onUpdate: () => applyLitState(ship),
      }, at);
    };

    // Snap a craft straight to centre stage, no animation (reduced motion).
    const snapToCenter = (ship: DeckShip) => {
      gsap.killTweensOf([
        ship.stage.position, ship.stage.rotation, ship.stage.scale,
        ship.lift.rotation, ship.presence, ship.litState,
      ]);
      ship.stage.position.set(0, 0, 0);
      ship.stage.rotation.set(0, 0, 0);
      ship.stage.scale.setScalar(1);
      ship.spin.rotation.set(0, BASE_YAW, 0);
      ship.presence.value = 1;
      ship.litState.value = 1;
      applyOpacity(ship);
      applyLitState(ship);
    };

    // The one timeline a swap runs on. `outgoingIndex` is null for an entrance with nothing to send
    // away (the section scrolling back into view), which is why the gates still form but only the
    // arrival half of the choreography is used.
    const runPortalSwap = (nextIndex: number, outgoingIndex: number | null, direction: number) => {
      const layout = computePortalLayout(direction);
      singleGateLayout = layout.singleGate;
      exitGate.setPose(layout.exitPosition, camera.position, layout.gateSize);
      entryGate.setPose(layout.entryPosition, camera.position, layout.gateSize);

      swapTimeline?.kill();
      swapActive = true;
      portalState.grip = 1;
      const timeline = gsap.timeline({
        onComplete: () => {
          swapActive = false;
          swapTimeline = null;
        },
      });
      swapTimeline = timeline;

      // The gates build to "ready" just as the craft reaches one, so it crosses WHILE they finish.
      timeline.to(portalState, {
        formation: 1, duration: PORTAL_FORM_DURATION, ease: 'power2.inOut',
      }, 0);

      const arriveAt = outgoingIndex === null
        ? PORTAL_FORM_DURATION * 0.72
        : PORTAL_LAUNCH_AT + PORTAL_FLIGHT_DURATION + SWAP_GAP;

      if (outgoingIndex !== null) {
        flyShipIntoGate(ships[outgoingIndex], layout.exitPosition, timeline);
        // Fully reset only once it is through the gate and out of sight.
        timeline.call(() => parkShip(ships[outgoingIndex]), undefined, arriveAt);
      }
      flyShipOutOfGate(ships[nextIndex], layout.entryPosition, timeline, arriveAt);

      const collapseAt = arriveAt + PORTAL_ARRIVE_DURATION;
      timeline.to(portalState, {
        formation: 0, duration: PORTAL_COLLAPSE_DURATION, ease: 'power2.in',
      }, collapseAt);
      // Hand the showroom turntable back only once the craft has actually settled.
      timeline.to(portalState, {
        grip: 0, duration: PORTAL_GRIP_RELEASE, ease: 'power2.out',
      }, collapseAt);
    };

    // Send the current craft through a gate and bring the next one out of the other. Direction
    // (+1 next / -1 prev) decides which gate is which, so it still reads as the carousel moving.
    const setStage = (nextIndex: number) => {
      if (nextIndex === stagedIndex && ships[nextIndex]?.presence.value === 1) return;
      const direction = nextIndex > stagedIndex ? 1 : -1;
      const previousIndex = stagedIndex;
      stagedIndex = nextIndex;
      applyShipLighting(nextIndex);

      if (reduceMotion) {
        ships.forEach((ship, index) => {
          if (index === nextIndex) snapToCenter(ship);
          else parkShip(ship);
        });
        return;
      }

      // Everything that is neither arriving nor leaving goes straight out of play.
      ships.forEach((ship, index) => {
        if (index !== nextIndex && index !== previousIndex) parkShip(ship);
      });
      runPortalSwap(nextIndex, previousIndex === nextIndex ? null : previousIndex, direction);
    };
    setStageRef.current = setStage;

    // Replay the whole entrance for the currently-staged craft — fired by DECK_REVEAL_EVENT every
    // time the section scrolls back into view, so "scroll away then back" runs the animation again.
    // Nothing is leaving, so the gates form and the craft simply steps out of one.
    const replayEntrance = () => {
      const index = activeIndexRef.current;
      stagedIndex = index;
      applyShipLighting(index);
      ships.forEach((ship) => parkShip(ship));
      if (reduceMotion) {
        snapToCenter(ships[index]);
        return;
      }
      runPortalSwap(index, null, 1);
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
    const nextWarmupFrame = () =>
      new Promise<void>((resolve) => {
        warmupFrame = requestAnimationFrame(() => resolve());
      });
    const prewarmPipeline = async () => {
      if (warmupStarted || disposed) return;
      warmupStarted = true;
      // Open the gates a crack first. `compileAsync` walks only VISIBLE objects, and a gate hides
      // itself at formation 0 (see PortalGate.update) — so without this the portal shader is not
      // built until the first swap, which is the exact stall this whole warm-up exists to prevent.
      //
      // ⚠ That premise no longer holds on three r184: `compile` gathers LIGHTS with `traverseVisible`
      // but materials with plain `traverse`, so a hidden object is compiled regardless. Kept anyway —
      // it costs nothing, it is correct on either behaviour, and it is not worth re-testing the deck to
      // remove. Do NOT cite it as evidence that hiding an object defers its compile; the sun's corona
      // freeze (see `warmStarMaterials` in SunModelCanvas) was a first-DRAW problem, not a visibility
      // one, and needed an explicit `initTexture` pass that this does not do.
      // The deck is off screen throughout, and the render loop's own draw is gated off, so nothing
      // is on screen to see them. Cleared on every exit path below.
      portalState.formation = PORTAL_PREWARM_FORMATION;
      // Same reason, and the reason this matters for the FLEET as well: a parked craft is no longer
      // drawn at all (see applyOpacity), so only the centred hull would be walked here and the other
      // three would compile on the frame they first fly out of a gate. Show every hull for the
      // compile; applyOpacity puts each back where its presence says it belongs.
      ships.forEach((ship) => {
        ship.stage.visible = true;
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
      } catch {
        // A failed compile is not a reason to trap the loader; whatever failed compiles on first draw.
      } finally {
        portalState.formation = 0;
        ships.forEach((ship) => applyOpacity(ship));
        if (!disposed) reportWarmupDone('deck'); // the intro holds the reveal until this fires
      }
    };
    const onWarmupRequested = () => {
      void prewarmPipeline();
    };
    window.addEventListener(ASSETS_WARMUP_EVENT, onWarmupRequested);

    // ── Model loading (Draco-compressed) ──
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    // ── Load the four vessels (Draco-compressed) ──
    const loadProgress = new Array(ships.length).fill(0);
    const emitStatus = () => {
      const isDone = loadProgress.every((value) => value >= 1);
      const summed = loadProgress.reduce((total, value) => total + value, 0);
      const fraction = summed / ships.length;
      // Feed the intro's honest loader (combined with the works field) so the reveal can wait for
      // the fleet to actually be in.
      reportAssetProgress('deck', fraction);
      onStatus({ isLoading: !isDone, percent: isDone ? 100 : Math.round(fraction * 100) });
      // Warm as soon as THIS section's own vessels are in, rather than waiting on the whole page. See
      // the note on `prewarmPipeline` for why the shared wait was costing the loader its finale.
      if (isDone) void prewarmPipeline();
    };
    emitStatus();

    DECK_SERVICES.forEach((service, index) => {
      gltfLoader.load(
        service.modelPath,
        (gltf) => {
          const vessel = prepareVessel(gltf.scene, service.modelRotation);
          const ship = ships[index];
          ship.spin.add(vessel);
          ship.vessel = vessel;
          // Catalogue every mesh by positional id, and honour whatever is already
          // baked into the tuning as hidden. Switched off rather than culled: a hidden piece has to be able
          // to come back on, and a hull is small enough that a hidden mesh costs nothing to keep around.
          let partIndex = 0;
          vessel.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            const partId = `${index}:${partIndex}`;
            partIndex += 1;
            ship.parts.set(partId, child);
            if (tuning.ships[index]?.hiddenParts.includes(partId)) child.visible = false;
          });
          // Re-skin every hull material onto this ship's graded palette + accent glow.
          ship.materials = applyHullMaterials(
            vessel,
            service.profile,
            { brightness: ship.brightnessUniform, emitPulse: ship.emitPulseUniform },
            lowPower,
          );

          // The centred craft shows immediately; the rest wait off-stage. (Materials only exist
          // now, so the initial pose has to be applied after the model arrives.)
          if (index === stagedIndex) {
            ship.stage.position.set(0, 0, 0);
            ship.presence.value = 1;
            ship.litState.value = 1;
          } else {
            // No off-stage parking spot any more — presence 0 is what hides a craft (see parkShip).
            ship.stage.position.set(0, 0, 0);
            ship.presence.value = 0;
            ship.litState.value = 0;
          }
          applyOpacity(ship);
          applyLitState(ship);

          loadProgress[index] = 1;
          emitStatus();
        },
        (progressEvent) => {
          if (progressEvent.total > 0) {
            loadProgress[index] = progressEvent.loaded / progressEvent.total;
            emitStatus();
          }
        },
        (error) => {
          console.error(`Failed to load vessel: ${service.modelPath}`, error);
          loadProgress[index] = 1;
          emitStatus();
        },
      );
    });

    // ── Drag-to-rotate + flick ──
    // Pointer down on the canvas grabs the centred craft. Dragging rotates it; on release a big
    // horizontal travel is read as a flick (switch carousel), otherwise the craft springs back.
    const drag = { active: false, startX: 0, startY: 0, startTime: 0 };

    const activeShip = () => ships[activeIndexRef.current];

    const handlePointerDown = (event: PointerEvent) => {
      // Drag only rotates the resting craft — it's disabled during the flight (the
      // camera is scripted there, so a drag would fight it).
      if (reduceMotion || departState.engaged) return;
      drag.active = true;
      drag.startX = event.clientX;
      drag.startY = event.clientY;
      drag.startTime = performance.now();
      const ship = activeShip();
      if (ship) gsap.killTweensOf(ship.spin.rotation);
      canvas.setPointerCapture?.(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!drag.active) return;
      const ship = activeShip();
      if (!ship) return;
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
      const ship = activeShip();
      if (ship) {
        gsap.to(ship.spin.rotation, {
          x: 0, y: BASE_YAW, duration: SPRING_DURATION, ease: 'elastic.out(1, 0.5)', overwrite: true,
        });
      }
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
    const applyRendererSize = () => {
      const width  = canvas.clientWidth  || canvas.offsetWidth;
      const height = canvas.clientHeight || canvas.offsetHeight;
      if (!width || !height) return;
      const ratio = getPixelRatio();
      appliedPixelRatio = ratio;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(ratio);
      renderer.setSize(width, height, false);
      composer.setPixelRatio(ratio);
      composer.setSize(width, height);
    };

    // ── Render loop ──
    const clock = new THREE.Clock();
    let frameId = 0;
    // 0..1 inside a departure window, clamped flat outside it — keeps each beat in sequence.
    const departWindow = (curveWindow: [number, number], value: number) =>
      THREE.MathUtils.clamp((value - curveWindow[0]) / (curveWindow[1] - curveWindow[0]), 0, 1);

    const renderFrame = () => {
      frameId = requestAnimationFrame(renderFrame);

      // getDelta() advances the clock and updates elapsedTime, so read elapsedTime directly after
      // (calling getElapsedTime() too would double-advance the delta).
      const deltaSeconds = clock.getDelta();
      const elapsed = clock.elapsedTime;
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

      ships.forEach((ship, shipIndex) => {
        const placement = tuning.ships[shipIndex];
        if (!ship.vessel || !placement) return;
        ship.vessel.position.set(placement.x, placement.y, placement.z);
        ship.vessel.rotation.set(
          THREE.MathUtils.degToRad(placement.rotX),
          THREE.MathUtils.degToRad(placement.rotY),
          THREE.MathUtils.degToRad(placement.rotZ),
        );
        ship.vessel.scale.setScalar(placement.scale);
      });

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

      const centred = activeIndexRef.current;
      ships.forEach((ship, index) => {
        const isCentred = index === centred;
        // Only the centred craft animates; the rest rest flat off-stage.
        const animateCentred = isCentred && !reduceMotion;
        // 1. Float / hover bob — drifts up and down.
        ship.lift.position.y = SHIP_HOVER + (animateCentred ? Math.sin(elapsed * FLOAT_SPEED) * FLOAT_AMPLITUDE : 0);
        // 2. Slow turntable spin — paused while dragging so manual rotation stays precise, and
        //    wound down as the departure takes its grip so the craft can hold a heading.
        //    A swap grips it too: the craft has to hold the heading it just turned onto, and the
        //    turntable underneath would drag it off the gate while it flew.
        if (animateCentred && !drag.active) {
          ship.lift.rotation.y +=
            AUTO_ROTATE_SPEED * deltaSeconds * (1 - departGrip) * (1 - portalState.grip);
        }
        // 3. Engine-glow breathing.
        ship.emitPulseUniform.value = animateCentred
          ? 1 + Math.sin(elapsed * tuning.emitPulseSpeed) * tuning.emitPulseAmplitude
          : 1;
        // 4. Third-person flight weave — banks + sways the chase ship so it reads as actively flying.
        //    Ramped in by `departure` (0 during normal fleet browsing → full at the parked chase view).
        const flightIdle = animateCentred && departState.engaged ? departure : 0;
        ship.lift.rotation.z = Math.sin(elapsed * FLIGHT_WEAVE_ROLL_SPEED) * FLIGHT_WEAVE_ROLL_AMP * flightIdle;
        ship.lift.rotation.x = Math.sin(elapsed * FLIGHT_WEAVE_PITCH_SPEED + 1.3) * FLIGHT_WEAVE_PITCH_AMP * flightIdle;
        ship.lift.position.x = Math.sin(elapsed * FLIGHT_WEAVE_SWAY_SPEED + 0.7) * FLIGHT_WEAVE_SWAY_AMP * flightIdle;
      });

      // ── The gates ──
      // Forced shut for the whole services → works handoff. They cannot normally overlap it (a swap
      // runs on an index change, the handoff is the crossing after the last one), but an interrupted
      // swap could otherwise leave a gate standing in the shot as the craft flies you out.
      const gateFormation = departState.engaged ? 0 : portalState.formation;
      exitGate.update(elapsed, gateFormation);
      // On a narrow frame both halves of the swap share the exit gate, so the second never appears.
      entryGate.update(elapsed, singleGateLayout ? 0 : gateFormation);

      // ── The services → works flight ──
      if (departState.engaged) {
        // One shared pose drives the ship + the camera swing (see lib/handoffFlightPath.ts). At
        // progress 0 it returns the exact resting camera + an identity ship, so entering/leaving the
        // flight is seamless with normal fleet browsing.
        computeFlightPose(departure, flightPose);

        // Exit whoosh — scrubbed straight off the handoff progress (no time-based tween, no sentinel):
        // fully off-screen by progress 1, and it flies cleanly back on when scrubbed backward.
        const exitAmount = THREE.MathUtils.smoothstep(departure, EXIT_PROGRESS_START, EXIT_PROGRESS_END);

        ships.forEach((ship, index) => {
          if (index !== centred) {
            // Any residue from an interrupted flight heals the moment a ship isn't the centred one.
            ship.depart.position.set(0, 0, 0);
            ship.depart.rotation.set(0, 0, 0);
            ship.depart.scale.setScalar(1);
            return;
          }
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
        });

        // Drive the shared camera: holds through the launch, then tracks the ship left, then frames
        // the meteor.
        camera.position.copy(flightPose.cameraPosition);
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
      if (isDrawing) composer.render();

      // ── Adaptive resolution: only ever re-sized while this scene is NOT being drawn ──
      // Applying a new pixel ratio reallocates the whole composer (the UnrealBloom target pyramid +
      // the SMAA buffers) — it blocks for a frame or more. Never do that on a scene the user is
      // looking at, and ESPECIALLY not "hidden behind" some motion: the tweens keep advancing in real
      // time through the stall, so the motion visibly JUMPS on the far side of it. So we wait for a
      // genuinely idle moment — the deck off screen (the fill phase, or parked behind works) or the
      // tab backgrounded. Also frozen entirely through the handoff — and through a portal swap, which
      // is the same hazard for the same reason: ~2.8s of tweened motion the user is watching, where a
      // reallocation stall would let the timeline advance behind it and land the craft somewhere else.
      if (!handoffActive && !swapActive) {
        const targetRatio = getPixelRatio();
        if (targetRatio === appliedPixelRatio) {
          // In sync with the controller → measure this frame. Only frames we actually DREW, so idle
          // (gated-off) frames can never fake headroom and trick it into ramping the resolution up.
          if (isDrawing) sampleFrame(deltaSeconds);
        } else if (!isDrawing) {
          applyRendererSize();
        }
        // Else: a change is queued but we're on screen — hold it, and deliberately STOP sampling
        // until it lands. Measuring at the old ratio while the controller believes it's already at
        // the new one would feed it a lie and make it over-climb.
      }
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
      window.removeEventListener(HANDOFF_PROGRESS_EVENT, onHandoffProgress);
      // Stop any running tweens, then dispose every loaded hull's geometry + materials.
      ships.forEach((ship) => {
        gsap.killTweensOf(ship.litState);
        gsap.killTweensOf(ship.presence);
        gsap.killTweensOf(ship.stage.position);
        gsap.killTweensOf(ship.stage.rotation);
        gsap.killTweensOf(ship.stage.scale);
        gsap.killTweensOf(ship.spin.rotation);
        ship.spin.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            const meshMaterials = Array.isArray(child.material) ? child.material : [child.material];
            meshMaterials.forEach((material) => material.dispose());
          }
        });
      });
      gsap.killTweensOf(rimLight.color);
      gsap.killTweensOf(keyLight.color);
      gsap.killTweensOf(keyLight);
      gsap.killTweensOf(fillLight.color);
      dracoLoader.dispose();
      starfield.geometry.dispose();
      starfieldMaterial.dispose();
      swapTimeline?.kill();
      exitGate.dispose();
      entryGate.dispose();
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
