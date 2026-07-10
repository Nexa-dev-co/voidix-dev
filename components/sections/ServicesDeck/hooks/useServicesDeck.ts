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

// ── Framing ─────────────────────────────────────────────────────────────
const CAMERA_FOV      = 34;
const CAMERA_DISTANCE = 8.2;
const CAMERA_HEIGHT   = 1.7;
const CAMERA_LOOK_Y   = 0.75; // look slightly down onto the pad so the craft reads as "landed"

// ── Landing pad ─────────────────────────────────────────────────────────
const GROUND_Y          = 0;   // the pad's top surface sits here; the craft hovers just above it
const PAD_MODEL_PATH     = '/models/space_landing.glb';
const PAD_TARGET_WIDTH   = 5.0; // largest horizontal dimension the pad is normalised to
const PAD_Y_OFFSET       = 0.6; // raise the pad so its platform surface comes up under the craft
                                // (the model's bounding box is taller than the visible deck)
// Recolour the pad to fit the scene — a dark slate body with a faint cyan glow in its recesses.
// PAD_COLOR multiplies the model's texture (detail stays; hue shifts); tune these to taste.
const PAD_COLOR              = 0x16222b;
const PAD_EMISSIVE_COLOR     = 0x0b3a45;
const PAD_EMISSIVE_INTENSITY = 0.55;

// ── Starfield ───────────────────────────────────────────────────────────
const STAR_COUNT         = 1200;
const STAR_INNER_RADIUS  = 18;  // a spherical shell so stars wrap the scene without crowding the pad
const STAR_OUTER_RADIUS  = 60;
const STAR_SIZE          = 0.16;
const STAR_OPACITY       = 0.85;
const STAR_DRIFT         = 0.011; // radians/second of yaw drift — the "floating through space" feel

// ── Fleet ───────────────────────────────────────────────────────────────
const DRACO_DECODER_PATH = '/draco/';
const TARGET_SIZE = 2.3;  // largest dimension every vessel is normalised to
const BASE_YAW    = -0.6; // resting 3/4 view so hulls don't read flat-on
const SHIP_HOVER  = 0.05; // resting height the centred craft sits above the pad (was floating high)
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

// ── Contact shadow (one soft blob on the pad, under the centred craft) ──
const SHADOW_TEXTURE_PX = 256;
const SHADOW_SIZE       = 2.2;
const SHADOW_OPACITY    = 0.5;
const SHADOW_LIFT       = 0.01; // nudge above the pad to avoid z-fighting

// ── Lighting (shared stage rig; the centred craft is always powered) ──
const KEY_LIGHT_COLOR      = 0xfff2e2; // warm key so the hull reads with its own colour, not washed cold
const KEY_LIGHT_INTENSITY  = 2.4;      // directional → reveals the surface/normal detail
const FILL_LIGHT_COLOR     = 0x9aa7bb; // neutral cool fill
const FILL_LIGHT_INTENSITY = 0.5;
const RIM_LIGHT_INTENSITY  = 0.8;      // a cyan-ish edge by default; recoloured per ship (see applyRimColor)
const AMBIENT_INTENSITY    = 0.16;     // low so the directional key carves out contrast/texture
const TONE_MAPPING_EXPOSURE = 1.18;
// The active ship's edge light eases to the ship's own rim colour, so each craft feels lit for itself.
const RIM_LIGHT_TWEEN = 0.5;

// ── Powered-on look ──
// Each hull wears a graded-palette shader (see hullMaterial.ts): the model's own albedo luminance
// is mapped onto the ship's shadow/hull/highlight tones, so it stays multi-tonal. The centred craft
// sits bright; a craft leaving the pad dims back as it fades. The accent glow + rim live in the
// shader; here we only drive the shared brightness uniform + the native emissive intensity.
const DORMANT_BRIGHTNESS     = 0.4; // hull brightness as a craft leaves the pad (dim)
const ACTIVE_BRIGHTNESS      = 1.0; // hull brightness on the centred craft
const LIT_EMISSIVE_INTENSITY = 1.3; // any native emissive map's intensity when centred

// ── Engine glow pulse (centred craft only) ──
const EMIT_PULSE_AMPLITUDE = 0.22; // ± on the accent-glow strength
const EMIT_PULSE_SPEED     = 1.6;

// ── Selective bloom (threshold so only the bright accents/highlights glow) ──
const BLOOM_STRENGTH       = 0.85;
const BLOOM_STRENGTH_LOW   = 0.5;  // gentler on low-power devices
const BLOOM_RADIUS         = 0.5;
const BLOOM_THRESHOLD      = 0.7;
const BLOOM_MSAA_SAMPLES   = 4;    // MSAA on the composer target (antialias:true is ignored once a composer renders)

// ── Carousel swap (single pad: the current craft flies off, THEN the next flies on) ──
// The two halves are sequenced — the outgoing craft fully clears the pad before the incoming one
// arrives — so they never overlap/clip through each other at centre. Each banks + warps in scale
// for a more cinematic hand-off.
const SWAP_OUT_DURATION = 0.5;  // the leaving craft's exit
const SWAP_GAP          = 0.06; // empty beat on the pad between the two
const SWAP_IN_DURATION  = 0.62; // the arriving craft's entrance
const SWAP_OFFSET_X     = 3.6;  // how far to the side a craft sits while off-stage
const SWAP_OFFSET_Y     = 0.55; // lift as it leaves / arrives so it arcs rather than slides flat
const SWAP_BANK         = 0.5;  // radians the craft rolls (banks) as it slides off / in
const SWAP_ENTER_SCALE  = 0.6;  // the craft warps in from this scale
const SWAP_EXIT_SCALE   = 0.7;  // and shrinks to this as it leaves

// ── Departure — the services → works flight (the ship no longer exits; it flies you in) ──
// Scrubbed by the hero pin via HANDOFF_PROGRESS_EVENT. The ship's motion + the camera come from the
// shared choreography in lib/handoffFlightPath.ts (see docs/services-to-works-flight.md); here we own
// only the deck-local anchors: the pad + sun STAY put (the camera leaves the pad behind by moving),
// the contact shadow fades as the ship lifts off, and the deck starfield fades out during the fly-left
// so the works field's streaking stars take over. Each value reverses cleanly when scrolled back.
const SHADOW_FADE_WINDOW:    [number, number] = [0.03, 0.20]; // shadow fades as the ship lifts (Phase A)
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
// tracked so far left (near x=−15) that the pad at the origin sits well outside its frustum — so the
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
const REST_BLEND_END   = 0.12;              // ease the heading back to the pad's rest pose near progress 0

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
  /** Index of the craft currently on the pad. Read live from the render loop / handlers. */
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
  materials: THREE.Material[];
  /** Shared across this ship's hull materials → driven by litState (dim when leaving, bright when centred). */
  brightnessUniform: { value: number };
  /** Shared engine-glow breathing — modulated on the centred craft each frame. */
  emitPulseUniform: { value: number };
  /** 0 = dim (leaving), 1 = fully powered (centred). GSAP tweens this → brightness + emissive. */
  litState: { value: number };
  /** 0 = off-stage/invisible, 1 = on the pad. GSAP tweens this → material opacity. */
  presence: { value: number };
}

// Soft dark blob → the contact shadow the centred craft casts onto the pad.
function createShadowTexture(): THREE.Texture {
  const textureCanvas = document.createElement('canvas');
  textureCanvas.width = SHADOW_TEXTURE_PX;
  textureCanvas.height = SHADOW_TEXTURE_PX;
  const context = textureCanvas.getContext('2d');
  if (context) {
    const center = SHADOW_TEXTURE_PX / 2;
    const gradient = context.createRadialGradient(center, center, 0, center, center, center);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    gradient.addColorStop(0.7, 'rgba(0, 0, 0, 0.18)');
    gradient.addColorStop(1, 'rgba(0, 0, 0, 0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, SHADOW_TEXTURE_PX, SHADOW_TEXTURE_PX);
  }
  return new THREE.CanvasTexture(textureCanvas);
}

// A spherical shell of faint points wrapping the scene — the "stars in the section". Additive so
// they glint against the black without lighting the pad.
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
    opacity: STAR_OPACITY,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(geometry, material);
}

// Centre the model, scale so every hull reads at the same size, and rest its base on y = 0 (origin
// at the base, not the centre) so a craft sits ON the pad when its rig is at y = 0.
function prepareVessel(
  loadedScene: THREE.Group,
  rotationDegrees?: { x?: number; y?: number; z?: number },
): THREE.Group {
  // Apply any per-ship base rotation BEFORE measuring, so the bounding box (and the base-on-ground
  // placement below) accounts for the new orientation — a flipped hull still sits right on the pad.
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

    // ── Renderer ──
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    // Shared adaptive resolution (drops under load, climbs back when smooth) — see applyRendererSize.
    renderer.setPixelRatio(getPixelRatio());
    // Neutral tone mapping holds the hull colours instead of desaturating highlights the way ACES
    // does — the fleet read flat/grey under ACES. OutputPass applies this after the composer.
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);
    camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);
    camera.lookAt(0, CAMERA_LOOK_Y, 0);

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
    scene.add(keyLight, fillLight, rimLight, new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY));

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

    // ── Contact shadow (one blob centred on the pad) ──
    const shadowTexture  = createShadowTexture();
    const shadowMaterial = new THREE.MeshBasicMaterial({
      map: shadowTexture,
      transparent: true,
      opacity: SHADOW_OPACITY,
      depthWrite: false,
    });
    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(SHADOW_SIZE, SHADOW_SIZE), shadowMaterial);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = GROUND_Y + SHADOW_LIFT;
    scene.add(shadow);

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
        materials: [],
        brightnessUniform: { value: ACTIVE_BRIGHTNESS },
        emitPulseUniform: { value: 1 },
        litState: { value: 0 },
        presence: { value: 0 },
      };
    });

    // Push a ship's lit value (0..1) onto its (shared) hull brightness + native emissive strength.
    const applyLitState = (ship: DeckShip) => {
      ship.brightnessUniform.value = THREE.MathUtils.lerp(
        DORMANT_BRIGHTNESS, ACTIVE_BRIGHTNESS, ship.litState.value,
      );
      ship.materials.forEach((material) => {
        if (material instanceof THREE.MeshStandardMaterial) {
          material.emissiveIntensity = ship.litState.value * LIT_EMISSIVE_INTENSITY;
        }
      });
    };

    // Fold a ship's presence (0 off-stage → 1 on the pad) into its material opacity.
    const applyOpacity = (ship: DeckShip) => {
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
        keyLight.intensity = keyIntensity;
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
      gsap.to(keyLight, {
        intensity: keyIntensity,
        duration: RIM_LIGHT_TWEEN, ease: 'power2.out', overwrite: true,
      });
      gsap.to(fillLight.color, {
        r: fillTarget.r, g: fillTarget.g, b: fillTarget.b,
        duration: RIM_LIGHT_TWEEN, ease: 'power2.out', overwrite: true,
      });
    };

    // Snap a ship to its off-stage parked pose (invisible, waiting at the side).
    const parkShip = (ship: DeckShip, fromX: number) => {
      gsap.killTweensOf([ship.stage.position, ship.stage.rotation, ship.stage.scale, ship.presence, ship.litState]);
      ship.stage.position.set(fromX, SWAP_OFFSET_Y, 0);
      ship.stage.rotation.set(0, 0, 0);
      ship.stage.scale.setScalar(1);
      ship.presence.value = 0;
      ship.litState.value = 0;
      applyOpacity(ship);
      applyLitState(ship);
    };

    // Which craft is currently staged. Initialised to the mount index so the first selection
    // effect (same index) is a no-op rather than a phantom swap.
    let stagedIndex = activeIndexRef.current;
    applyShipLighting(stagedIndex, true);

    // Warp a craft onto the pad: snap it off-stage (banked + shrunk, hidden) then ease it to centre.
    // `delay` lets the swap hold it off until the outgoing craft has cleared.
    const enterShip = (ship: DeckShip, direction: number, delay: number) => {
      gsap.killTweensOf([ship.stage.position, ship.stage.rotation, ship.stage.scale, ship.presence, ship.litState]);
      ship.stage.position.set(direction * SWAP_OFFSET_X, SWAP_OFFSET_Y, 0);
      ship.stage.rotation.set(0, 0, direction * SWAP_BANK);
      ship.stage.scale.setScalar(SWAP_ENTER_SCALE);
      ship.spin.rotation.set(0, BASE_YAW, 0);
      ship.presence.value = 0;
      applyOpacity(ship);

      gsap.to(ship.stage.position, {
        x: 0, y: 0, z: 0, duration: SWAP_IN_DURATION, delay, ease: 'power3.out', overwrite: true,
      });
      gsap.to(ship.stage.rotation, {
        z: 0, duration: SWAP_IN_DURATION, delay, ease: 'power3.out', overwrite: true,
      });
      gsap.to(ship.stage.scale, {
        x: 1, y: 1, z: 1, duration: SWAP_IN_DURATION, delay, ease: 'back.out(1.5)', overwrite: true,
      });
      gsap.to(ship.presence, {
        value: 1, duration: SWAP_IN_DURATION * 0.7, delay, ease: 'power2.out', overwrite: true,
        onUpdate: () => applyOpacity(ship),
      });
      gsap.to(ship.litState, {
        value: 1, duration: SWAP_IN_DURATION, delay, ease: 'power2.out', overwrite: true,
        onUpdate: () => applyLitState(ship),
      });
    };

    // Fly a craft off the pad toward the trailing side — banking, shrinking, dimming, fading.
    const exitShip = (ship: DeckShip, direction: number) => {
      gsap.killTweensOf([ship.stage.position, ship.stage.rotation, ship.stage.scale, ship.presence, ship.litState]);
      gsap.to(ship.stage.position, {
        x: -direction * SWAP_OFFSET_X, y: SWAP_OFFSET_Y, z: 0,
        duration: SWAP_OUT_DURATION, ease: 'power3.in', overwrite: true,
      });
      gsap.to(ship.stage.rotation, {
        z: -direction * SWAP_BANK, duration: SWAP_OUT_DURATION, ease: 'power2.in', overwrite: true,
      });
      gsap.to(ship.stage.scale, {
        x: SWAP_EXIT_SCALE, y: SWAP_EXIT_SCALE, z: SWAP_EXIT_SCALE,
        duration: SWAP_OUT_DURATION, ease: 'power2.in', overwrite: true,
      });
      gsap.to(ship.presence, {
        value: 0, duration: SWAP_OUT_DURATION, ease: 'power2.in', overwrite: true,
        onUpdate: () => applyOpacity(ship),
      });
      gsap.to(ship.litState, {
        value: 0, duration: SWAP_OUT_DURATION, ease: 'power2.in', overwrite: true,
        onUpdate: () => applyLitState(ship),
      });
    };

    // Snap a craft straight onto the pad, no animation (reduced motion).
    const snapToCenter = (ship: DeckShip) => {
      gsap.killTweensOf([ship.stage.position, ship.stage.rotation, ship.stage.scale, ship.presence, ship.litState]);
      ship.stage.position.set(0, 0, 0);
      ship.stage.rotation.set(0, 0, 0);
      ship.stage.scale.setScalar(1);
      ship.spin.rotation.set(0, BASE_YAW, 0);
      ship.presence.value = 1;
      ship.litState.value = 1;
      applyOpacity(ship);
      applyLitState(ship);
    };

    // Fly the current craft off the pad and — once it has cleared — the next one on. Direction
    // (+1 next / −1 prev) decides which side each enters/leaves from, so the swap reads as the
    // carousel moving. The arrival is delayed past the exit so the two never collide at centre.
    const enterDelay = SWAP_OUT_DURATION + SWAP_GAP;
    const setStage = (nextIndex: number) => {
      if (nextIndex === stagedIndex && ships[nextIndex]?.presence.value === 1) return;
      const direction = nextIndex > stagedIndex ? 1 : -1;
      const previousIndex = stagedIndex;
      stagedIndex = nextIndex;
      applyShipLighting(nextIndex);

      ships.forEach((ship, index) => {
        const isCenter  = index === nextIndex;
        const isLeaving = index === previousIndex && previousIndex !== nextIndex;
        if (reduceMotion) {
          if (isCenter) snapToCenter(ship);
          else parkShip(ship, direction * SWAP_OFFSET_X);
        } else if (isCenter) {
          enterShip(ship, direction, enterDelay);
        } else if (isLeaving) {
          exitShip(ship, direction);
        } else {
          parkShip(ship, direction * SWAP_OFFSET_X);
        }
      });
    };
    setStageRef.current = setStage;

    // Replay the whole entrance for the currently-staged craft — fired by DECK_REVEAL_EVENT every
    // time the section scrolls back into view, so "scroll away then back" runs the animation again.
    const replayEntrance = () => {
      const index = activeIndexRef.current;
      stagedIndex = index;
      applyShipLighting(index);
      ships.forEach((ship, shipIndex) => {
        if (shipIndex !== index) {
          parkShip(ship, SWAP_OFFSET_X);
        } else if (reduceMotion) {
          snapToCenter(ship);
        } else {
          // Nothing is leaving, so it flies straight in (no exit delay).
          enterShip(ship, 1, 0);
        }
      });
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

    // Warm the shaders + bloom pipeline before the deck is ever shown, so its first visible frame at
    // the services reveal doesn't stall on compilation. The intro fires ASSETS_WARMUP_EVENT once
    // assets are in; we compile ASYNCHRONOUSLY (KHR_parallel_shader_compile where available) so the
    // build runs on the driver's background threads instead of blocking the main thread — a
    // synchronous compile here froze ~0.2s right as the reveal began. The deck isn't shown until the
    // user scrolls to services, so there's ample time; the single composer.render() that warms the
    // bloom passes lands after the promise resolves, while the deck is still hidden.
    let disposed = false;
    const prewarmPipeline = () => {
      renderer
        .compileAsync(scene, camera)
        .then(() => {
          if (disposed) return;
          // Forces the bloom passes to compile too (this is the only part that can still block, and
          // only on a GPU with no parallel-compile extension — during the intro hold, never at reveal).
          composer.render();
          reportWarmupDone('deck'); // the intro holds the reveal until this fires
        })
        .catch(() => { if (!disposed) reportWarmupDone('deck'); });
    };
    window.addEventListener(ASSETS_WARMUP_EVENT, prewarmPipeline);

    // ── Load the landing pad (once) ──
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    const gltfLoader = new GLTFLoader();
    gltfLoader.setDRACOLoader(dracoLoader);

    let padGroup: THREE.Group | null = null;
    gltfLoader.load(
      PAD_MODEL_PATH,
      (gltf) => {
        const loadedScene = gltf.scene;
        // Retint the pad to the scene palette.
        loadedScene.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            const padMaterials = Array.isArray(child.material) ? child.material : [child.material];
            padMaterials.forEach((material) => {
              if (material instanceof THREE.MeshStandardMaterial) {
                material.color.set(PAD_COLOR);
                material.emissive.set(PAD_EMISSIVE_COLOR);
                material.emissiveIntensity = PAD_EMISSIVE_INTENSITY;
              }
            });
          }
        });
        const boundingBox = new THREE.Box3().setFromObject(loadedScene);
        const size   = boundingBox.getSize(new THREE.Vector3());
        const center = boundingBox.getCenter(new THREE.Vector3());
        loadedScene.position.sub(center);

        const padScale = PAD_TARGET_WIDTH / (Math.max(size.x, size.z) || 1);
        const scaledHeight = size.y * padScale;
        const group = new THREE.Group();
        group.scale.setScalar(padScale);
        group.add(loadedScene);
        // Align the pad's top with the ground so the craft hovers just above the surface.
        group.position.y = GROUND_Y - scaledHeight / 2 + PAD_Y_OFFSET;
        scene.add(group);
        padGroup = group;
      },
      undefined,
      (error) => console.error(`Failed to load landing pad: ${PAD_MODEL_PATH}`, error),
    );

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
    };
    emitStatus();

    DECK_SERVICES.forEach((service, index) => {
      gltfLoader.load(
        service.modelPath,
        (gltf) => {
          const vessel = prepareVessel(gltf.scene, service.modelRotation);
          const ship = ships[index];
          ship.spin.add(vessel);
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
            ship.stage.position.set(SWAP_OFFSET_X, SWAP_OFFSET_Y, 0);
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
      // Drag only rotates the craft on the resting pad — it's disabled during the flight (the
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
        if (animateCentred && !drag.active) {
          ship.lift.rotation.y += AUTO_ROTATE_SPEED * deltaSeconds * (1 - departGrip);
        }
        // 3. Engine-glow breathing.
        ship.emitPulseUniform.value = animateCentred
          ? 1 + Math.sin(elapsed * EMIT_PULSE_SPEED) * EMIT_PULSE_AMPLITUDE
          : 1;
        // 4. Third-person flight weave — banks + sways the chase ship so it reads as actively flying.
        //    Ramped in by `departure` (0 during normal fleet browsing → full at the parked chase view).
        const flightIdle = animateCentred && departState.engaged ? departure : 0;
        ship.lift.rotation.z = Math.sin(elapsed * FLIGHT_WEAVE_ROLL_SPEED) * FLIGHT_WEAVE_ROLL_AMP * flightIdle;
        ship.lift.rotation.x = Math.sin(elapsed * FLIGHT_WEAVE_PITCH_SPEED + 1.3) * FLIGHT_WEAVE_PITCH_AMP * flightIdle;
        ship.lift.position.x = Math.sin(elapsed * FLIGHT_WEAVE_SWAY_SPEED + 0.7) * FLIGHT_WEAVE_SWAY_AMP * flightIdle;
      });

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

        // The pad + sun are the stationary anchors — the pad does NOT sink (the camera leaves it
        // behind by tracking away). Only the contact shadow fades as the ship lifts off, and the deck
        // starfield fades out during the fly-left so the works field's streaking stars take over.
        shadowMaterial.opacity = SHADOW_OPACITY * (1 - departWindow(SHADOW_FADE_WINDOW, departure));
        starfieldMaterial.opacity = STAR_OPACITY * (1 - departWindow(DECK_STAR_FADE_WINDOW, departure));

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
      if (deckShouldRender && !document.hidden && !parkedAtWorks) {
        composer.render();
        // Adaptive resolution: measure THIS drawn frame, and re-size if the shared ratio has shifted.
        // Only sampled while actually drawing (idle frames never fake headroom), and frozen through the
        // handoff so a target reallocation can never hitch the ship's fly-in.
        const handoffActive = departState.current > 0.001 && departState.current < 0.999;
        if (!handoffActive) {
          sampleFrame(deltaSeconds);
          if (getPixelRatio() !== appliedPixelRatio) applyRendererSize();
        }
      }
    };
    renderFrame();

    // ── Resize ──
    applyRendererSize();
    const resizeObserver = new ResizeObserver(applyRendererSize);
    resizeObserver.observe(canvas.parentElement ?? canvas);

    // ── Dev tuning panel (off by default; opened with ?tune) ──
    // Lets us dial the centred ship's palette + the bloom by eye, then bake the values into
    // deckServices.ts. Dynamically imported so lil-gui never enters the normal bundle.
    let destroyGui: (() => void) | undefined;
    if (new URLSearchParams(window.location.search).has('tune')) {
      import('lil-gui')
        .then(({ default: GUI }) => {
          const gui = new GUI({ title: 'Fleet tuning · active ship' });
          const bloomFolder = gui.addFolder('Bloom');
          bloomFolder.add(bloomPass, 'strength', 0, 3, 0.01);
          bloomFolder.add(bloomPass, 'radius', 0, 2, 0.01);
          bloomFolder.add(bloomPass, 'threshold', 0, 1, 0.01);

          // Write a value across every hull material of the currently-centred ship.
          const eachActiveUniform = (mutate: (uniforms: HullShaderUniforms) => void) => {
            activeShip()?.materials.forEach((material) => {
              const uniforms = material.userData.hullUniforms as HullShaderUniforms | undefined;
              if (uniforms) mutate(uniforms);
            });
          };
          const palette = {
            shadow: '#000000', hull: '#000000', highlight: '#000000', accent: '#000000', rim: '#000000',
            gradeMid: 0.5, emitThreshold: 0.8, emitStrength: 2.4,
            metalness: 0.35, roughness: 0.55, clearcoat: 0.15, envMapIntensity: 0.7,
          };
          const colorFolder = gui.addFolder('Palette');
          colorFolder.addColor(palette, 'shadow').onChange((value: string) => eachActiveUniform((u) => u.uHullShadow.value.set(value)));
          colorFolder.addColor(palette, 'hull').onChange((value: string) => eachActiveUniform((u) => u.uHullMid.value.set(value)));
          colorFolder.addColor(palette, 'highlight').onChange((value: string) => eachActiveUniform((u) => u.uHullHighlight.value.set(value)));
          colorFolder.addColor(palette, 'accent').onChange((value: string) => eachActiveUniform((u) => u.uAccent.value.set(value)));
          colorFolder.addColor(palette, 'rim').onChange((value: string) => eachActiveUniform((u) => u.uRim.value.set(value)));
          colorFolder.add(palette, 'gradeMid', 0, 1, 0.01).onChange((value: number) => eachActiveUniform((u) => { u.uGradeMid.value = value; }));
          colorFolder.add(palette, 'emitThreshold', 0, 1, 0.01).onChange((value: number) => eachActiveUniform((u) => { u.uEmitThreshold.value = value; }));
          colorFolder.add(palette, 'emitStrength', 0, 6, 0.05).onChange((value: number) => eachActiveUniform((u) => { u.uEmitStrength.value = value; }));
          colorFolder.add(palette, 'metalness', 0, 1, 0.01).onChange((value: number) => activeShip()?.materials.forEach((material) => { (material as THREE.MeshStandardMaterial).metalness = value; }));
          colorFolder.add(palette, 'roughness', 0, 1, 0.01).onChange((value: number) => activeShip()?.materials.forEach((material) => { (material as THREE.MeshStandardMaterial).roughness = value; }));
          colorFolder.add(palette, 'clearcoat', 0, 1, 0.01).onChange((value: number) => activeShip()?.materials.forEach((material) => { if (material instanceof THREE.MeshPhysicalMaterial) material.clearcoat = value; }));
          colorFolder.add(palette, 'envMapIntensity', 0, 2, 0.01).onChange((value: number) => activeShip()?.materials.forEach((material) => { (material as THREE.MeshStandardMaterial).envMapIntensity = value; }));
          destroyGui = () => gui.destroy();
        })
        .catch(() => {});
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      destroyGui?.();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener(DECK_REVEAL_EVENT, replayEntrance);
      window.removeEventListener(DECK_REVEAL_EVENT, showDeck);
      window.removeEventListener(DECK_HIDE_EVENT, hideDeck);
      window.removeEventListener(ASSETS_WARMUP_EVENT, prewarmPipeline);
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
      padGroup?.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose();
          const meshMaterials = Array.isArray(child.material) ? child.material : [child.material];
          meshMaterials.forEach((material) => material.dispose());
        }
      });
      dracoLoader.dispose();
      shadow.geometry.dispose();
      shadowMaterial.dispose();
      shadowTexture.dispose();
      starfield.geometry.dispose();
      starfieldMaterial.dispose();
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
