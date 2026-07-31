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
import { getWorksTuning } from '../worksTuning';
import { WORKS_PROJECTS } from '../worksProjects';
import { MARK_CHANGE_SECONDS } from '../worksTransition';
import { prepareMarks } from '../prepareMarks';
import { accretionTransitionFactory } from '../transitions/accretionTransition';
import type { MarkTransitionStrategy } from '../transitions/markTransition';
import { createSpacePresentMaterial } from '@/lib/spacePresentMaterial';
import { CHAMBER_PROGRESS_EVENT, readChamberProgress } from '@/lib/chamberEvents';
// The chamber belongs to its own section, but it is drawn by THIS renderer — a GPU texture cannot
// cross a WebGL context, and the space it displays is rendered here. So the works field hosts it.
import { createChamberScene, type ChamberScene } from '@/components/sections/Chamber/chamberScene';
import { hideHologram } from '@/lib/hologramPose';
import { publishSunParallaxPose, clearSunParallaxPose } from '@/lib/sunParallaxPose';
import { reportAssetProgress, reportWarmupDone, ASSETS_WARMUP_EVENT } from '@/lib/assetLoadProgress';
import { getPixelRatio, sampleFrame } from '@/lib/adaptivePixelRatio';

// ── Textures ────────────────────────────────────────────────────────────
// The DEBRIS texture: dark basalt shot through with glowing lava veins, worn as plain rock by the
// ambient shards. It used to clothe the section's body too, as both albedo and emissive map — the
// mark loads its own pair instead (cold black stone, opening onto geode druse), because that look is
// a pairing chosen together rather than one image doing two jobs. See accretionTransition.ts.
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

// ── The reveal pan: the camera turns away from the star ──
//
// The star cannot be in the picture at the moment the picture becomes a screen — a full-brightness sun
// pinned mid-frame while the display shrinks reads as a sticker stuck on the room. It used to simply be
// faded out, which worked and was a cheat. This turns the camera away from it instead, which is what a
// remote camera would actually do, and the sun leaves the frame because the sun is now placed against
// the shot rather than against the viewport (`publishSunParallax`). Nothing else has to know.
//
// TILT DOWN, so the content rises and the star exits the top. The angle needed is remarkably stable
// across viewport heights — a taller frame pushes the top edge further away, but also makes the sun's
// fixed 200px rise a smaller angular offset, and the two very nearly cancel:
//   700px tall → 20.0°     1000px → 20.8°     1400px → 21.2°   (to clear the glow entirely)
// So one authored angle works everywhere. Not bound by DRAG_PITCH_CLAMP — that clamps what the visitor
// may do, and this is the reveal's own channel.
//
// ⚠ The mark rises with it. They sit ~200px apart on screen, so any tilt big enough to lose one
// recomposes the other; at the full angle the mark leaves frame too. That is deliberate — the reveal's
// subject stops being the mark the moment the pull-back starts, and the display is shrinking over the
// same window, which compresses all of this. If it ever reads wrong, the fix is to pan less and let the
// sun's fade finish the job (see docs/works-camera-feed-plan.md §2.3), not to add a second mechanism.
const REVEAL_PAN_DEGREES = 21;
// ⚠ This window is NOT a free choice, and the obvious wider value is wrong. The sun is a DOM billboard
// BEHIND this canvas, and the room seals the canvas opaque over `OPAQUE_WINDOW` ([0, 0.12] in
// chamberScene) — so past ~0.12 the star cannot be seen at all, whatever the camera is doing. A pan
// spread over the pull-back's whole half would therefore be invisible for three quarters of its travel
// and would only be moving the mark. Keep this in step with OPAQUE_WINDOW; if the room's seal is ever
// retimed, this follows it.
const REVEAL_PAN_WINDOW: readonly [number, number] = [0.0, 0.12];

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
// ⚠ Keep in step with `markLabRig.ts`. Its numbers exist to match this scene so a judgement made in the
// transition lab transfers to the section; they were changed with this.
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
    // ── Where the camera would be looking if the visitor weren't dragging ──
    // Captured by `updateCamera` before it applies the drag orbit, and used to place the sun (see
    // `publishSunParallax`). `restPoseValid` is false whenever something OTHER than the authored path
    // owns the camera — the handoff flight, the `?tune` override — because then there is no "rest" to
    // deviate from and the sun must simply stay where the pin put it.
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
    const chamberState = { target: 0, current: 0, engaged: false };

    /**
     * How far the reveal has turned the camera off the star, in radians.
     *
     * Positive tilts the camera DOWN (content rises), which is the direction that carries the sun out
     * of the top of the frame — see REVEAL_PAN_DEGREES. Smoothstepped so the turn eases in and out of
     * its window instead of starting and stopping abruptly against the pull-back.
     */
    const revealPanRadians = () => {
      if (!chamberState.engaged) return 0;
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
        // A borrowed shot has no authored pose to deviate from, so the sun holds still under it.
        restPoseValid = false;
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

      // FOV is authored per key, so a stop can be a tight portrait or a wide establishing shot. The
      // warp kick in the render loop rides on top of whatever this resolves to.
      const fov = splineAt(keyFov, pathU);
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
    };

    /**
     * Build the mark — the section's one body.
     *
     * Async, and it is the only asynchronous thing in the build: the outlines are fetched, the
     * typeface is parsed, and the strategy loads its own two surfaces. `buildField` therefore awaits
     * it before reporting the section ready, or the intro's counter would reach 100% while the body
     * was still being cut.
     *
     * ── The tuning is deliberately EMPTY ──
     * `accretionTransitionFactory.create` resolves `{ ...tuningDefaults(ACCRETION_CONTROLS), ...tuning }`,
     * so passing nothing inherits every value authored in the lab exactly. That is the point: the lab
     * at /letters/transition/accretion IS this section's tuning surface, and copying its ~60 numbers
     * into a second file here would fork the look the moment either side was touched. Override a key
     * here only when the SECTION genuinely needs to differ from the lab.
     */
    const buildMark = async () => {
      const marks = await prepareMarks();
      if (disposed || marks.length === 0) return;
      reportAssetProgress('works', WORKS_OUTLINES_DONE);

      markIndexOfProject = WORKS_PROJECTS.map((project) => {
        const found = marks.findIndex((mark) => mark.id === project.markId);
        return found >= 0 ? found : 0;
      });

      const strategy = await accretionTransitionFactory.create(
        marks,
        {
          targetSize: tuning.markTargetSize,
          depth: tuning.markDepth,
          // The strategy loads the pair of surfaces its look depends on (cold stone + glowing druse),
          // chosen together. Handing it one here would be fetched and ignored — see the note on
          // `surfaceTexture` in markTransition.ts.
          surfaceTexture: null,
          performanceTier: lowPower ? 'low' : 'high',
        },
        {},
      );
      if (disposed) {
        strategy.dispose();
        return;
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
      scene.add(group);

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

    /**
     * Tear the mark down and cut it again.
     *
     * Only the `?tune` panel calls this, and only for the two knobs that are baked into geometry —
     * size and slab depth. Everything else about the mark's look is inherited from the lab and never
     * changes at runtime, so there is nothing else that could need a rebuild.
     */
    const rebuildMark = async () => {
      markTween?.kill();
      markTween = null;
      markRigs.forEach((rig) => {
        scene.remove(rig.group);
        rig.strategy.dispose();
      });
      markRigs.length = 0;
      await buildMark();
    };

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
      // Fully built → mark the field ready for the intro's loader gate. The shader warm-up itself is
      // deferred to ASSETS_WARMUP_EVENT (fired during the intro's static pre-reveal hold) so the
      // compile stall never lands mid loading-animation.
      reportAssetProgress('works', 1);
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
    // All this does is move `markState.progress` from 0 to 1. Every curve — when a stone lets go, how
    // it travels, when the geode grows back — lives in the shader as a function of that one number,
    // which is why the ease here is `none`: easing the driver as well would double-apply it.
    const stageMark = (index: number) => {
      const target = markIndexOfProject[index] ?? 0;
      if (target === markState.to) return;

      // ── Interrupting mid-change ──
      // Whichever mark is currently dominant becomes the new starting point. There is a small visible
      // jump when this fires at exactly the halfway crossover, and it is bounded and deliberate: the
      // alternative is a three-way blend, which the strategy has no concept of because `setTransition`
      // takes exactly two marks. In practice the pin locks input for longer than a change takes
      // (STAGE_STEP_HOLD_MS), so only a programmatic jump — a works arrow, a nav link — can reach it.
      markTween?.kill();
      markState.from = markState.progress >= 0.5 ? markState.to : markState.from;
      markState.to = target;
      markState.progress = 0;

      markTween = gsap.to(markState, {
        progress: 1,
        duration: MARK_CHANGE_SECONDS,
        ease: 'none',
        onComplete: () => {
          // Settled: `from === to` is the strategy's "sit still on this mark", so the resting frame is
          // the same code path as every other frame rather than a special case.
          markState.from = target;
          markState.progress = 0;
          markTween = null;
        },
      });
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

    // ── The chamber (built lazily; see ensureChamber) ──
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
      markRigs.forEach((rig) => {
        rig.strategy.setTransition(markState.from, markState.to, markState.progress);
        rig.strategy.update(reduceMotion ? 0 : elapsed);
        if (reduceMotion) return;
        rig.group.position.y =
          rig.basePosition.y + Math.sin(elapsed * FLOAT_SPEED) * FLOAT_AMPLITUDE;
      });

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
      if (arrival < 0.999) {
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
        chamberState.current +=
          (chamberState.target - chamberState.current) * (reduceMotion ? 1 : CHAMBER_SMOOTHING);
        if (Math.abs(chamberState.target - chamberState.current) < 0.001) {
          chamberState.current = chamberState.target;
        }
      }

      // ── Camera: fly the shared path during the handoff, else the normal focus-follow ──
      // Cleared here rather than in each branch that fails to set it: only the authored-path branch of
      // `updateCamera` has a rest pose to offer, and the flight and the `?tune` override both bypass it
      // entirely. Resetting once, up front, means a new way of driving the camera cannot accidentally
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

      // Deliberately AFTER the warp kick: the projection below uses `camera.fov`, and reading it before
      // this line would place the sun with one lens while the frame was drawn with another.
      publishSunParallax();

      // Skip the bloom pipeline whenever the field isn't on screen (and when the tab is
      // backgrounded). The loop above still ran, so state is current and the first visible frame is
      // already right.
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
                rebuildMark: () => { void rebuildMark(); },
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
