import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import gsap from 'gsap';
import { prefersReducedMotion } from '@/lib/prefersReducedMotion';
import { HANDOFF_PROGRESS_EVENT, readHandoffProgress } from '@/lib/handoffEvents';
import { computeFlightPose, createFlightPose, METEOR_SHARED_POSITION } from '@/lib/handoffFlightPath';
import { createStoneMaterial } from '../meteorMaterial';
import { createMeteorGeometry, createMeteorMaterial } from '../meteorBody';
import { getWorksTuning } from '../worksTuning';
import { WORKS_PROJECTS, type ProjectRock } from '../worksProjects';
import {
  SPIN_RAMP_SECONDS,
  SPIN_PEAK_HOLD_SECONDS,
  SPIN_DECAY_SECONDS,
  SPIN_PEAK_DEGREES_PER_SECOND,
  ENVIRONMENT_COUNTER_SPIN_DEGREES_PER_SECOND,
  MORPH_SECONDS,
  MORPH_SWELL_UNITS,
  MORPH_EMISSIVE_FLARE,
} from '../worksTransition';
import {
  enableMeteorMorph,
  attachMorphTarget,
  bakeMorphTarget,
  type MeteorMorphUniforms,
} from '../meteorMorph';
import { createSpacePresentMaterial } from '@/lib/spacePresentMaterial';
import { CHAMBER_PROGRESS_EVENT, readChamberProgress } from '@/lib/chamberEvents';
// The chamber belongs to its own section, but it is drawn by THIS renderer — a GPU texture cannot
// cross a WebGL context, and the space it displays is rendered here. So the works field hosts it.
import { createChamberScene, type ChamberScene } from '@/components/sections/Chamber/chamberScene';
import { hideHologram } from '@/lib/hologramPose';
import { reportAssetProgress, reportWarmupDone, ASSETS_WARMUP_EVENT } from '@/lib/assetLoadProgress';
import { getPixelRatio, sampleFrame } from '@/lib/adaptivePixelRatio';

// ── Textures ────────────────────────────────────────────────────────────
// ONE texture for the whole field: dark basalt shot through with glowing lava veins. The meteor wears
// it as both albedo AND emissive map, which is what replaced the fire shader (see meteorBody.ts); the
// debris wears it as plain rock. There is no normal map any more — the carving is real geometry.
const TEXTURE_SURFACE = '/textures/meteor/basalt-magma.png';

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

// ── The one meteor ───────────────────────────────────────────────────────
// There used to be four rocks and the camera flew between them. Now there is ONE, and the camera moves
// around it — so a project is a camera POSE rather than a place (see worksTuning.ts). The rock itself is
// procedural, carved the same way as the debris that surrounds it, and it has no fire shell: its lava
// veins come out of the texture's emissive channel and glow through the bloom pass.
const FLOAT_AMPLITUDE = 0.12; // gentle vertical bob
const FLOAT_SPEED     = 0.9;

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
const METEOR_ARRIVE_PROGRESS_START = 0.8;  // handoff progress where the rock begins its approach
const METEOR_ARRIVE_OFFSET = new THREE.Vector3(0, 0.5, -42); // how far behind its spot it starts
const METEOR_APPEAR_FRACTION = 0.12; // gentle fade-up from the far dark as it emerges
const METEOR_VISIBLE_EPSILON = 0.001; // below this the rock is hidden (during the flight)

// ── Shards — irregular ambient debris (NOT projects) ─────────────────────
const SHARD_COUNT       = 260;
const SHARD_COUNT_LOW   = 90;
const SHARD_FIELD       = new THREE.Vector3(13, 6.5, 14); // half-extents the debris fills (z biased back)
const SHARD_Z_CENTER    = -16; // pushed BEHIND the meteor cluster (meteors sit z 0…-13.5) so debris never occludes a project
const SHARD_MIN_SCALE   = 0.05;
const SHARD_MAX_SCALE   = 0.28; // capped so a chunk never reads as a giant boulder
const SHARD_DRIFT_SPEED = 0.012; // rad/s slow yaw drift on the whole debris field
const SHARD_TINT        = 0x1c2530; // darker than the meteors so the projects read as the subjects
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

/** The one rock: its rig, the carved body, and the surface that glows in its cracks. */
interface MeteorRig {
  group: THREE.Group;
  basePosition: THREE.Vector3;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
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

    // ── The camera path ──
    // A project is a POSE now, not a place. Every entry in PROJECT_VIEW_KEYS is a camera pose; the ones
    // tagged with a `stop` are where a project parks, and the untagged ones are pass-through bends the
    // camera splines on its way. One Catmull-Rom over the whole list, parameterised by `pathU` in
    // [0, keys.length - 1], means a journey and its arrival are the same curve — so the camera never
    // brakes to a halt at an intermediate key the way a chain of per-leg tweens would.
    const tuning = getWorksTuning();
    // Held by reference: the `?tune` panel splices this array, then calls rebuildPath().
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
    // when the keys actually change, which outside the tuner is never.
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
     * tuner whenever it edits a key — which is the only thing that can change them.
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

    // Dev only (?tune): while set, this flies the camera instead of the authored path. Same contract as
    // the chamber's — everything else still updates, only the shot is borrowed.
    let cameraOverride:
      | ((deltaSeconds: number, camera: THREE.PerspectiveCamera) => void)
      | null = null;
    let lastOverrideFrame = performance.now();

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
      if (cameraOverride) {
        const now = performance.now();
        const overrideDelta = Math.min((now - lastOverrideFrame) / 1000, 0.1);
        lastOverrideFrame = now;
        cameraOverride(overrideDelta, camera);
        camera.updateProjectionMatrix();
        return;
      }
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
      pathOffset.copy(pathPosition).sub(pathTarget).multiplyScalar(distanceScale);
      pathOffset.applyAxisAngle(ORBIT_UP, viewYaw);
      pathOffset.applyAxisAngle(ORBIT_RIGHT, viewPitch);
      camera.position.copy(pathTarget).add(pathOffset);
      camera.lookAt(pathTarget);

      // FOV is authored per key, so a stop can be a tight portrait or a wide establishing shot. The
      // warp kick in the render loop rides on top of whatever this resolves to.
      const fov = splineAt(keyFov, pathU);
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    };

    // ── Load textures, then build the meteors + shards ──
    const meteorRigs: MeteorRig[] = [];
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

    // The rock gets its OWN view of that image. `repeat` is a property of the texture, not of the
    // material, and the debris shards are drawn with `surfaceMap` too — so setting the meteor's grain
    // on the shared map would rescale every shard in the field along with it. A clone shares the same
    // uploaded GPU image (no extra VRAM, no second decode) while owning its own repeat.
    const meteorMap = surfaceMap.clone();
    meteorMap.needsUpdate = true;
    disposableTextures.push(meteorMap);

    // ── The rock, per project ──
    // Geometry-baked values (seed, size) need a re-carve; material values (colour, grain) are pushed
    // every frame like the rest of the tuning. A project without a profile falls back to the global
    // tuning, so the tuner still drives the rock when nothing overrides it.
    const fallbackRock = (): ProjectRock => ({
      seed: tuning.meteorSeed,
      sizeScale: 1,
      color: tuning.meteorColor,
      textureRepeat: tuning.meteorTextureRepeat,
    });
    // Which rock is CURRENTLY carved — deliberately lagging the active project. The index changes the
    // instant you scroll, but the body must not: the colour and grain are pushed every frame, so
    // reading the live index here would repaint the rock before the spin had a chance to hide it. This
    // only advances at the peak of the wind-up, in step with the re-carve (see scheduleRockSwap).
    let renderedRockIndex = activeIndexRef.current;
    const rockAt = (index: number): ProjectRock =>
      WORKS_PROJECTS[index]?.rock ?? fallbackRock();
    const activeRock = (): ProjectRock => rockAt(renderedRockIndex);

    // ── Morph state ──
    // The shape lerps on the GPU (see meteorMorph.ts); the material properties that AREN'T geometry —
    // the tint and the texture grain — have to be blended here in step with it, or the rock would
    // change colour instantly while its silhouette was still halfway there.
    let meteorMorphUniforms: MeteorMorphUniforms | null = null;
    let morphTargetIndex = renderedRockIndex;
    let morphTween: gsap.core.Tween | null = null;
    // Hoisted: these are written every frame, and allocating two Colors per frame is exactly the kind
    // of garbage that shows up as jitter once the bloom pass is already competing for the budget.
    const morphColorFrom = new THREE.Color();
    const morphColorTo = new THREE.Color();

    // Survives a rebuild so the re-carve doesn't snap the body's spin back to zero (see buildMeteor).
    let meteorYaw = 0;
    // The counter-rotation the debris + stars have accumulated. Integrated per frame rather than
    // derived from `elapsed`, because the rate is not constant — it swells and fades with the spin
    // envelope, and a value computed from elapsed time would jump the instant the rate changed.
    let environmentCounterYaw = 0;
    // 0 = the idle drift authored in `meteorSpin`, 1 = SPIN_PEAK_DEGREES_PER_SECOND. Tweened by the
    // project-change timeline; the render loop just reads it. Same `{ value }` + gsap.to pattern the
    // travel and arrival already use.
    const spinBoost = { value: 0 };

    loadingManager.onProgress = (_url, loaded, total) => {
      const fraction = loaded / Math.max(total, 1);
      // Cap below 1 until buildField runs — 'works' only counts as ready once the rock and the shard
      // materials actually exist, so the intro never warms or reveals before they're built.
      reportAssetProgress('works', Math.min(0.99, fraction));
      onStatus({ isLoading: true, percent: Math.round(fraction * 100) });
    };
    // If the texture fails, onLoad never fires, so buildField never runs — don't let that trap the
    // intro's loader gate waiting on a source that will never be ready. Report the field "ready" so the
    // reveal proceeds; the section degrades gracefully (it shows its own empty/loader state).
    loadingManager.onError = (url) => {
      console.error(`Works field asset failed to load: ${url}`);
      reportAssetProgress('works', 1);
    };

    // Build the bodies once the textures AND the meteor model are in (the meteors need both).
    // Carve the rock and put it in the scene. Split out from buildField because the tuner re-runs it:
    // the silhouette is baked into geometry, so changing the seed or the stretch means a new body.
    const buildMeteor = () => {
      // Tear down whatever is there first, or retuning the shape leaks a mesh per nudge.
      meteorRigs.forEach((rig) => {
        scene.remove(rig.group);
        rig.geometry.dispose();
        rig.material.dispose();
      });
      meteorRigs.length = 0;

      const rock = activeRock();
      const geometry = createMeteorGeometry({
        radius: tuning.meteorRadius * rock.sizeScale,
        detail: tuning.meteorDetail,
        seed: rock.seed,
        stretchX: tuning.meteorStretchX,
        stretchY: tuning.meteorStretchY,
        stretchZ: tuning.meteorStretchZ,
      });
      const material = createMeteorMaterial(meteorMap, tuning.meteorFlatShading);
      // Transparent so the arrival can fade it up out of the far dark.
      material.transparent = true;
      // Teach it to interpolate between shapes. Done here rather than inside createMeteorMaterial so
      // the material stays a plain MeshStandardMaterial for anything else that wants one.
      meteorMorphUniforms = enableMeteorMorph(material);
      morphTargetIndex = renderedRockIndex;

      const group = new THREE.Group();
      group.position.set(tuning.meteorX, tuning.meteorY, tuning.meteorZ);
      // Carry the spin across a rebuild. Without this a re-carve snaps the body back to 0 rad — which
      // is a hard visible jump at the exact moment the swap is supposed to be invisible, and a jump
      // every time the ?tune panel nudges the shape.
      group.rotation.y = meteorYaw;
      group.add(new THREE.Mesh(geometry, material));
      scene.add(group);

      meteorRigs.push({
        group,
        basePosition: group.position.clone(),
        geometry,
        material,
      });
    };

    const buildField = () => {
      buildMeteor();

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

      // Light the focused meteor immediately (no cross-fade on first build).
      applyFocus(activeIndexRef.current, true);
      onStatus({ isLoading: false, percent: 100 });
      // Fully built → mark the field ready for the intro's loader gate. The shader warm-up itself is
      // deferred to ASSETS_WARMUP_EVENT (fired during the intro's static pre-reveal hold) so the
      // compile stall never lands mid loading-animation.
      reportAssetProgress('works', 1);
    };

    // The rock is procedural, so the texture is the only thing to wait for.
    loadingManager.onLoad = buildField;

    // ── Focus a project ──
    // Nothing ignites and nothing cools any more — there is one rock, and a project is a place to stand
    // and look at it from. So focusing a project is simply travelling to its stop on the path.
    let stagedIndex = activeIndexRef.current;

    // ── The re-carve, hidden inside the spin ──
    // Winding the rock up to a blur, swapping the body at the peak, then letting it settle. The swap
    // itself is a full teardown + rebuild (buildMeteor already does exactly this for the tuner), which
    // is only affordable because it happens once per project change, on the one frame where the body
    // is turning too fast to read.
    let spinTimeline: gsap.core.Timeline | null = null;
    // The duration is passed in rather than derived from `spinBoost` inside, because the two callers
    // read it at different times: the interrupt branch runs immediately (so the live value is right),
    // while the swap branch is queued behind the ramp and will always start from a full spin.
    const windDownSpin = (
      timeline: gsap.core.Timeline,
      durationSeconds: number,
      /** GSAP position: seconds from the timeline's start, or a relative string like `+=0.3`. */
      at?: number | string,
    ) =>
      timeline.to(spinBoost, {
        value: 0,
        duration: durationSeconds,
        // Sheds the bulk of the speed quickly, then a long gentle tail into the idle drift — so it
        // comes to rest instead of stopping.
        ease: 'power3.out',
      }, at);

    /** Finish any morph still in flight right now, so a new one can be armed from a settled shape. */
    const settleMorph = () => {
      const rig = meteorRigs[0];
      morphTween?.kill();
      morphTween = null;
      if (!rig || !meteorMorphUniforms) return;
      if (meteorMorphUniforms.uMorph.value > 0) bakeMorphTarget(rig.geometry);
      meteorMorphUniforms.uMorph.value = 0;
      meteorMorphUniforms.uSwell.value = 0;
      renderedRockIndex = morphTargetIndex;
    };

    /**
     * Start the rock reshaping into `index`. Returns false if the two shapes can't be interpolated —
     * only possible if `meteorDetail` changed between builds, which the tuner can do — so the caller
     * can fall back to the old hard swap rather than draw a torn body.
     */
    const startMorph = (index: number): boolean => {
      const rig = meteorRigs[0];
      if (!rig || !meteorMorphUniforms) return false;

      // A morph already running would have its target overwritten mid-flight, which reads as the rock
      // snapping. Land it first, then reshape from there.
      settleMorph();
      if (index === renderedRockIndex) return true;

      const rock = rockAt(index);
      const targetGeometry = createMeteorGeometry({
        radius: tuning.meteorRadius * rock.sizeScale,
        detail: tuning.meteorDetail,
        seed: rock.seed,
        stretchX: tuning.meteorStretchX,
        stretchY: tuning.meteorStretchY,
        stretchZ: tuning.meteorStretchZ,
      });
      const armed = attachMorphTarget(rig.geometry, targetGeometry);
      // Its buffers have been copied into the live geometry's attributes; the geometry itself was only
      // ever scaffolding.
      targetGeometry.dispose();
      if (!armed) return false;

      morphTargetIndex = index;
      const uniforms = meteorMorphUniforms;
      // The shader shapes the swell's curve (a sine over uMorph); this only sets its height, so it's
      // a one-off, not something to write every frame.
      uniforms.uSwell.value = MORPH_SWELL_UNITS;
      morphTween = gsap.to(uniforms.uMorph, {
        value: 1,
        duration: MORPH_SECONDS,
        // Eases out of the old shape and into the new one, so neither end has a visible start/stop —
        // the linear middle is where the swell does its work.
        ease: 'power1.inOut',
        onComplete: () => {
          renderedRockIndex = index;
          uniforms.uMorph.value = 0;
          uniforms.uSwell.value = 0;
          bakeMorphTarget(rig.geometry);
          morphTween = null;
        },
      });
      return true;
    };

    const scheduleRockSwap = (index: number) => {
      const needsRecarve = index !== renderedRockIndex || index !== morphTargetIndex;
      // Already showing this rock and already at rest — nothing to do.
      if (!needsRecarve && spinBoost.value === 0) return;

      spinTimeline?.kill();
      spinTimeline = gsap.timeline();

      // Stepping forward then straight back lands on the rock that's already carved. There's no shape
      // change to make, but the previous wind-up is still spinning — so just bring it back to rest.
      // Without this branch the killed timeline would leave `spinBoost` parked mid-ramp and the rock
      // would spin fast forever.
      if (!needsRecarve) {
        // Scaled by how much speed is actually left, so winding down a half-spun rock doesn't crawl
        // through a full-length decay.
        windDownSpin(spinTimeline, SPIN_DECAY_SECONDS * spinBoost.value);
        return;
      }

      // From wherever the spin currently is — an interrupted change keeps its momentum instead of
      // restarting the wind-up from the idle drift.
      const rampSeconds = SPIN_RAMP_SECONDS * (1 - spinBoost.value) || SPIN_RAMP_SECONDS;

      // Positioned absolutely rather than chained, because the morph owns its own tween (it has to be
      // able to not exist, if the shapes turn out to be incompatible) and so can't sit in this
      // timeline's sequence.
      spinTimeline.to(spinBoost, {
        value: 1,
        duration: rampSeconds,
        // Barely moves for the first third, then runs away. The slow start is what makes the wind-up
        // feel like something building rather than like a speed being switched on.
        ease: 'power3.in',
      }, 0);

      spinTimeline.call(() => {
        if (startMorph(index)) return;
        // Incompatible shapes — no morph is possible, so fall back to the original hard swap.
        renderedRockIndex = index;
        buildMeteor();
      }, [], rampSeconds);

      windDownSpin(spinTimeline, SPIN_DECAY_SECONDS, rampSeconds + SPIN_PEAK_HOLD_SECONDS);
    };

    const applyFocus = (index: number, instant: boolean) => {
      stagedIndex = index;
      const targetU = stopKeyIndex[index] ?? 0;
      travelToU = targetU;
      if (instant || reduceMotion) {
        pathU = targetU;
        // No spin to hide behind, so the rock just becomes the new one.
        if (renderedRockIndex !== index) {
          renderedRockIndex = index;
          if (meteorRigs.length > 0) buildMeteor();
        }
        updateCamera(true);
        return;
      }
      // Always called, even when the rock is already the right one — a step forward and straight back
      // still has a wind-up in flight that has to be brought to rest. scheduleRockSwap decides.
      scheduleRockSwap(index);
      startTravel(targetU);
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

      // ── The field whirls the other way ──
      // The rock spins +Y, so this goes -Y: during a project change the debris and stars sweep against
      // it, and the two rates add into the apparent speed. Outside a change `spinBoost` is 0 and this
      // contributes nothing, so the resting drift is exactly what it always was.
      if (!reduceMotion) {
        environmentCounterYaw -=
          THREE.MathUtils.degToRad(ENVIRONMENT_COUNTER_SPIN_DEGREES_PER_SECOND) *
          spinBoost.value *
          deltaSeconds;
      }

      starSystem.group.rotation.y = elapsed * STAR_DRIFT + environmentCounterYaw;
      shardMeshes.forEach((mesh, meshIndex) => {
        // Opposite drift on the two fields gives the debris a parallax shimmer.
        mesh.rotation.y =
          elapsed * SHARD_DRIFT_SPEED * (meshIndex === 0 ? 1 : -1) + environmentCounterYaw;
      });

      // The rock turns on its own axis and breathes, whichever stop you're parked at — it is the same
      // object seen from different places, so it never stops being alive.
      // Idle drift most of the time; during a project change the boost lifts it to a blur and back.
      const spinDegreesPerSecond = THREE.MathUtils.lerp(
        tuning.meteorSpin,
        SPIN_PEAK_DEGREES_PER_SECOND,
        spinBoost.value,
      );
      // The shape is mid-morph on the GPU; the tint and grain have to travel the same 0..1 so the rock
      // arrives at its new look and its new silhouette together.
      const morph = meteorMorphUniforms?.uMorph.value ?? 0;
      const fromRock = activeRock();
      const toRock = rockAt(morphTargetIndex);
      morphColorFrom.set(fromRock.color);
      morphColorTo.set(toRock.color);
      morphColorFrom.lerp(morphColorTo, morph);
      // Sine, not the raw morph: the flare peaks with the swell in the molten middle and is back to
      // the authored value at both ends, so a settled rock is exactly as hot as the tuner says.
      const flare = 1 + MORPH_EMISSIVE_FLARE * Math.sin(morph * Math.PI);

      meteorRigs.forEach((rig) => {
        if (reduceMotion) return;
        rig.group.rotation.y += THREE.MathUtils.degToRad(spinDegreesPerSecond) * deltaSeconds;
        meteorYaw = rig.group.rotation.y;
        rig.group.position.y =
          rig.basePosition.y + Math.sin(elapsed * FLOAT_SPEED) * FLOAT_AMPLITUDE;
        rig.material.emissive.set(tuning.meteorEmissiveColor);
        rig.material.emissiveIntensity = tuning.meteorEmissive * flare;
        rig.material.color.copy(morphColorFrom);
        rig.material.roughness = tuning.meteorRoughness;
        rig.material.metalness = tuning.meteorMetalness;
      });
      // The meteor's grain comes from the active project; the shards keep the global tuning value.
      const activeRepeat = THREE.MathUtils.lerp(
        fromRock.textureRepeat,
        toRock.textureRepeat,
        morph,
      );
      if (meteorMap.repeat.x !== activeRepeat) {
        meteorMap.repeat.setScalar(activeRepeat);
      }
      if (surfaceMap.repeat.x !== tuning.meteorTextureRepeat) {
        surfaceMap.repeat.setScalar(tuning.meteorTextureRepeat);
      }

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
      if (arrival < 0.999) {
        // The rock travels in from far behind its spot, and perspective grows it as it nears — NOT a
        // scale inflation, so it never reads as spawning. It fades up out of the far dark as it comes.
        const appear = THREE.MathUtils.smoothstep(arrival, 0, METEOR_APPEAR_FRACTION);
        meteorRigs.forEach((rig) => {
          rig.group.visible = meteorsVisible;
          if (!meteorsVisible) return;
          meteorArriveFrom.copy(rig.basePosition).add(METEOR_ARRIVE_OFFSET);
          rig.group.position.lerpVectors(meteorArriveFrom, rig.basePosition, arrival);
          rig.group.position.y += Math.sin(elapsed * FLOAT_SPEED) * FLOAT_AMPLITUDE * arrival;
          rig.material.opacity = appear;
        });
      } else {
        // Landed → the spin/float block above owns it from here.
        meteorRigs.forEach((rig) => {
          rig.group.visible = meteorsVisible;
          rig.material.opacity = 1;
          rig.basePosition.set(tuning.meteorX, tuning.meteorY, tuning.meteorZ);
          rig.group.position.x = rig.basePosition.x;
          rig.group.position.z = rig.basePosition.z;
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
      // The warp kick rides ON TOP of whatever FOV the current key authored — updateCamera has already
      // set the authored value this frame, so this only ever adds the punch of the hop. During the
      // flight the shared path owns the fov outright and neither applies.
      if (!flightState.engaged && warp > 0.001) {
        camera.fov = splineAt(keyFov, pathU) + warp * FOV_KICK;
        camera.updateProjectionMatrix();
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

    // ── Dev tuning panel (off by default; opened with ?tune) ──
    // Dynamically imported so lil-gui and the whole authoring surface — including its free-fly camera —
    // never enter the normal bundle.
    const tunerCleanups: (() => void)[] = [];
    if (new URLSearchParams(window.location.search).has('tune')) {
      import('../worksTunerPanel')
        .then(({ createWorksTunerPanel }) =>
          // The scene may have been torn down while the chunk was in flight.
          disposed
            ? undefined
            : createWorksTunerPanel({
                camera,
                bloomPass,
                setCameraOverride: (drive) => {
                  cameraOverride = drive;
                  // Reset the clock, or the first frame after taking the camera gets the whole idle gap
                  // as its delta and the fly lurches.
                  lastOverrideFrame = performance.now();
                },
                rebuildMeteor: buildMeteor,
                rebuildPath,
                onDispose: (cleanup) => tunerCleanups.push(cleanup),
              }),
        )
        .catch(() => {});
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      tunerCleanups.forEach((cleanup) => cleanup());
      canvas.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener(HANDOFF_PROGRESS_EVENT, onHandoffProgress);
      window.removeEventListener(CHAMBER_PROGRESS_EVENT, onChamberProgress);
      window.removeEventListener(ASSETS_WARMUP_EVENT, warmUpField);
      chamber?.dispose();

      meteorRigs.forEach((rig) => {
        rig.geometry.dispose();
        rig.material.dispose();
      });
      shardGeometries.forEach((geometry) => geometry.dispose());
      shardMaterials.forEach((material) => material.dispose());
      shardMeshes = [];
      disposableTextures.forEach((texture) => texture.dispose());
      gsap.killTweensOf(travel);
      spinTimeline?.kill();
      morphTween?.kill();
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
