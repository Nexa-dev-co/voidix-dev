import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { HANDOFF_PROGRESS_EVENT, readHandoffProgress } from '@/lib/handoffEvents';
import { computeFlightPose, createFlightPose, METEOR_SHARED_POSITION } from '@/lib/handoffFlightPath';
import { WORKS_PROJECTS } from '../worksProjects';
import { createStoneMaterial, createFireMaterial, type FireMeteorUniforms } from '../meteorMaterial';
import { createSpacePresentMaterial } from '@/lib/spacePresentMaterial';
import { CHAMBER_PROGRESS_EVENT, readChamberProgress } from '@/lib/chamberEvents';
// The chamber belongs to its own section, but it is drawn by THIS renderer — a GPU texture cannot
// cross a WebGL context, and the space it displays is rendered here. So the works field hosts it.
import { createChamberScene, type ChamberScene } from '@/components/sections/Chamber/chamberScene';
import { hideHologram } from '@/lib/hologramPose';
import { reportAssetProgress, reportWarmupDone, ASSETS_WARMUP_EVENT } from '@/lib/assetLoadProgress';
import { getPixelRatio, sampleFrame } from '@/lib/adaptivePixelRatio';

// ── Textures ────────────────────────────────────────────────────────────
const TEXTURE_STONE  = '/textures/meteor/stone.jpg';
const TEXTURE_STONE2 = '/textures/meteor/stone2.webp';
const TEXTURE_NORMAL = '/textures/meteor/normal.jpg';
const TEXTURE_FIRE   = '/textures/meteor/fire_meteor.jpg';

// ── Camera / framing ────────────────────────────────────────────────────
// This resting framing is exactly where the services→works left-flight lands (the shared camera at
// progress 1 resolves to `meteor + CAMERA_OFFSET`), so browsing takes over without a jump. Derived
// from the flight's end pose: sharedCam(1) − METEOR_SHARED_POSITION = (0, 1.0, 7).
const CAMERA_FOV = 38;
// Where the camera sits relative to the focused meteor: back + a touch above, looking at it. As
// the focus travels between meteors the camera flies through the field and neighbours pass by.
const CAMERA_OFFSET = new THREE.Vector3(0, 1.0, 7.0);

// ── Warp travel — the "punch between planets" feeling ────────────────────
// The trip is time-based (not a constant lerp) so it launches, cruises, then arrives: the eased
// progress means the camera accelerates out of one planet and decelerates into the next. That speed
// curve then drives the star-streaks and an FOV kick, so the three read as one warp.
// Paced to read as a real trip between planets rather than a cut: with the scroll now stepping one
// project per gesture, this warp IS the transition the user sees, so it gets room to breathe. The
// hero pin holds its input lock (STAGE_STEP_HOLD_MS) across roughly this long.
const TRAVEL_DURATION = 1.6;        // seconds per hop, regardless of distance
const TRAVEL_EASE = 'power3.inOut'; // accelerate → cruise → decelerate (the launch/arrive arc)
// Camera speed (world units/second) that maps to a full-intensity warp. Scaled DOWN in step with the
// longer TRAVEL_DURATION: a slower hop means a lower peak camera speed, so leaving this at its old
// value would leave the streaks and the FOV kick barely registering.
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

// ── The project meteors — a loose constellation across depth ─────────────
// Each project is one meteor; the focused one burns. Positions are hand-placed so neighbours stay
// on screen (you can see the rest of the field around the active one).
interface MeteorLayout {
  position: [number, number, number];
  radius: number;
}
const METEOR_LAYOUT: MeteorLayout[] = [
  { position: [0, 0, 0],          radius: 1.3 },
  { position: [7.6, 1.9, -4.5],   radius: 1.05 },
  { position: [-6.8, -1.5, -8],   radius: 1.45 },
  { position: [4.6, 2.7, -13.5],  radius: 1.15 },
];
const METEOR_MODEL_PATH = '/models/meteor.glb'; // the real meteor body every project is carved from
const DRACO_DECODER_PATH = '/draco/';
const METEOR_DETAIL = 1;        // icosahedron subdivisions — the fallback shape if the model won't load
const FIRE_SHELL_SCALE = 1.03;  // the fire mesh sits just outside the stone so it fully envelops it
const IGNITE_DURATION = 1.1;    // cross-fade a meteor to fire (paced with the slower TRAVEL_DURATION)
const COOL_DURATION   = 0.9;    // …and back to stone
const METEOR_SPIN_SPEED = 0.25; // rad/s slow turntable on the focused meteor
const FLOAT_AMPLITUDE   = 0.12; // gentle vertical bob on the focused meteor
const FLOAT_SPEED       = 0.9;

// ── The services → works flight (the CAMERA flies in; the meteors + debris stay put) ──
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

// ── Meteor arrival — real, FAR rocks that ALL fly in the same way as the flight completes ──
// The field's meteors stay hidden through most of the flight (only debris + streaking stars show).
// The arrival is driven straight off the handoff progress, so it can never be skipped or desync from
// the scroll. Every meteor travels in from far behind ITS OWN spot over the window below (a long, slow
// approach), and is fully landed by progress 1 — the focused one gaining its fire as it lands. It is
// fully REVERSIBLE: scroll back and the rocks recede to the far dark exactly as the ship flies back
// onto the pad, so the whole handoff cleanly undoes. Perspective grows each rock as it nears (NOT
// scaled up from a speck, so it never reads as spawning). They stay far/small until the ship has
// cleared frame-centre (see EXIT_PROGRESS_* in useServicesDeck), so ship and rocks never clash.
const METEOR_ARRIVE_PROGRESS_START = 0.8;  // handoff progress where the rocks begin their approach (earlier = slower/longer)
const METEOR_ARRIVE_OFFSET = new THREE.Vector3(0, 0.5, -42); // how far behind its own spot each rock starts (field-local)
const METEOR_APPEAR_FRACTION = 0.12; // gentle fade-up from the far dark as they emerge
const METEOR_IGNITE_START = 0.5;     // fraction of the approach after which it gains its fire
const METEOR_VISIBLE_EPSILON = 0.001; // below this the meteors are hidden (during the flight)

// ── Fire "breathing" (idle → flare rhythm, like the sun) ─────────────────
const FLARE_BASE      = 0.6;
const FLARE_AMPLITUDE = 0.35;
const FLARE_SPEED     = 1.4;

// ── Shards — irregular ambient debris (NOT projects) ─────────────────────
const SHARD_COUNT       = 260;
const SHARD_COUNT_LOW   = 90;
const SHARD_FIELD       = new THREE.Vector3(13, 6.5, 14); // half-extents the debris fills (z biased back)
const SHARD_Z_CENTER    = -16; // pushed BEHIND the meteor cluster (meteors sit z 0…-13.5) so debris never occludes a project
const SHARD_MIN_SCALE   = 0.05;
const SHARD_MAX_SCALE   = 0.28; // capped so a chunk never reads as a giant boulder
const SHARD_DRIFT_SPEED = 0.012; // rad/s slow yaw drift on the whole debris field
const SHARD_TINT        = 0x1c2530; // darker than the meteors so the projects read as the subjects
// Debris keeps clear of a sphere around each meteor's camera rest spot (base + CAMERA_OFFSET), so a
// chunk never spawns right on top of the lens and blows up huge in perspective when you focus a project.
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
const KEY_LIGHT_COLOR      = 0xdfe7ff; // cool key so the stone meteors read blue-grey, not warm
const KEY_LIGHT_INTENSITY  = 2.1;
const FILL_LIGHT_COLOR     = 0x2a3550;
const FILL_LIGHT_INTENSITY = 0.6;
const AMBIENT_INTENSITY    = 0.18;
const TONE_MAPPING_EXPOSURE = 1.15;

// ── Bloom (only the fire blooms) ─────────────────────────────────────────
const BLOOM_STRENGTH     = 0.9;
const BLOOM_STRENGTH_LOW = 0.55;
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

interface MeteorRig {
  group: THREE.Group;
  basePosition: THREE.Vector3;
  geometry: THREE.BufferGeometry;
  stoneMaterial: THREE.MeshStandardMaterial;
  fireMaterial: THREE.ShaderMaterial;
  fireUniforms: FireMeteorUniforms;
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

// Flatten a loaded glb into one buffer geometry the meteors can wear: bake every mesh's world
// transform, keep only position/normal/uv (so primitives with different attribute sets still merge),
// then centre it and normalise to a unit radius. Each meteor later clones this and scales it to its
// own layout radius — so the model's absolute size and pivot don't matter. The fire shader only uses
// normalize(localPosition), which is scale-invariant, so the flame maps onto the model unchanged.
function meteorGeometryFromModel(root: THREE.Object3D): THREE.BufferGeometry {
  root.updateWorldMatrix(true, true);

  const parts: THREE.BufferGeometry[] = [];
  root.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    let baked = child.geometry.clone();
    baked.applyMatrix4(child.matrixWorld);
    if (baked.index) baked = baked.toNonIndexed();
    if (!baked.getAttribute('normal')) baked.computeVertexNormals();

    const trimmed = new THREE.BufferGeometry();
    trimmed.setAttribute('position', baked.getAttribute('position'));
    trimmed.setAttribute('normal', baked.getAttribute('normal'));
    const uv = baked.getAttribute('uv');
    // Some meteor models have no unwrap; give a zeroed uv so merge + the fire's uMap sample don't NaN.
    trimmed.setAttribute(
      'uv',
      uv ?? new THREE.BufferAttribute(new Float32Array(baked.getAttribute('position').count * 2), 2),
    );
    parts.push(trimmed);
    baked.dispose();
  });

  // No mesh in the file → fall back to the faceted crystal so the section still builds.
  if (!parts.length) return new THREE.IcosahedronGeometry(1, METEOR_DETAIL);
  const merged = (parts.length === 1 ? parts[0] : mergeGeometries(parts, false)) ?? parts[0];

  merged.computeBoundingBox();
  const center = merged.boundingBox!.getCenter(new THREE.Vector3());
  merged.translate(-center.x, -center.y, -center.z);
  merged.computeBoundingSphere();
  const radius = merged.boundingSphere?.radius || 1;
  merged.scale(1 / radius, 1 / radius, 1 / radius);
  merged.computeVertexNormals();
  return merged;
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
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
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

    // Stage 2 — the screen. Tone mapping and AA happen here, once, on whatever is being shown.
    const screenTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      samples: lowPower ? 0 : BLOOM_MSAA_SAMPLES,
    });
    const screenComposer = new EffectComposer(renderer, screenTarget);
    // The scene this draws is swapped for the chamber once the reveal engages; today it is always the
    // full-bleed quad.
    const screenRenderPass = new RenderPass(presentScene, presentCamera);
    screenComposer.addPass(screenRenderPass);
    screenComposer.addPass(new OutputPass());
    // Smooth the meteor / shard edges the bloom pipeline leaves rough — a composer ignores the
    // renderer's own `antialias` flag, so this is the only geometry AA on the final image. Runs last,
    // on the LDR result after tone mapping. Sized by the composer, so it follows the adaptive resolution.
    const smaaPass = new SMAAPass();
    screenComposer.addPass(smaaPass);

    // ── Starfield (dots + warp streaks) ──
    const starSystem = createStarSystem();
    scene.add(starSystem.group);

    // ── Camera rig state ──
    // The camera looks at `focusCurrent`. On a focus change it *warps* from where it is to the new
    // meteor along a time-based eased hop (launch → cruise → arrive); drag adds a clamped yaw/pitch
    // orbit offset that springs back on release.
    const focusCurrent = new THREE.Vector3().fromArray(METEOR_LAYOUT[activeIndexRef.current].position);
    const focusTarget  = focusCurrent.clone();
    let viewYaw = 0, viewPitch = 0, viewYawTarget = 0, viewPitchTarget = 0;
    // On portrait/narrow aspect the camera pulls back so the meteor stays framed instead of clipping.
    let distanceScale = 1;

    // The warp hop: focusCurrent = lerp(travelFrom, travelTo, easedProgress). GSAP eases the progress
    // so the speed curve (and thus the streaks + FOV kick) is the launch/arrive arc, not a flat drift.
    const travelFrom = focusCurrent.clone();
    const travelTo   = focusCurrent.clone();
    const travelProgress = { value: 1 }; // 1 = arrived / idle
    let travelActive = false;
    const startTravel = () => {
      travelFrom.copy(focusCurrent);
      travelTo.copy(focusTarget);
      travelProgress.value = 0;
      travelActive = true;
      gsap.killTweensOf(travelProgress);
      gsap.to(travelProgress, {
        value: 1,
        duration: TRAVEL_DURATION,
        ease: TRAVEL_EASE,
        onComplete: () => { travelActive = false; },
      });
    };

    const updateCamera = (instant: boolean) => {
      if (instant || reduceMotion) {
        focusCurrent.copy(focusTarget);
        travelActive = false;
      } else if (travelActive) {
        focusCurrent.lerpVectors(travelFrom, travelTo, travelProgress.value);
      }
      viewYaw   += (viewYawTarget   - viewYaw)   * VIEW_RETURN_EASE;
      viewPitch += (viewPitchTarget - viewPitch) * VIEW_RETURN_EASE;

      const offset = CAMERA_OFFSET.clone();
      offset.z *= distanceScale;
      offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), viewYaw);
      offset.applyAxisAngle(new THREE.Vector3(1, 0, 0), viewPitch);
      camera.position.copy(focusCurrent).add(offset);
      camera.lookAt(focusCurrent);
    };

    // ── Load textures, then build the meteors + shards ──
    const meteorRigs: MeteorRig[] = [];
    let shardMeshes: THREE.InstancedMesh[] = [];
    const shardGeometries: THREE.BufferGeometry[] = [];
    const shardMaterials: THREE.MeshStandardMaterial[] = [];
    const disposableTextures: THREE.Texture[] = [];
    // The normalised meteor model, shared by all four project bodies. Set once the glb arrives; the
    // field only builds after both this and the textures are in (see the coordinator below).
    let meteorBaseGeometry: THREE.BufferGeometry | null = null;

    const loadingManager = new THREE.LoadingManager();
    const textureLoader = new THREE.TextureLoader(loadingManager);

    const loadAlbedo = (path: string) => {
      const texture = textureLoader.load(path);
      texture.colorSpace = THREE.SRGBColorSpace;
      disposableTextures.push(texture);
      return texture;
    };
    const stoneMap  = loadAlbedo(TEXTURE_STONE);
    const stone2Map = loadAlbedo(TEXTURE_STONE2);
    const fireMap   = loadAlbedo(TEXTURE_FIRE);
    const normalMap = textureLoader.load(TEXTURE_NORMAL); // linear data — leave colorSpace as-is
    disposableTextures.push(normalMap);

    loadingManager.onProgress = (_url, loaded, total) => {
      const fraction = loaded / Math.max(total, 1);
      // Cap below 1 until buildField runs — 'works' only counts as ready once its meteor / fire /
      // shard materials actually exist, so the intro never warms or reveals before they're built.
      reportAssetProgress('works', Math.min(0.99, fraction));
      onStatus({ isLoading: true, percent: Math.round(fraction * 100) });
    };
    // If a texture/model fails, onLoad never fires, so buildField never runs — don't let that trap the
    // intro's loader gate waiting on a source that will never be ready. Report the field "ready" so the
    // reveal proceeds; the section degrades gracefully (it shows its own empty/loader state).
    loadingManager.onError = (url) => {
      console.error(`Works field asset failed to load: ${url}`);
      reportAssetProgress('works', 1);
    };

    // Build the bodies once the textures AND the meteor model are in (the meteors need both).
    const buildField = () => {
      if (!meteorBaseGeometry) return;
      // Project meteors — a stone shell with a fire shell nested inside it for the ignite cross-fade.
      METEOR_LAYOUT.forEach((layout, index) => {
        const project = WORKS_PROJECTS[index];
        // Each meteor is the shared model geometry, cloned and grown to its own layout radius.
        const geometry = meteorBaseGeometry!.clone().scale(layout.radius, layout.radius, layout.radius);

        const stoneMaterial = createStoneMaterial(index % 2 === 0 ? stoneMap : stone2Map, normalMap, {
          flatShading: true,
        });
        const stoneMesh = new THREE.Mesh(geometry, stoneMaterial);

        const { material: fireMaterial, uniforms: fireUniforms } = createFireMaterial(fireMap, project.accent);
        const fireMesh = new THREE.Mesh(geometry, fireMaterial);
        fireMesh.scale.setScalar(FIRE_SHELL_SCALE);

        const group = new THREE.Group();
        group.position.fromArray(layout.position);
        // Random resting tilt so the crystals don't all sit the same way up.
        group.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
        group.add(stoneMesh, fireMesh);
        scene.add(group);

        meteorRigs.push({
          group,
          basePosition: new THREE.Vector3().fromArray(layout.position),
          geometry,
          stoneMaterial,
          fireMaterial,
          fireUniforms,
        });
      });

      // Ambient shard debris — two irregular base shapes, each instanced across the field.
      const totalShards = lowPower ? SHARD_COUNT_LOW : SHARD_COUNT;
      const shardMatrix = new THREE.Matrix4();
      const shardQuaternion = new THREE.Quaternion();
      const shardEuler = new THREE.Euler();
      const shardScale = new THREE.Vector3();
      const shardPosition = new THREE.Vector3();

      // Where the camera rests when focused on each meteor (base + offset) — debris keeps clear of a
      // sphere around each of these so nothing spawns right on the lens and blows up huge.
      const cameraAnchors = METEOR_LAYOUT.map((layout) =>
        new THREE.Vector3().fromArray(layout.position).add(CAMERA_OFFSET),
      );
      const isClearOfCameras = (position: THREE.Vector3) =>
        cameraAnchors.every((anchor) => anchor.distanceTo(position) >= SHARD_CAMERA_KEEPOUT);

      for (let baseIndex = 0; baseIndex < 2; baseIndex += 1) {
        const geometry = createShardGeometry(
          baseIndex + 1,
          lowPower ? SHARD_GEOMETRY_DETAIL_LOW : SHARD_GEOMETRY_DETAIL,
        );
        const material = createStoneMaterial(baseIndex === 0 ? stoneMap : stone2Map, normalMap, {
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

      // Light the focused meteor immediately (no cross-fade on first build).
      applyFocus(activeIndexRef.current, true);
      onStatus({ isLoading: false, percent: 100 });
      // Fully built → mark the field ready for the intro's loader gate. The shader warm-up itself is
      // deferred to ASSETS_WARMUP_EVENT (fired during the intro's static pre-reveal hold) so the
      // compile stall never lands mid loading-animation.
      reportAssetProgress('works', 1);
    };

    // The meteor model and the textures load in parallel; build only when BOTH are ready. tryBuild
    // is called from each side so whichever finishes last triggers the build (order-independent).
    let texturesReady = false;
    const tryBuild = () => {
      if (texturesReady && meteorBaseGeometry) buildField();
    };
    loadingManager.onLoad = () => { texturesReady = true; tryBuild(); };

    // Load the meteor body (Draco-compressed). Routed through the same manager so its bytes count
    // toward the loading percentage. On failure we fall back to the faceted crystal so Works still builds.
    const dracoLoader = new DRACOLoader();
    dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
    const gltfLoader = new GLTFLoader(loadingManager);
    gltfLoader.setDRACOLoader(dracoLoader);
    gltfLoader.load(
      METEOR_MODEL_PATH,
      (gltf) => {
        meteorBaseGeometry = meteorGeometryFromModel(gltf.scene);
        tryBuild();
      },
      undefined,
      (error) => {
        console.error(`Failed to load meteor model: ${METEOR_MODEL_PATH}`, error);
        meteorBaseGeometry = new THREE.IcosahedronGeometry(1, METEOR_DETAIL);
        tryBuild();
      },
    );

    // ── Ignite / cool ──
    const igniteMeteor = (rig: MeteorRig, instant: boolean) => {
      gsap.killTweensOf(rig.fireUniforms.uIgnite);
      gsap.killTweensOf(rig.stoneMaterial);
      if (instant || reduceMotion) {
        rig.fireUniforms.uIgnite.value = 1;
        rig.stoneMaterial.opacity = 0;
        return;
      }
      gsap.to(rig.fireUniforms.uIgnite, { value: 1, duration: IGNITE_DURATION, ease: 'power2.out', overwrite: true });
      gsap.to(rig.stoneMaterial, { opacity: 0, duration: IGNITE_DURATION, ease: 'power2.out', overwrite: true });
    };
    const coolMeteor = (rig: MeteorRig, instant: boolean) => {
      gsap.killTweensOf(rig.fireUniforms.uIgnite);
      gsap.killTweensOf(rig.stoneMaterial);
      if (instant || reduceMotion) {
        rig.fireUniforms.uIgnite.value = 0;
        rig.stoneMaterial.opacity = 1;
        return;
      }
      gsap.to(rig.fireUniforms.uIgnite, { value: 0, duration: COOL_DURATION, ease: 'power2.in', overwrite: true });
      gsap.to(rig.stoneMaterial, { opacity: 1, duration: COOL_DURATION, ease: 'power2.in', overwrite: true });
    };

    // Focus a project: warp the camera to its meteor, ignite it, cool the rest.
    let stagedIndex = activeIndexRef.current;
    const applyFocus = (index: number, instant: boolean) => {
      stagedIndex = index;
      focusTarget.fromArray(METEOR_LAYOUT[index].position);
      // Launch the eased warp hop from wherever the camera is now to the new meteor.
      if (!instant && !reduceMotion) startTravel();
      meteorRigs.forEach((rig, rigIndex) => {
        if (rigIndex === index) igniteMeteor(rig, instant);
        else coolMeteor(rig, instant);
      });
      if (instant) updateCamera(true);
    };

    const setFocus = (index: number) => {
      if (index === stagedIndex || !meteorRigs.length) return;
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

    // ── The chamber (built lazily; see ensureChamber) ──
    // The pin scrubs the raw target and the loop eases toward it, exactly as the handoff does. The
    // room is only DRAWN once it has both models — until then the screen pipeline keeps painting the
    // full-bleed quad, which is what it would be showing at progress 0 anyway.
    const chamberState = { target: 0, current: 0, engaged: false };
    let chamber: ChamberScene | null = null;
    let chamberReady = false;
    const ensureChamber = () => {
      if (chamber) return;
      chamber = createChamberScene({
        environment: scene.environment,
        onReady: () => {
          chamberReady = true;
        },
      });
    };
    const onChamberProgress = (event: Event) => {
      chamberState.target = readChamberProgress(event);
      chamberState.engaged = true;
      // A jump straight to the end of the page can land here before Works ever rendered.
      ensureChamber();
    };
    window.addEventListener(CHAMBER_PROGRESS_EVENT, onChamberProgress);

    // Warm the meteor / fire / shard materials + bloom pipeline before the field is shown. Compiled
    // ASYNCHRONOUSLY (background threads, where the GPU supports it) so it doesn't block the main
    // thread — a synchronous compile at the intro's warm-up beat froze ~0.2s right before the reveal.
    // The field isn't shown until the handoff, so there's time; the bloom-warming composer.render()
    // lands after the promise resolves, while the field is still hidden.
    let disposed = false;
    const warmUpField = () => {
      renderer
        .compileAsync(scene, camera)
        .then(() => {
          if (disposed) return;
          // Forces the bloom + present passes to compile too (the only part that can still block, and
          // only on a GPU with no parallel-compile extension — during the intro hold, never at the reveal).
          spaceComposer.render();
          presentUniforms.uSpace.value = spaceTexture();
          screenComposer.render();
          reportWarmupDone('works'); // the intro holds the reveal until this fires
        })
        .catch(() => { if (!disposed) reportWarmupDone('works'); });
    };
    window.addEventListener(ASSETS_WARMUP_EVENT, warmUpField);

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

      starSystem.group.rotation.y = elapsed * STAR_DRIFT;
      shardMeshes.forEach((mesh, meshIndex) => {
        // Opposite drift on the two fields gives the debris a parallax shimmer.
        mesh.rotation.y = elapsed * SHARD_DRIFT_SPEED * (meshIndex === 0 ? 1 : -1);
      });

      const focused = activeIndexRef.current;
      meteorRigs.forEach((rig, rigIndex) => {
        const isFocused = rigIndex === focused && !reduceMotion;
        // Only the burning meteor animates; the rest hold their resting tilt.
        if (isFocused) {
          rig.group.rotation.y += METEOR_SPIN_SPEED * deltaSeconds;
          rig.group.position.y = rig.basePosition.y + Math.sin(elapsed * FLOAT_SPEED) * FLOAT_AMPLITUDE;
          rig.fireUniforms.uTime.value += deltaSeconds;
          rig.fireUniforms.uFlare.value = FLARE_BASE + Math.sin(elapsed * FLARE_SPEED) * FLARE_AMPLITUDE;
        } else if (rig.group.position.y !== rig.basePosition.y) {
          // Settle a just-unfocused meteor back onto its resting height (it may have frozen mid-bob).
          rig.group.position.y = rig.basePosition.y;
        }
      });

      // ── Meteor 01 arrival (sentinel-driven) ──
      // Every meteor stays HIDDEN until the ship has arrived + left the screen — so the flight shows
      // only debris + streaking stars. Once `meteorArrival` lifts off 0, meteor 01 flies in from far
      // and lights as it settles; the others simply appear at their spots. Fully in → the focus/float
      // system owns meteor 01 again (browsing between projects works as before).
      // Reversible progress-driven arrival: tracks the eased handoff progress both ways, so the rocks
      // recede to the far dark on scroll-back exactly as the ship flies back on. At 1 they're landed.
      const arrival = THREE.MathUtils.smoothstep(flightState.current, METEOR_ARRIVE_PROGRESS_START, 1);
      meteorArrival.value = arrival;
      const meteorsVisible = arrival > METEOR_VISIBLE_EPSILON;
      const focusedIndex = activeIndexRef.current;
      if (arrival < 0.999) {
        // EVERY meteor flies in the same way — a real, distant rock travelling in from far behind its
        // own spot; perspective grows it as it nears (NO scale inflation, so it never reads as
        // spawning). It fades up from the far dark, and the focused one gains its fire as it lands.
        const appear = THREE.MathUtils.smoothstep(arrival, 0, METEOR_APPEAR_FRACTION);
        meteorRigs.forEach((rig, rigIndex) => {
          rig.group.visible = meteorsVisible;
          if (!meteorsVisible) return;
          meteorArriveFrom.copy(rig.basePosition).add(METEOR_ARRIVE_OFFSET);
          rig.group.position.lerpVectors(meteorArriveFrom, rig.basePosition, arrival);
          rig.group.position.y += Math.sin(elapsed * FLOAT_SPEED) * FLOAT_AMPLITUDE * arrival;
          rig.group.scale.setScalar(1);
          const ignite = rigIndex === focusedIndex ? THREE.MathUtils.smoothstep(arrival, METEOR_IGNITE_START, 1) : 0;
          rig.fireUniforms.uIgnite.value = ignite;
          rig.stoneMaterial.opacity = appear * (1 - ignite);
        });
      } else {
        // Landed → hand back to the focus/float system (owns position, spin, ignite from here).
        meteorRigs.forEach((rig) => {
          rig.group.visible = meteorsVisible;
          rig.group.scale.setScalar(1);
        });
      }

      // ── Camera: fly the shared path during the handoff, else the normal focus-follow ──
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

      // Drive the star-streaks off the warp (the fly-in naturally streaks the field as we punch in).
      starSystem.streakUniforms.uStreakLength.value = warp * STREAK_MAX_LENGTH;
      starSystem.streakUniforms.uOpacity.value = warp * STREAK_MAX_OPACITY;
      starSystem.streakUniforms.uStreakDir.value.copy(streakDirection);
      // The FOV kick is only for the focus-follow hops; during the flight the shared path owns the fov.
      if (!flightState.engaged) {
        const targetFov = CAMERA_FOV + warp * FOV_KICK;
        if (Math.abs(camera.fov - targetFov) > 0.01) {
          camera.fov = targetFov;
          camera.updateProjectionMatrix();
        }
      }

      // Skip the bloom pipeline whenever the field isn't on screen (and when the tab is
      // backgrounded). The loop above still ran, so state is current and the first visible frame is
      // already right.
      // ── The reveal: back out of the display until the room is around you ──
      // Eased per frame off the scrubbed target, like every other crossing, so it stays cinematic
      // whether the user creeps, flicks, or the snap glides across it. Pure function of progress: it
      // can't be outrun, and it reverses.
      if (chamberState.engaged) {
        chamberState.current +=
          (chamberState.target - chamberState.current) * (reduceMotion ? 1 : CHAMBER_SMOOTHING);
        if (Math.abs(chamberState.target - chamberState.current) < 0.001) {
          chamberState.current = chamberState.target;
        }
      }
      const revealProgress = chamberState.engaged ? chamberState.current : 0;

      // Show the room only once it's actually in. Until then the screen pipeline keeps painting the
      // full-bleed quad — which is exactly what the chamber would be showing at progress 0 anyway, so
      // a slow model load degrades to "the reveal hasn't started yet" rather than to a black frame.
      const revealing =
        !!chamber && chamberReady && revealProgress > CHAMBER_ENGAGE_EPSILON;

      const handoffActive = flightState.current > 0.001 && flightState.current < 0.999;
      const revealScrubbing = revealing && revealProgress < CHAMBER_SCRUB_END;
      const isDrawing = worksShouldRender && !document.hidden;
      if (isDrawing) {
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

    // ── Dev tuning panel (?tune) — the focused fire + the bloom ──
    let destroyGui: (() => void) | undefined;
    if (new URLSearchParams(window.location.search).has('tune')) {
      import('lil-gui')
        .then(({ default: GUI }) => {
          const gui = new GUI({ title: 'Works · fire + bloom' });
          const bloomFolder = gui.addFolder('Bloom');
          bloomFolder.add(bloomPass, 'strength', 0, 3, 0.01);
          bloomFolder.add(bloomPass, 'radius', 0, 2, 0.01);
          bloomFolder.add(bloomPass, 'threshold', 0, 1, 0.01);

          const focusedUniforms = () => meteorRigs[activeIndexRef.current]?.fireUniforms;
          const fire = { noiseScale: 2.6, flowSpeed: 0.5, contrast: 1.3, mid: '#ff7a2a', hot: '#fff1c8', ember: '#3a0a02' };
          const fireFolder = gui.addFolder('Fire (focused)');
          fireFolder.add(fire, 'noiseScale', 0.5, 6, 0.05).onChange((value: number) => { const u = focusedUniforms(); if (u) u.uNoiseScale.value = value; });
          fireFolder.add(fire, 'flowSpeed', 0, 2, 0.01).onChange((value: number) => { const u = focusedUniforms(); if (u) u.uFlowSpeed.value = value; });
          fireFolder.add(fire, 'contrast', 0.5, 3, 0.01).onChange((value: number) => { const u = focusedUniforms(); if (u) u.uContrast.value = value; });
          fireFolder.addColor(fire, 'ember').onChange((value: string) => { const u = focusedUniforms(); if (u) u.uEmber.value.set(value); });
          fireFolder.addColor(fire, 'mid').onChange((value: string) => { const u = focusedUniforms(); if (u) u.uMid.value.set(value); });
          fireFolder.addColor(fire, 'hot').onChange((value: string) => { const u = focusedUniforms(); if (u) u.uHot.value.set(value); });
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
      window.removeEventListener(HANDOFF_PROGRESS_EVENT, onHandoffProgress);
      window.removeEventListener(CHAMBER_PROGRESS_EVENT, onChamberProgress);
      window.removeEventListener(ASSETS_WARMUP_EVENT, warmUpField);
      chamber?.dispose();

      meteorRigs.forEach((rig) => {
        gsap.killTweensOf(rig.fireUniforms.uIgnite);
        gsap.killTweensOf(rig.stoneMaterial);
        rig.geometry.dispose();
        rig.stoneMaterial.dispose();
        rig.fireMaterial.dispose();
      });
      shardGeometries.forEach((geometry) => geometry.dispose());
      shardMaterials.forEach((material) => material.dispose());
      shardMeshes = [];
      meteorBaseGeometry?.dispose();
      dracoLoader.dispose();
      disposableTextures.forEach((texture) => texture.dispose());
      gsap.killTweensOf(travelProgress);
      starSystem.dispose();
      pmremGenerator.dispose();
      scene.environment?.dispose();
      presentGeometry.dispose();
      presentMaterial.dispose();
      // EffectComposer.dispose() doesn't free added passes — release the bloom pyramid explicitly.
      // Each composer owns (and disposes) both of its read/write targets, so the buffers handed to
      // them — and the clones they made — are freed with them.
      bloomPass.dispose();
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
