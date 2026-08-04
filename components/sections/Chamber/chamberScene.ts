import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { getSharedDracoLoader, getSharedKtx2Loader } from '@/lib/modelLoading';
import { createSpacePresentMaterial } from '@/lib/spacePresentMaterial';
import { createGroundGrid } from './groundGrid';
import { createChamberWalls } from './chamberWalls';
import { createChamberPlinth } from './chamberPlinth';
import { applySurfaceLighting } from './chamberSurfaceLighting';
import { hideHologram, publishHologramPose } from '@/lib/hologramPose';
import { SLATE_600, SLATE_800 } from '@/lib/coolPalette';
import {
  CHAMBER_HOLOGRAM_EVENT,
  type ChamberHologramDetail,
} from '@/lib/chamberEvents';
import {
  getChamberTuning,
  type ShowcaseKey,
} from '@/lib/chamberTuning';

/**
 * The place the whole thing turns out to have been happening in.
 *
 * Scroll past the last project and the camera BACKS UP: the space you've been flying through shrinks
 * into a display, and the display turns out to be a screen standing in a room you've been in all along
 * (see docs/works-to-chamber-reveal.md).
 *
 * ── Why the seam is free ──────────────────────────────────────────────────────────────────────────
 * The trick is entirely in the framing. The display's aspect is set to the VIEWPORT's aspect, and at
 * progress 0 the camera sits at exactly the distance where it fills the frustum — so the canvas shows
 * the space texture 1:1, pixel for pixel, and the whole set is outside the frame. There is no cross-fade
 * and nothing is faked. The reveal is nothing but the camera moving away from a quad it was pressed
 * against.
 *
 * Because the display's aspect matches the viewport's, the distance that covers the frame vertically
 * also covers it horizontally — one number, exact at every aspect ratio:
 *
 *      coverDistance = (displayHeight / 2) / tan(fov / 2)
 *
 * ── What this module owns ─────────────────────────────────────────────────────────────────────────
 * The scene, its camera, and the pose for a given progress. It does NOT own:
 *  - the renderer or the space texture — it is drawn by the works field's renderer, because a GPU
 *    texture cannot cross a WebGL context and the space is rendered over there;
 *  - the numbers — they are the fixed values baked into lib/chamberTuning.ts.
 */

// ── Models ───────────────────────────────────────────────────────────────────────────────────────
// The table is the only prop left. One small map, all its weight in geometry — Draco handles it, so
// unlike the (now removed) podium it needs no texture tiering.
//
// The podium and its ring portal are gone on purpose: the hologram no longer floats over a plinth
// across the room, it sits with the table. What fills the space behind it is the ground (below), which
// costs no download at all.
// Exported so the rung-3 prefetch has ONE source for this path rather than a copy that can drift —
// see lib/prefetchWhenAssetsReady.ts.
export const TABLE_MODEL = '/models/table.glb';

const FOV = 45;

// ── Lighting ─────────────────────────────────────────────────────────────────────────────────────
// A screen this size in a dark room IS the room's light. Without it the reveal lands on a flat, unlit
// box and the whole thing falls apart.
//
// The environment matters more than it looks. The scene shares the works field's PMREM, which is a
// RoomEnvironment — a bright studio box — and these props are metal. At any real intensity that turns a
// dim room into a chrome showroom. So it's dialled right down by default and left on a knob.
/**
 * The light the display throws back into the room. It was a saturated cyan (0x6fd9ff), which is
 * physically honest for a screen showing a starfield — but it is only showing a starfield some of
 * the time. Through the reveal the thing on that screen is the mark, which is amber, and a cyan
 * bounce off an amber screen reads as a bug rather than as physics.
 *
 * SLATE_800 keeps it unmistakably cold against the room's warm fittings without being a hue that
 * appears nowhere else on the site.
 */
const SCREEN_LIGHT_COLOR = SLATE_800;
const SCREEN_LIGHT_DISTANCE = 9;
const SCREEN_LIGHT_OFFSET = 0.6; // sits in front of the display, throwing light back into the room
const KEY_LIGHT_COLOR = SLATE_600;

// The dark of space has to stop reading as transparency and start reading as an unlit panel — and the
// pinned sun (a fixed DOM billboard behind the canvas) has to leave with it, or it would hang in the
// middle of the screen while the set slides in behind it. Both happen inside this window, FAST, while
// the display still fills the frame — so the only thing you can actually see is a light dimming.
export const OPAQUE_WINDOW: [number, number] = [0.0, 0.12];

export interface ChamberScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** True once there is something worth drawing. */
  isReady: () => boolean;
  /** The display shows whatever the space pipeline last produced. */
  setSpaceTexture: (texture: THREE.Texture) => void;
  /**
   * Drive the entire reveal from its 0..1 progress. Pure — no timers, no tweens.
   *
   * Takes the viewport in CSS PIXELS rather than just its aspect, because the hologram's anchor is
   * projected through this camera into screen pixels here (see lib/hologramPose.ts) — and deriving that
   * from `window.innerHeight` on the other side would be quietly assuming the canvas fills the window.
   */
  update: (progress: number, viewportWidth: number, viewportHeight: number) => void;
  dispose: () => void;
}

// ── The showcase's handheld drift ──
// A camera that glides on perfect rails reads as a machine. What makes a move feel like a person is
// that it never quite holds still — so three incommensurate frequencies wander the pose around. They're
// deliberately not harmonics of one another: any common period and the wander starts to loop, and a loop
// reads as a machine again.
//
// But it is COUPLED TO MOTION, and that is not a refinement — it's the difference between a camera and a
// nervous tic. The first version ran off the clock alone, so once the showcase engaged the camera drifted
// forever, even parked. Everything in frame wandered without end. A person carrying a camera is unsteady
// while they MOVE and settles when they stop, so the drift now scales with the camera's own speed and
// goes to nothing at rest.
const SWAY_FREQUENCIES = [0.31, 0.47, 0.23];
const SWAY_PHASES = [0, 2.1, 4.3];
const SWAY_TARGET_SCALE = 0.45; // the aim wanders less than the body — a hand is steadier than a stance
const SWAY_REFERENCE_SPEED = 1.5; // camera speed (units/sec) at which the drift reaches full strength
const SWAY_SETTLE = 0.06; // how fast it eases in and out, so stopping doesn't cut the wander dead

// ── The reveal's two halves, one scrubbed span ──
// The reveal progress (0 = space full-screen, 1 = standing at the podium) carries BOTH motions: the
// pull-back out of the display fills [0, TOUR_START], and the tour across the room to the podium fills
// [TOUR_START, 1]. Because it's all one function of progress, scrolling back plays the whole thing in
// reverse for free — there is no separate return animation to keep in sync.
//
// Paired with REVEAL_STEP_DURATION in useHeroAnimation (see docs/chamber-tour-smoothing-plan.md): that
// glide's length × TOUR_START is the pull-back's real seconds, × (1 − TOUR_START) is the tour's. ~0.55
// splits the ~5.8s glide into ~3.2s of pull-back and ~2.6s of tour.
const TOUR_START = 0.55;
// The DOM hologram unseals once the tour has walked you all the way up to the podium — the very top of the
// span — and re-seals the instant you scroll back off it.
const HOLO_OPEN_PROGRESS = 0.999;
// The handheld sway lives only in the tour, so it has to be gone by the time the tour hands the camera to
// the pull-back at the table, or it drops off in a step. Fade it out across the last sliver of the tour
// (this fraction of it, at the table end) so there's nothing left to pop.
const SWAY_TOUR_FADE = 0.08;

// ── The tour as one continuous curve ──
// The tour used to be a GSAP timeline of per-key hops, each eased in and out, which braked the camera to a
// dead stop at every key. It's one shot, not a sequence of hops, so it's now a single Catmull-Rom spline
// through the keys, sampled by one 0..1 parameter. Velocity stays continuous through the interior keys —
// that's what removes the stutter — and only eases to rest at the very ends.
//
// Every channel is splined on the SAME parameter, so the camera, its aim and the screen pose can never
// drift out of sync (a separate arc-length curve per triple would desync a static camera from a moving aim).
const SPLINE_CHANNELS = [
  'x', 'y', 'z',
  'tx', 'ty', 'tz',
  'sx', 'sy', 'sz',
  'syaw', 'spitch', 'sroll', 'sh',
] as const;
type SplineChannel = (typeof SPLINE_CHANNELS)[number];
// Everything EXCEPT the aim (tx/ty/tz). Only the synthesised-return FALLBACK uses this — it samples the
// position/screen off the way-in keys and drives the aim by hand.
const POSE_CHANNELS = [
  'x', 'y', 'z',
  'sx', 'sy', 'sz',
  'syaw', 'spitch', 'sroll', 'sh',
] as const satisfies readonly SplineChannel[];

// ── The return is its own path, not a time-reversal ──
// Reversing the way-in spline outright makes the camera moonwalk: it slides back to the table still facing
// the podium, because position and aim reverse in lockstep, and only turns once it arrives. A person
// doesn't do that — they close the panel, turn around, THEN walk back facing where they're going. So the
// showcase is authored as a ROUND TRIP: keys [0, pivot] are the way in, keys [pivot, last] are the way out
// (podium → turn → table), and the return simply splines the way-out keys as progress recedes (see
// splitTour / sampleReturnInto). If a showcase has no way-out keys, the return is SYNTHESISED instead —
// held at the podium while the panel seals, then turned and walked, with `returnTurnEnd` as the split.
//
// Which direction the reveal is being scrubbed, from the change in progress. Committed glides are
// monotonic, so this is stable across a whole entry or exit; the deadzone stops smoothing jitter from
// flipping it while the camera is parked.
const PROGRESS_DIRECTION_EPS = 1e-4;

// Standard Catmull-Rom (tension 0.5). Pull it toward 0 to draw the curve tighter to the keys if a sharp
// look-around ever overshoots its aim.
const SPLINE_TENSION = 0.5;
const catmullRom = (p0: number, p1: number, p2: number, p3: number, t: number) => {
  const t2 = t * t;
  const t3 = t2 * t;
  const m1 = SPLINE_TENSION * (p2 - p0);
  const m2 = SPLINE_TENSION * (p3 - p1);
  return (
    (2 * p1 - 2 * p2 + m1 + m2) * t3 +
    (-3 * p1 + 3 * p2 - 2 * m1 - m2) * t2 +
    m1 * t +
    p1
  );
};

interface ChamberOptions {
  /** Shared with the works field — one PMREM texture, reused rather than regenerated. */
  environment: THREE.Texture | null;
  /** Fired once there's something to draw, so the host can start drawing it. */
  onReady?: () => void;
}

export function createChamberScene({
  environment,
  onReady,
}: ChamberOptions): ChamberScene {
  const scene = new THREE.Scene();
  scene.environment = environment;
  // A room is not a window. Anything the display doesn't cover reads as solid dark, not as a hole
  // through the canvas to the page behind it. (The display itself still writes the space's real alpha
  // until `uOpaque` closes it, which is what keeps progress 0 identical to the live space.)
  scene.background = new THREE.Color(0x000000);

  // The near plane costs depth PRECISION, and cheaply: precision goes as far/near, so 0.05 against 200
  // was a 4000:1 ratio and left almost no resolution in the distance — thin, nearly-coplanar geometry
  // (concentric rings, a flat ground plane, a table standing on it) then z-fights, and the flicker
  // crawls as the camera moves. 0.4 against 120 is 300:1 and an order of magnitude better.
  //
  // The floor under `near` is the reveal's start: the camera sits `coverDistance` from the display,
  // which is ~1.1 at the current display height. Anything below that can't clip it.
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.4, 120);

  // The live numbers. A stable object, mutated in place by the panel — so reading it once is enough.
  const tuning = getChamberTuning();

  // ── The display ──
  // A unit plane, scaled every frame to the viewport's aspect. That aspect match is the whole reason
  // progress 0 can be pixel-exact, so it is not a detail to "simplify" later.
  const displayGeometry = new THREE.PlaneGeometry(1, 1);
  const { material: displayMaterial, uniforms: displayUniforms } =
    createSpacePresentMaterial(new THREE.Texture(), { depth: true });
  const display = new THREE.Mesh(displayGeometry, displayMaterial);
  scene.add(display);

  // ── The ground ──
  // The room's floor. Added here rather than loaded, because it's two triangles and a shader — see
  // groundGrid.ts for why a modelled floor can't work in a set whose lights are all at zero.
  //
  // It cannot break the seam at progress 0, and the reason is worth stating because it isn't obvious.
  // At progress 0 the display fills the frustum exactly, and its material is OPAQUE-queued with
  // `depthWrite` on — so it writes depth across the whole frame, including where the dark of space is
  // still fully transparent (`uOpaque` is 0 there). The ground is transparent-queued, so it draws
  // AFTER, and every one of its fragments fails the depth test against the display. The floor is
  // therefore invisible until the pull-back actually moves the camera off the display's normal, which
  // is exactly when a floor should first appear.
  const groundGrid = createGroundGrid();
  // Drawn after the walls: neither writes depth, so at the join the later one wins and the floor is
  // the surface that belongs in front (see the matching renderOrder in chamberWalls).
  groundGrid.mesh.renderOrder = 1;
  scene.add(groundGrid.mesh);

  // ── The walls ──
  // One inward-facing cylinder wearing the same grid, fading out as it rises so there is no ceiling and
  // no corner. Same depth reasoning as the floor, so it likewise can't intrude on the seam at progress 0.
  const chamberWalls = createChamberWalls();
  scene.add(chamberWalls.mesh);

  // What the hologram is projected from. A real object rather than the wash of tint the floor used to
  // paint under the panel — see chamberPlinth.ts.
  const chamberPlinth = createChamberPlinth();
  scene.add(chamberPlinth.group);

  const screenLight = new THREE.PointLight(
    SCREEN_LIGHT_COLOR,
    tuning.screenLight,
    SCREEN_LIGHT_DISTANCE,
  );
  scene.add(screenLight);

  const keyLight = new THREE.DirectionalLight(KEY_LIGHT_COLOR, tuning.keyLight);
  keyLight.position.set(3, 6, 4);
  const ambientLight = new THREE.AmbientLight(0xffffff, tuning.ambient);
  scene.add(keyLight, ambientLight);

  // Every standard material in the set, so the environment's strength stays adjustable across all of it.
  const setMaterials: THREE.MeshStandardMaterial[] = [];
  /** Materials that get repainted, by the name the panel knows them by. */
  const tableMaterials: THREE.MeshStandardMaterial[] = [];
  /** What each repainted material's glow shipped at, so the slider scales it instead of replacing it. */
  const glowHome = new Map<THREE.MeshStandardMaterial, number>();
  const paintColor = new THREE.Color();

  /**
   * Repaint a material.
   *
   * The colour MULTIPLIES the model's own maps rather than replacing them — that's what keeps the surface
   * detail. And it has to hit the EMISSIVE too: this set is lit entirely by its own emissives (every light
   * is at zero), so a prop's shipped colour comes out of its emissive map. Tint only the base colour and
   * it stays stubbornly that colour, because the glow is what you're actually looking at.
   *
   * Which is also why the glow's STRENGTH is a separate control. Tint an emissive and nothing tempers it —
   * you get a flat, saturated wash. The strength is what turns a colour back into a light.
   */
  const paint = (
    materials: THREE.MeshStandardMaterial[],
    hex: string,
    glow = 1,
  ) => {
    paintColor.set(hex);
    materials.forEach((material) => {
      material.color.copy(paintColor);
      if (!material.emissive) return;
      material.emissive.copy(paintColor);
      material.emissiveIntensity = (glowHome.get(material) ?? 1) * glow;
    });
  };

  // ── Loading ──
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(getSharedDracoLoader());
  // No `detectKtx2Support` here: this scene has no renderer and never gets one (a GPU texture cannot
  // cross a context, which is why the works field draws this room). `useWorksField` — which builds
  // this — has already detected against the renderer these models will be drawn by.
  gltfLoader.setKTX2Loader(getSharedKtx2Loader());

  let tableGroup: THREE.Group | null = null;
  let tablePivot: THREE.Group | null = null;
  let disposed = false;

  /** Every switchable piece of every prop, by id — so a stray screen or ground plane can be removed. */
  const partMeshes = new Map<string, THREE.Mesh>();

  /**
   * Load a prop into its own group. It is placed entirely from the tuning, every frame.
   *
   * The nesting is `group → pivot → model`. The pivot exists because a model's origin is wherever the
   * artist exported from and is rarely anywhere useful — put it off to one side of the mesh and scaling
   * or turning the prop swings the whole thing around a point nobody cares about. Shifting the model
   * inside the pivot moves the point the OUTER group transforms around, so it can be re-anchored onto
   * the prop itself.
   */
  const loadProp = (
    model: string,
    path: string,
    assign: (group: THREE.Group, pivot: THREE.Group) => void,
  ) => {
    gltfLoader.load(
      path,
      (gltf) => {
        if (disposed) return;
        const group = new THREE.Group();
        const pivot = new THREE.Group();
        pivot.add(gltf.scene);
        group.add(pivot);
        // The part ids below are positional, and a mesh's own transform decides where it ends up — so the
        // hierarchy has to be resolved before anything measures or catalogues it.
        group.updateMatrixWorld(true);

        // Parts baked off in the tuning are CULLED, not hidden: the set only ever needs the one surface,
        // so the table's extra pieces are dead weight in memory and in the render traversal. We collect
        // them here and remove them once the traverse is done (you can't restructure the tree
        // mid-traverse), and skip every registration — materials, part catalogue — so nothing downstream
        // holds a reference to a mesh that's about to be gone.
        const hiddenPartIds = tuning.hiddenParts;
        const culledMeshes: THREE.Mesh[] = [];
        let index = 0;
        group.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          // Positional ids stay stable whether or not a part survives, so the tuning's baked list keeps
          // meaning the same pieces — the counter advances for every mesh, culled or not.
          const partIndex = index;
          index += 1;
          const id = `${model}:${partIndex}`;
          if (hiddenPartIds.includes(id)) {
            culledMeshes.push(child);
            return;
          }
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];
          materials.forEach((material) => {
            if (!(material instanceof THREE.MeshStandardMaterial)) return;
            setMaterials.push(material);
            if (model === 'table') tableMaterials.push(material);
            glowHome.set(material, material.emissiveIntensity ?? 1);
          });
          partMeshes.set(id, child);
        });

        // Drop the culled meshes now that the survivors are known. Their geometry is freed unless a
        // surviving mesh shares it — a model can reuse one buffer across several nodes, so a blind
        // dispose could pull it out from under a piece that's still on screen. Materials are left alone:
        // they're shared across the set and disposed with everything else on teardown.
        if (culledMeshes.length > 0) {
          const survivingGeometries = new Set<THREE.BufferGeometry>();
          partMeshes.forEach((mesh) => survivingGeometries.add(mesh.geometry));
          culledMeshes.forEach((mesh) => {
            mesh.removeFromParent();
            if (!survivingGeometries.has(mesh.geometry)) mesh.geometry.dispose();
          });
        }

        scene.add(group);
        assign(group, pivot);
        onReady?.();
      },
      undefined,
      (error) => console.error(`Failed to load ${path}`, error),
    );
  };

  loadProp('table', TABLE_MODEL, (group, pivot) => {
    tableGroup = group;
    tablePivot = pivot;
  });

  // ── The pose ──
  const rigPosition = new THREE.Vector3();
  const rigRotation = new THREE.Euler();
  const rigForward = new THREE.Vector3();
  const rigUp = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();
  const coverPosition = new THREE.Vector3(); // on the display's normal — where the reveal must begin
  const restPosition = new THREE.Vector3(); // a place in the room — where it ends
  const restTarget = new THREE.Vector3(); // …and what it's looking at by then
  const lookTarget = new THREE.Vector3(); // free / showcase cameras aim wherever they like
  const WORLD_UP = new THREE.Vector3(0, 1, 0);
  // Scratch for the handheld-drift speed measurement (see updateSwayStrength).
  const swayScratch = new THREE.Vector3();

  // ── The tour ──
  // A recorded camera path. `playhead` is the pose read every frame while the tour owns the shot; it's no
  // longer tweened — the spline samples straight into it from the reveal progress (see sampleTourInto).
  const playhead = {
    x: 0, y: 0, z: 0,
    tx: 0, ty: 0, tz: 0,
    sx: 0, sy: 0, sz: 0,
    syaw: 0, spitch: 0, sroll: 0,
    sh: 1,
  };

  // Spline the keys in [startIndex, endIndex] at `u` (0..1 across that sub-range) into `playhead`'s given
  // channels. This is a sub-range because the showcase is a round trip — the way in and the way out are
  // two slices of one key list (see splitTour).
  const sampleSpline = (
    startIndex: number,
    endIndex: number,
    u: number,
    channels: readonly SplineChannel[],
  ) => {
    const keys = tuning.showcaseKeys;
    const count = endIndex - startIndex + 1;
    if (count <= 0) return;
    if (count === 1) {
      for (const channel of channels) playhead[channel] = keys[startIndex][channel];
      return;
    }
    const segments = count - 1;
    const scaled = THREE.MathUtils.clamp(u, 0, 1) * segments;
    const seg = Math.min(Math.floor(scaled), segments - 1);
    const localT = scaled - seg;
    const at = (offset: number) =>
      keys[THREE.MathUtils.clamp(startIndex + offset, startIndex, endIndex)];
    const k0 = at(seg - 1);
    const k1 = at(seg);
    const k2 = at(seg + 1);
    const k3 = at(seg + 2);
    for (const channel of channels) {
      playhead[channel] = catmullRom(
        k0[channel],
        k1[channel],
        k2[channel],
        k3[channel],
        localT,
      );
    }
  };

  // ── Arc-length pacing for the way out, from a DENSE table ──
  // A uniform spline spends one flat slice of time per key. On the way out that's wrong: the dwell and the
  // turns barely move the camera (they mostly just swing the aim), while the last segment walks the whole
  // room — so the podium drags and the walk to the table gets crammed in. So the way out is re-timed by how
  // much the shot MOVES — position travelled plus aim swung (weighted) — spending time in proportion to it.
  //
  // Crucially this is measured from a dense sampling of the WHOLE path, not one estimate per key. A
  // per-key map changes pace in a STEP at every key — a >10× jump between the near-still dwell and the walk
  // — which is exactly the judder on the way back. Inverting a fine cumulative-travel table keeps the pace,
  // and so the speed, continuous. The table is rebuilt only when the keys / weight / range change.
  const ARC_SAMPLES = 96;
  const arcCumulative: number[] = new Array(ARC_SAMPLES).fill(0);
  let arcTotal = 0;
  let arcCacheKeys: ShowcaseKey[] | null = null;
  let arcCacheWeight = Number.NaN;
  let arcCacheStart = -1;
  let arcCacheEnd = -1;

  const arcPos = new THREE.Vector3();
  const arcDir = new THREE.Vector3();
  const arcPrevPos = new THREE.Vector3();
  const arcPrevDir = new THREE.Vector3();

  // Position + aim direction at spline param `u` over [startIndex, endIndex], into arcPos / arcDir.
  const evalPathAt = (startIndex: number, endIndex: number, u: number) => {
    const keys = tuning.showcaseKeys;
    const count = endIndex - startIndex + 1;
    if (count <= 1) {
      const key = keys[startIndex];
      arcPos.set(key.x, key.y, key.z);
      arcDir.set(key.tx - key.x, key.ty - key.y, key.tz - key.z);
      return;
    }
    const segments = count - 1;
    const scaled = THREE.MathUtils.clamp(u, 0, 1) * segments;
    const seg = Math.min(Math.floor(scaled), segments - 1);
    const localT = scaled - seg;
    const at = (offset: number) =>
      keys[THREE.MathUtils.clamp(startIndex + offset, startIndex, endIndex)];
    const k0 = at(seg - 1);
    const k1 = at(seg);
    const k2 = at(seg + 1);
    const k3 = at(seg + 2);
    const channel = (name: SplineChannel) => catmullRom(k0[name], k1[name], k2[name], k3[name], localT);
    const x = channel('x');
    const y = channel('y');
    const z = channel('z');
    arcPos.set(x, y, z);
    arcDir.set(channel('tx') - x, channel('ty') - y, channel('tz') - z);
  };

  const buildArcTable = (startIndex: number, endIndex: number) => {
    arcTotal = 0;
    for (let sample = 0; sample < ARC_SAMPLES; sample += 1) {
      evalPathAt(startIndex, endIndex, sample / (ARC_SAMPLES - 1));
      if (sample > 0) {
        const positionStep = arcPos.distanceTo(arcPrevPos);
        const aimStep =
          arcDir.lengthSq() > 1e-8 && arcPrevDir.lengthSq() > 1e-8
            ? arcDir.angleTo(arcPrevDir)
            : 0;
        arcTotal += positionStep + tuning.returnAimWeight * aimStep;
      }
      arcCumulative[sample] = arcTotal;
      arcPrevPos.copy(arcPos);
      arcPrevDir.copy(arcDir);
    }
  };

  const ensureArcTable = (startIndex: number, endIndex: number) => {
    const keys = tuning.showcaseKeys;
    if (
      keys === arcCacheKeys &&
      tuning.returnAimWeight === arcCacheWeight &&
      startIndex === arcCacheStart &&
      endIndex === arcCacheEnd
    ) {
      return;
    }
    buildArcTable(startIndex, endIndex);
    arcCacheKeys = keys;
    arcCacheWeight = tuning.returnAimWeight;
    arcCacheStart = startIndex;
    arcCacheEnd = endIndex;
  };

  // Map a linear 0..1 (even in TIME) to the spline parameter that moves at an even, CONTINUOUS pace across
  // [startIndex, endIndex], by inverting the cumulative-travel table.
  const arcLengthParam = (startIndex: number, endIndex: number, linearU: number) => {
    if (endIndex <= startIndex) return 0;
    ensureArcTable(startIndex, endIndex);
    if (arcTotal <= 1e-6) return THREE.MathUtils.clamp(linearU, 0, 1);
    const target = THREE.MathUtils.clamp(linearU, 0, 1) * arcTotal;
    // The table is monotonic — binary-search the span the target falls in, then lerp the param across it.
    let low = 0;
    let high = ARC_SAMPLES - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (arcCumulative[mid] < target) low = mid + 1;
      else high = mid;
    }
    if (low === 0) return 0;
    const spanStart = arcCumulative[low - 1];
    const spanEnd = arcCumulative[low];
    const spanT = spanEnd > spanStart ? (target - spanStart) / (spanEnd - spanStart) : 0;
    return (low - 1 + spanT) / (ARC_SAMPLES - 1);
  };

  // Where the way in ends and the way out begins. The pivot (the podium) is shared: the way in is keys
  // [0, pivot], the way out is keys [pivot, last]. If there's nothing past the pivot, there's no authored
  // way out and the return is synthesised instead.
  const splitTour = () => {
    const last = tuning.showcaseKeys.length - 1;
    const pivot = THREE.MathUtils.clamp(tuning.returnKeyStart - 1, 0, Math.max(last, 0));
    return { last, pivot, hasReturnKeys: pivot < last };
  };

  // Forward: the whole authored pose off the way-in keys — including the look-around, which is the point.
  const sampleTourInto = (u: number) => {
    const { pivot } = splitTour();
    sampleSpline(0, pivot, u, SPLINE_CHANNELS);
  };

  // Return: spline the authored way-out keys (podium → turn → table), read as progress recedes — so the
  // camera closes the panel, turns at the podium, and walks back facing the table, all as recorded.
  const sampleReturnInto = (tourU: number) => {
    const { pivot, last, hasReturnKeys } = splitTour();
    if (hasReturnKeys) {
      // `tourU` runs 1 (podium) → 0 (table) on the way out; the way-out spline runs 0 (its podium) → 1
      // (its table), so the linear-in-time parameter is 1 − tourU. Ease it out so the walk DECELERATES into
      // the table (an even pace coasts in at full speed and stops dead against the pull-back), then re-time
      // by arc length so the walk itself doesn't rush.
      const linearU = 1 - tourU;
      const easedU = 1 - Math.pow(1 - linearU, Math.max(tuning.returnEndEase, 1));
      const evenU = arcLengthParam(pivot, last, easedU);
      sampleSpline(pivot, last, evenU, SPLINE_CHANNELS);
      return;
    }
    // ── Fallback: no authored way out — synthesise close/turn/walk ──
    // Same position path as the way in (retraced), but the aim is re-choreographed so the camera turns at
    // the podium and then faces the table it's walking to, instead of moonwalking.
    const table = tuning.showcaseKeys[0];
    const podium = tuning.showcaseKeys[pivot];
    if (!table || !podium) return;
    const turnEnd = tuning.returnTurnEnd;
    const poseU = tourU >= turnEnd ? 1 : tourU / turnEnd;
    sampleSpline(0, pivot, poseU, POSE_CHANNELS);
    const turnT = 1 - THREE.MathUtils.smoothstep(tourU, turnEnd, 1);
    playhead.tx = THREE.MathUtils.lerp(podium.tx, table.tx, turnT);
    playhead.ty = THREE.MathUtils.lerp(podium.ty, table.ty, turnT);
    playhead.tz = THREE.MathUtils.lerp(podium.tz, table.tz, turnT);
  };

  // True while the spline owns the pose (the tour half of the span). Kept so the handheld sway can start
  // from rest the frame the tour engages, rather than reading a stale playhead delta (see the guard in update).
  let wasInTour = false;
  // Which way the reveal is being scrubbed, and the last progress we saw it at (see PROGRESS_DIRECTION_EPS).
  let returning = false;
  let previousProgress = 0;

  // ── Telling the FAQ hologram when to unseal ──
  // The panel is DOM and lives outside this scene entirely (see components/.../FaqHologram), so this is
  // the one thing the scene owes it: the moment the tour finishes walking you up to the podium. That
  // moment is the end of a GSAP timeline — a point in TIME, not a scroll position — which is exactly why
  // the pin can't announce it and this has to.
  let hologramOpen = false;
  const setHologramOpen = (open: boolean) => {
    if (open === hologramOpen) return;
    hologramOpen = open;
    window.dispatchEvent(
      new CustomEvent<ChamberHologramDetail>(CHAMBER_HOLOGRAM_EVENT, {
        detail: { open },
      }),
    );
  };

  // How fast the camera is actually travelling, smoothed — the drift rides on this, so a parked camera
  // is perfectly still and a moving one is alive.
  const previousPlayhead = new THREE.Vector3();
  let hasPreviousPlayhead = false;
  let swayStrength = 0;
  let lastSwayFrame = performance.now();

  const updateSwayStrength = () => {
    const now = performance.now();
    const deltaSeconds = Math.min((now - lastSwayFrame) / 1000, 0.1);
    lastSwayFrame = now;

    let speed = 0;
    if (hasPreviousPlayhead && deltaSeconds > 0) {
      speed =
        previousPlayhead.distanceTo(
          swayScratch.set(playhead.x, playhead.y, playhead.z),
        ) / deltaSeconds;
    }
    previousPlayhead.set(playhead.x, playhead.y, playhead.z);
    hasPreviousPlayhead = true;

    const target = THREE.MathUtils.clamp(speed / SWAY_REFERENCE_SPEED, 0, 1);
    swayStrength += (target - swayStrength) * SWAY_SETTLE;
  };

  /** The handheld wander. Applied to the played-back pose, never to the recorded keys. */
  const swayAt = (seconds: number, index: number, scale: number) =>
    Math.sin(seconds * SWAY_FREQUENCIES[index] * Math.PI * 2 + SWAY_PHASES[index]) *
    tuning.showcaseSway *
    swayStrength *
    scale;

  /**
   * Every prop is placed the same way: shown/hidden, scaled, moved, turned. Rotations in degrees.
   *
   * Scale is PER AXIS on purpose — it's how a prop's screen is made to match the render's shape, by
   * stretching the prop rather than distorting the picture to fit it.
   */
  interface PropPlacement {
    show: boolean;
    scaleX: number;
    scaleY: number;
    scaleZ: number;
    x: number;
    y: number;
    z: number;
    rotX: number;
    rotY: number;
    rotZ: number;
    /** In the MODEL's coordinates: the point the prop scales and turns around. */
    pivotX: number;
    pivotY: number;
    pivotZ: number;
  }
  const placeProp = (
    group: THREE.Group | null,
    pivot: THREE.Group | null,
    place: PropPlacement,
  ) => {
    if (!group) return;
    group.visible = place.show;
    if (!place.show) return;
    // Shifting the model back by the pivot moves the point the group turns around ONTO it.
    pivot?.position.set(-place.pivotX, -place.pivotY, -place.pivotZ);
    group.scale.set(place.scaleX, place.scaleY, place.scaleZ);
    group.position.set(place.x, place.y, place.z);
    group.rotation.set(
      THREE.MathUtils.degToRad(place.rotX),
      THREE.MathUtils.degToRad(place.rotY),
      THREE.MathUtils.degToRad(place.rotZ),
    );
  };

  // ── The hologram's anchor ──
  // The FAQ panel is DOM, so all this scene owes it is a place to be: the anchor projected through this
  // camera into screen pixels, plus how many pixels one world unit spans at that depth. See
  // lib/hologramPose.ts for why the panel isn't just a texture on a plane.
  const holoAnchor = new THREE.Vector3();
  const holoNdc = new THREE.Vector3();
  const holoView = new THREE.Vector3();
  // The camera drifts (see the sway above). At full follow the panel drifts with it, which is what makes
  // it read as a thing in the room — but reading a FAQ that never holds still is unpleasant, so the
  // wander is damped against a slowly-settling rest position and `holoSwayFollow` picks the blend.
  const holoRest = { x: 0, y: 0, seeded: false };
  const HOLO_REST_SETTLE = 0.06;

  const publishHologram = (viewportWidth: number, viewportHeight: number) => {
    holoAnchor.set(tuning.holoX, tuning.holoY, tuning.holoZ);
    // `project()` reads matrixWorldInverse, which only the renderer normally refreshes — and it hasn't
    // run yet this frame, so the camera we just posed would be projected from its LAST pose.
    camera.updateMatrixWorld();

    // Depth along the VIEW axis, not the straight-line distance to the camera: the perspective divide
    // uses view-space z, so this is exact rather than nearly right when the anchor is off-centre.
    holoView.copy(holoAnchor).applyMatrix4(camera.matrixWorldInverse);
    const depth = -holoView.z;
    // Behind the camera (the tour spends most of its time facing elsewhere) → there is nothing to place.
    if (depth <= camera.near) {
      hideHologram();
      return;
    }

    holoNdc.copy(holoAnchor).project(camera);
    const rawX = (holoNdc.x * 0.5 + 0.5) * viewportWidth;
    const rawY = (-holoNdc.y * 0.5 + 0.5) * viewportHeight;
    if (!holoRest.seeded) {
      holoRest.x = rawX;
      holoRest.y = rawY;
      holoRest.seeded = true;
    }
    holoRest.x += (rawX - holoRest.x) * HOLO_REST_SETTLE;
    holoRest.y += (rawY - holoRest.y) * HOLO_REST_SETTLE;
    const follow = tuning.holoSwayFollow;

    publishHologramPose({
      x: holoRest.x + (rawX - holoRest.x) * follow,
      y: holoRest.y + (rawY - holoRest.y) * follow,
      // The same relation the display's cover distance is built on, read the other way round: at this
      // depth, one world unit is this many pixels tall. Everything the panel is made of is authored in
      // world units and multiplied through this, so it grows like a real object as you walk up to it.
      pixelsPerUnit:
        viewportHeight /
        (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * depth),
    });
  };

  /** Ease the pull-back: slow off the display, slow into the room. */
  const easeReveal = (progress: number) => {
    const clamped = THREE.MathUtils.clamp(progress, 0, 1);
    const power = tuning.easePower;
    return clamped < 0.5
      ? 0.5 * Math.pow(clamped * 2, power)
      : 1 - 0.5 * Math.pow((1 - clamped) * 2, power);
  };

  const update = (
    progress: number,
    viewportWidth: number,
    viewportHeight: number,
  ) => {
    const aspect = viewportWidth / viewportHeight;
    const eased = easeReveal(progress);

    // Which way we're scrubbing — the return re-choreographs the tour rather than time-reversing it. Read
    // from the change in progress.
    if (progress > previousProgress + PROGRESS_DIRECTION_EPS) {
      returning = false;
    } else if (progress < previousProgress - PROGRESS_DIRECTION_EPS) {
      returning = true;
    }
    previousProgress = progress;

    // The reveal's span carries both motions: the pull-back on [0, TOUR_START], the tour on the rest.
    // Sample the tour into `playhead` up front so the screen placement below and the camera placement
    // further down read one consistent pose. Going in, that's the authored spline; coming out, it's the
    // re-choreographed return (close, turn, walk).
    const inTour = progress > TOUR_START;
    const tourU = inTour ? (progress - TOUR_START) / (1 - TOUR_START) : 0;
    if (inTour) {
      // Start the handheld sway from rest the frame the tour engages, rather than off a stale delta.
      if (!wasInTour) hasPreviousPlayhead = false;
      if (returning) sampleReturnInto(tourU);
      else sampleTourInto(tourU);
    }
    wasInTour = inTour;

    // The rig: where the display hangs, and which way it faces. The camera is DERIVED from it, so the
    // whole shot moves as one and the cover maths below can never drift out of step with it.
    //
    // The screen is pinned to the tuning while the pull-back owns the shot. The tour drives it too — that's
    // what lets the space feed lift out of the table and travel across the room, instead of the camera
    // merely orbiting a screen bolted to a desk forever. At the [TOUR_START] boundary the two agree, because
    // showcase key 0's screen pose is authored to match the rig.
    const screenX = inTour ? playhead.sx : tuning.rigX;
    const screenY = inTour ? playhead.sy : tuning.rigY;
    const screenZ = inTour ? playhead.sz : tuning.rigZ;
    const screenYaw = inTour ? playhead.syaw : tuning.rigYaw;
    const screenPitch = inTour ? playhead.spitch : tuning.rigPitch;
    const screenRoll = inTour ? playhead.sroll : tuning.rigRoll;
    const screenHeight = inTour ? playhead.sh : tuning.displayHeight;

    // `rigForward` is the display's actual NORMAL, taken from its rotation rather than assembled from
    // the yaw by hand — so tilting it can't quietly put the camera off-axis and break the seam.
    rigPosition.set(screenX, screenY, screenZ);
    rigRotation.set(
      THREE.MathUtils.degToRad(screenPitch),
      THREE.MathUtils.degToRad(screenYaw),
      THREE.MathUtils.degToRad(screenRoll),
    );
    rigForward.set(0, 0, 1).applyEuler(rigRotation);
    rigUp.set(0, 1, 0).applyEuler(rigRotation);

    // Trim the picture's edges. Ramped in with the pull-back, NEVER applied flat: at progress 0 the
    // display has to show the space render 1:1 or the seam dies — a crop there opens the reveal on a
    // zoomed picture, i.e. a visible jump. If a prop's screen doesn't fit the render's shape, stretch the
    // PROP (its scale is per-axis) rather than distorting the picture to fit it.
    const cropLeft = tuning.cropLeft * eased;
    const cropRight = tuning.cropRight * eased;
    const cropTop = tuning.cropTop * eased;
    const cropBottom = tuning.cropBottom * eased;
    displayUniforms.uCrop.value.set(cropLeft, cropRight, cropTop, cropBottom);

    // The quad shrinks along with the trim, so the picture is CROPPED rather than squashed into a
    // smaller frame. With no crop this is the full viewport aspect — which is what keeps `coverDistance`
    // exact at progress 0.
    const keptWidth = Math.max(1 - cropLeft - cropRight, 0.001);
    const keptHeight = Math.max(1 - cropTop - cropBottom, 0.001);
    display.scale.set(
      screenHeight * aspect * keptWidth,
      screenHeight * keptHeight,
      1,
    );
    display.position.copy(rigPosition);
    display.rotation.copy(rigRotation);

    screenLight.position
      .copy(rigPosition)
      .addScaledVector(rigForward, SCREEN_LIGHT_OFFSET);
    screenLight.intensity = tuning.screenLight;
    ambientLight.intensity = tuning.ambient;
    keyLight.intensity = tuning.keyLight;

    placeProp(tableGroup, tablePivot, {
      show: tuning.showTable,
      scaleX: tuning.tableScaleX,
      scaleY: tuning.tableScaleY,
      scaleZ: tuning.tableScaleZ,
      x: tuning.tableX,
      y: tuning.tableY,
      z: tuning.tableZ,
      rotX: tuning.tableRotX,
      rotY: tuning.tableRotY,
      rotZ: tuning.tableRotZ,
      pivotX: tuning.tablePivotX,
      pivotY: tuning.tablePivotY,
      pivotZ: tuning.tablePivotZ,
    });

    // The floor. Its glow tracks the hologram's anchor, so moving the panel moves the pool of light
    // under it and the two can never drift apart.
    groundGrid.mesh.visible = tuning.showGround;
    if (tuning.showGround) {
      groundGrid.mesh.position.y = tuning.groundY;
      groundGrid.uniforms.uOpacity.value = tuning.groundOpacity;
      groundGrid.uniforms.uLineColor.value.set(tuning.groundLineColor);
      // With walls up, the floor stops AT them; without, it dissolves into the void instead.
      groundGrid.uniforms.uClipRadius.value = tuning.showWalls
        ? tuning.wallRadius
        : Number.MAX_VALUE;
      groundGrid.uniforms.uCell.value = tuning.groundCell;
      groundGrid.uniforms.uLineWidth.value = tuning.groundLineWidth;
      groundGrid.uniforms.uFade.value = tuning.groundFade;

      // The light fittings dropped into the tiling — the room's actual light source. Their contact
      // darkening is measured against the clip radius above, so it always lands where the floor
      // genuinely ends rather than at a distance kept in step with the wall's by hand.
      groundGrid.uniforms.uLightOn.value = tuning.showFloorLights ? 1 : 0;
      groundGrid.uniforms.uLightColor.value.set(tuning.floorLightColor);
      groundGrid.uniforms.uLightCoreColor.value.set(tuning.floorLightCoreColor);
      groundGrid.uniforms.uLightEvery.value = tuning.floorLightEvery;
      groundGrid.uniforms.uPaverSize.value = tuning.floorPaverSize;
      groundGrid.uniforms.uPaverBevel.value = tuning.floorPaverBevel;
      groundGrid.uniforms.uCoreSigma.value = tuning.floorLightCoreSigma;
      groundGrid.uniforms.uCoreIntensity.value = tuning.floorLightCoreIntensity;
      groundGrid.uniforms.uBodyIntensity.value = tuning.floorLightBodyIntensity;
      groundGrid.uniforms.uRimWidth.value = tuning.floorLightRimWidth;
      groundGrid.uniforms.uRimDepth.value = tuning.floorLightRimDepth;
      groundGrid.uniforms.uPoolSigma.value = tuning.floorLightPoolSigma;
      groundGrid.uniforms.uPoolStrength.value = tuning.floorLightPoolStrength;
      groundGrid.uniforms.uLightLead.value = tuning.floorLightLead;
      // Only with walls up: without them the floor dissolves into a void and there is no corner to
      // occlude — darkening the dissolve would just dim the horizon.
      groundGrid.uniforms.uContactWidth.value = tuning.groundContactWidth;
      groundGrid.uniforms.uContactStrength.value = tuning.showWalls
        ? tuning.groundContactStrength
        : 0;

      // The room's lights, coming up as you back out of the screen. The wavefront starts at the DISPLAY
      // — the thing you were just inside — so the light spreads from the table outward, and the room
      // assembles itself around the one object you already knew was there.
      applySurfaceLighting(groundGrid.uniforms, tuning, rigPosition, progress);
    }

    // The walls ride the SAME wavefront off the SAME origin, so the sweep crosses the floor line as one
    // event rather than as two surfaces that happen to agree.
    chamberWalls.mesh.visible = tuning.showWalls;
    if (tuning.showWalls) {
      chamberWalls.setShape(tuning.wallRadius, tuning.wallHeight, tuning.groundY);
      chamberWalls.uniforms.uOpacity.value = tuning.wallOpacity;
      chamberWalls.uniforms.uFadeStart.value = tuning.wallFadeStart;
      chamberWalls.uniforms.uWallColor.value.set(tuning.wallColor);
      // Material and light direction — the wall's own surface, independent of the fittings.
      chamberWalls.uniforms.uGrain.value = tuning.wallGrain;
      chamberWalls.uniforms.uTexture.value = tuning.wallTexture;
      chamberWalls.uniforms.uTextureScale.value = tuning.wallTextureScale;
      chamberWalls.uniforms.uTextureFade.value = tuning.wallTextureFade;
      chamberWalls.uniforms.uSkirtHeight.value = tuning.wallSkirtHeight;
      chamberWalls.uniforms.uSkirtDepth.value = tuning.wallSkirtDepth;
      chamberWalls.uniforms.uDirectional.value = tuning.wallDirectional;

      // Panelling. `uRadius` is set by setShape above, so a seam authored in world units always
      // converts through the circumference the wall actually has.
      chamberWalls.uniforms.uPanelColumns.value = tuning.wallPanelColumns;
      chamberWalls.uniforms.uPanelRowHeight.value = tuning.wallPanelRowHeight;
      chamberWalls.uniforms.uPanelSeam.value = tuning.wallPanelSeam;
      chamberWalls.uniforms.uPanelSeamDepth.value = tuning.wallPanelSeamDepth;
      chamberWalls.uniforms.uPanelBevel.value = tuning.wallPanelBevel;

      // The strip at eye height — the room's second light source, and the one the tour looks straight at.
      chamberWalls.uniforms.uStripOn.value = tuning.showWallStrip ? 1 : 0;
      chamberWalls.uniforms.uStripColor.value.set(tuning.wallStripColor);
      chamberWalls.uniforms.uStripY.value = tuning.wallStripY;
      chamberWalls.uniforms.uStripHalf.value = tuning.wallStripHalf;
      chamberWalls.uniforms.uStripGlow.value = tuning.wallStripGlow;
      chamberWalls.uniforms.uStripBloom.value = tuning.wallStripBloom;
      chamberWalls.uniforms.uStripIntensity.value = tuning.wallStripIntensity;
      chamberWalls.uniforms.uStripSegments.value = tuning.wallStripSegments;
      chamberWalls.uniforms.uStripGap.value = tuning.wallStripGap;
      chamberWalls.uniforms.uStripRecess.value = tuning.wallStripRecess;
      chamberWalls.uniforms.uStripRecessDepth.value = tuning.wallStripRecessDepth;
      applySurfaceLighting(chamberWalls.uniforms, tuning, rigPosition, progress);
    }

    // ── The plinth ──
    // Placed from the hologram's own anchor, so the source and the thing it projects can never drift
    // apart — the same coupling the floor's pool of tint used to have, now on an object that earns it.
    // It stands ON the floor, so only X and Z come from the panel; its own height decides the rest.
    chamberPlinth.group.visible = tuning.showPlinth;
    if (tuning.showPlinth) {
      chamberPlinth.group.position.set(tuning.holoX, tuning.groundY, tuning.holoZ);
      chamberPlinth.setShape(
        tuning.plinthRadius,
        tuning.plinthHeight,
        tuning.plinthCoreRadius,
        tuning.plinthCoreHeight,
      );

      const body = chamberPlinth.bodyUniforms;
      body.uBodyColor.value.set(tuning.plinthColor);
      body.uGlowColor.value.set(tuning.plinthGlowColor);
      body.uVents.value = tuning.plinthVents;
      body.uVentWidth.value = tuning.plinthVentWidth;
      body.uVentBottom.value = tuning.plinthVentBottom;
      body.uVentTop.value = tuning.plinthVentTop;
      body.uVentGlow.value = tuning.plinthVentGlow;
      body.uRingY.value = tuning.plinthRingY;
      body.uRingWidth.value = tuning.plinthRingWidth;
      body.uRingGlow.value = tuning.plinthRingGlow;
      body.uRimGlow.value = tuning.plinthRimGlow;
      body.uBevel.value = tuning.plinthBevel;

      const core = chamberPlinth.coreUniforms;
      core.uCoreColor.value.set(tuning.plinthCoreColor);
      core.uCoreIntensity.value = tuning.plinthCoreIntensity;
      core.uCoreFade.value = tuning.plinthCoreFade;

      // The same wavefront the floor and the walls ride, so the plinth powers up as part of the room
      // rather than on a clock of its own — and reverses with it for free.
      applySurfaceLighting(body, tuning, rigPosition, progress);
      applySurfaceLighting(core, tuning, rigPosition, progress);
    }

    // The environment is what turns dim metal into a chrome showroom, so it stays adjustable across
    // everything in the set at once.
    setMaterials.forEach((material) => {
      material.envMapIntensity = tuning.envIntensity;
    });

    paint(tableMaterials, tuning.tableColor);

    // The dark of space stops being transparent, and the pinned sun leaves with it (the pin fades the
    // sun over the same window — see the reveal crossing in useHeroAnimation).
    displayUniforms.uOpaque.value = THREE.MathUtils.smoothstep(
      progress,
      OPAQUE_WINDOW[0],
      OPAQUE_WINDOW[1],
    );

    // The camera flies from the display's NORMAL to a place in the room.
    //
    // It has to START on the normal: that is the only spot where the display fills the frustum and the
    // picture reads 1:1 with the live scene, and that identity IS the reveal. So rotating the display
    // moves the first frame of the shot, and there's no way around it.
    //
    // But where it ends is just a position — deliberately NOT "back off along the normal". Tie the
    // resting camera to the normal and turning the display drags the whole shot with it, which makes the
    // display impossible to aim. This way, turning the display just turns the display: the camera stays
    // where it was put and watches it turn.
    const coverDistance =
      tuning.displayHeight / 2 / Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
    coverPosition
      .copy(rigPosition)
      .addScaledVector(rigForward, coverDistance);
    // Where the pull-back lands in the room — and, going the other way, where it lifts off from. On the way
    // IN that's the tour's first key (the table); on the way OUT it's the way-out's LAST key, so the
    // pull-back picks up EXACTLY where the return walk set the camera down, with no pop between key 7 and
    // key 0 (they're both "at the table" but not pixel-identical). `cam*` is the fallback for a room with no
    // showcase recorded at all.
    const restSplit = splitTour();
    const restKey =
      tuning.showcaseKeys.length === 0
        ? undefined
        : returning && restSplit.hasReturnKeys
          ? tuning.showcaseKeys[restSplit.last]
          : tuning.showcaseKeys[0];
    restPosition.set(
      restKey ? restKey.x : tuning.camX,
      restKey ? restKey.y : tuning.camY,
      restKey ? restKey.z : tuning.camZ,
    );

    camera.aspect = aspect;

    // The hologram unseals once the tour has walked you up to the podium — the very top of the span — and
    // re-seals the instant you scroll back off it. No timeline, no onComplete: it's a threshold on the same
    // progress that drives everything else, so forward and back stay in sync for free.
    setHologramOpen(progress >= HOLO_OPEN_PROGRESS);

    if (inTour) {
      // The tour half: the camera rides the spline, with the handheld drift layered on top. The drift is
      // coupled to the camera's own speed, so it breathes through the walk and settles to still once you
      // park at the podium — which is what you want for reading the FAQ. It's also faded out across the last
      // sliver of the tour so it's fully gone by the table hand-off (SWAY_TOUR_FADE), leaving no step.
      updateSwayStrength();
      const seconds = performance.now() / 1000;
      const swayFade = THREE.MathUtils.smoothstep(tourU, 0, SWAY_TOUR_FADE);
      camera.position.set(
        playhead.x + swayAt(seconds, 0, 1) * swayFade,
        playhead.y + swayAt(seconds, 1, 1) * swayFade,
        playhead.z + swayAt(seconds, 2, 1) * swayFade,
      );
      lookTarget.set(
        playhead.tx + swayAt(seconds, 1, SWAY_TARGET_SCALE) * swayFade,
        playhead.ty + swayAt(seconds, 2, SWAY_TARGET_SCALE) * swayFade,
        playhead.tz + swayAt(seconds, 0, SWAY_TARGET_SCALE) * swayFade,
      );
      camera.up.copy(WORLD_UP);
      camera.lookAt(lookTarget);
      camera.updateProjectionMatrix();
    } else {
      // The pull-back half: the camera backs off the display's normal into the room. Rescaled to
      // [0, TOUR_START] so it completes exactly on showcase key 0 — which is where the spline picks up, so
      // the two halves meet on the same pose with nothing to seam.
      const pullBack = easeReveal(THREE.MathUtils.clamp(progress / TOUR_START, 0, 1));

      camera.position.lerpVectors(coverPosition, restPosition, pullBack);

      // The camera's UP starts matched to the display's, then eases back to world-up as it retreats.
      //
      // At progress 0 the two must agree or the seam dies: a canted display seen by an upright camera
      // does NOT fill the frustum (its corners cut in) and the picture arrives rotated. Matching the roll
      // keeps it exact. Easing back out then does something better than merely permitting the tilt — you
      // begin square-on, unable to tell the screen is canted at all, and as you back away the room
      // straightens while the screen rolls into its real mounting.
      cameraUp.copy(rigUp).lerp(WORLD_UP, pullBack);
      // Degenerate only if the display were rolled a full 180°, where the two ups cancel out. Hold the
      // display's own up there rather than hand `lookAt` a zero-length vector.
      camera.up.copy(cameraUp.lengthSq() > 1e-6 ? cameraUp.normalize() : rigUp);

      // The aim eases OFF the display as it retreats. It has to start dead on it — that plus sitting on
      // the normal is what makes the picture read 1:1 — but welding it there for the whole move is what
      // made the screen "the pin", and meant the reveal could never land facing anything else. Now it
      // finishes looking wherever key 0 looks, which is where the tour picks up.
      restTarget.set(
        restKey ? restKey.tx : tuning.camTargetX,
        restKey ? restKey.ty : tuning.camTargetY,
        restKey ? restKey.tz : tuning.camTargetZ,
      );
      lookTarget.lerpVectors(rigPosition, restTarget, pullBack);
      camera.lookAt(lookTarget);
      camera.updateProjectionMatrix();
    }

    // ── Place the hologram, from whichever camera pose we just landed on ──
    // Only in the tour half. Mid-pull-back the camera is still inside the display, and a panel anchored out
    // in the set would hang in front of the space feed — the one image the whole reveal exists to keep
    // untouched. Publishing across the whole tour (not just at the podium) lets the panel track and grow as
    // you approach; it stays hidden until the camera actually turns to face it, since `publishHologram`
    // hides an anchor that's behind the camera.
    const canPlaceHologram = inTour && tuning.showHologram;
    if (canPlaceHologram) {
      publishHologram(viewportWidth, viewportHeight);
    } else {
      hideHologram();
    }
  };

  const chamberScene: ChamberScene = {
    scene,
    camera,
    // The display IS the reveal; the props can still be streaming in behind it, because at progress 0 it
    // fills the frame and none of them is visible yet anyway.
    isReady: () => true,
    setSpaceTexture: (texture) => {
      displayUniforms.uSpace.value = texture;
    },
    update,
    dispose: () => {
      disposed = true;
      // The room is gone; the panel anchored to it must not outlive it.
      setHologramOpen(false);
      hideHologram();
      displayGeometry.dispose();
      displayMaterial.dispose();
      groundGrid.dispose();
      chamberWalls.dispose();
      chamberPlinth.dispose();
      [tableGroup].forEach((group) =>
        group?.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry.dispose();
            const materials = Array.isArray(child.material)
              ? child.material
              : [child.material];
            materials.forEach((material) => material.dispose());
          }
        }),
      );
      // No dracoLoader.dispose() — it is shared and page-lifetime (see lib/modelLoading.ts).
    },
  };

  return chamberScene;
}
