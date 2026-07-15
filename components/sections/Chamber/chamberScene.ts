import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { createSpacePresentMaterial } from '@/lib/spacePresentMaterial';
import { getPerformanceTier } from '@/lib/performanceTier';
import { hideHologram, publishHologramPose } from '@/lib/hologramPose';
import gsap from 'gsap';
import { prefersReducedMotion as reduceMotionQuery } from '@/lib/prefersReducedMotion';
import {
  CHAMBER_HOLOGRAM_EVENT,
  type ChamberHologramDetail,
} from '@/lib/chamberEvents';
import {
  getChamberTuning,
  onChamberCommand,
  reportChamberParts,
  setChamberTuning,
  type ChamberPart,
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
 *  - the numbers — every one was authored without being able to see the scene, so they live in
 *    lib/chamberTuning.ts and are dragged into place from an on-screen panel (localhost only).
 */

// ── Models ───────────────────────────────────────────────────────────────────────────────────────
// The podium shipped with 27 maps at 4096² — 2.3 GB of VRAM untouched, which is not a heavy model but an
// unusable one. Capped it's 31 MB / 122 MB, so it ships at two tiers and the runtime picks one from
// measured frame times rather than a device sniff (see performanceTier).
const PODIUM_MODEL_LOW = '/models/podium-512.glb';
const PODIUM_MODEL_HIGH = '/models/podium-1024.glb';
// The table is the mirror image: one small map, all its weight in geometry. Draco handles it; one tier.
const TABLE_MODEL = '/models/table.glb';
const DRACO_DECODER_PATH = '/draco/';

const FOV = 45;

// ── Lighting ─────────────────────────────────────────────────────────────────────────────────────
// A screen this size in a dark room IS the room's light. Without it the reveal lands on a flat, unlit
// box and the whole thing falls apart.
//
// The environment matters more than it looks. The scene shares the works field's PMREM, which is a
// RoomEnvironment — a bright studio box — and these props are metal. At any real intensity that turns a
// dim room into a chrome showroom. So it's dialled right down by default and left on a knob.
const SCREEN_LIGHT_COLOR = 0x6fd9ff;
const SCREEN_LIGHT_DISTANCE = 9;
const SCREEN_LIGHT_OFFSET = 0.6; // sits in front of the display, throwing light back into the room
const KEY_LIGHT_COLOR = 0x9fb6d4;

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
   * A progress to hold the reveal at, ignoring the scroll — otherwise null. Tuning only.
   *
   * The reveal is a committed glide between two scroll stops, so scrolling can only ever leave you at
   * progress 0 or 1: there is no way to *stop* halfway and look at it. This is how it's pinned open.
   */
  progressOverride: () => number | null;
  /**
   * Tuning only: turn the object the panel's open tab is on. Returns true if it took the drag, so the
   * host knows not to also hand it to the space camera underneath.
   */
  dragRotate: (deltaX: number, deltaY: number) => boolean;
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

/** Degrees of turn per pixel dragged. */
const DRAG_SENSITIVITY = 0.4;
/** Radians of look per pixel dragged, when flying the scout camera. */
const LOOK_SENSITIVITY = 0.006;
/** Don't let the aim tip over the poles, where the up vector flips and the view snaps round. */
const LOOK_PHI_LIMIT = 0.03;
/** Holding shift. */
const SPRINT_MULTIPLIER = 3;
/**
 * The scout's pose is written back into the tuning so the panel's readouts follow it — but a store
 * write re-renders the panel, and doing that every frame while a key is held would have React fighting
 * the render loop for the frame budget. So while you're flying, the scene holds the pose and only
 * publishes it on a throttle (and immediately on release).
 */
const FLY_PUBLISH_MS = 120;

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
  const cableMaterials: THREE.MeshStandardMaterial[] = [];
  const joinerMaterials: THREE.MeshStandardMaterial[] = [];
  const tableMaterials: THREE.MeshStandardMaterial[] = [];
  /** What each repainted material's glow shipped at, so the slider scales it instead of replacing it. */
  const glowHome = new Map<THREE.MeshStandardMaterial, number>();
  const paintColor = new THREE.Color();

  /**
   * Repaint a material.
   *
   * The colour MULTIPLIES the model's own maps rather than replacing them — that's what keeps the surface
   * detail. And it has to hit the EMISSIVE too: this set is lit entirely by its own emissives (every light
   * is at zero), so the cables' orange comes out of their emissive map. Tint only the base colour and they
   * stay stubbornly orange, because the glow is what you're actually looking at.
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
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);

  let podiumGroup: THREE.Group | null = null;
  let podiumPivot: THREE.Group | null = null;
  let tableGroup: THREE.Group | null = null;
  let tablePivot: THREE.Group | null = null;
  let disposed = false;

  /** Every switchable piece of every prop, by id — so a stray screen or ground plane can be removed. */
  const partMeshes = new Map<string, THREE.Mesh>();

  // ── Assemblies within the podium ──
  //
  // The podium's pieces belong to each other in groups: the RING PORTAL is the rings plus the turbine
  // that sits in their mouth; the CABLING is the cables plus their joiners. Move one without the other
  // and the model comes apart. So they're rigged as units.
  //
  // They need a RIG rather than being moved directly, because the optimizer bakes node transforms into
  // the geometry: every mesh sits at the model's origin with its vertices out in model space. Scale or
  // turn such a mesh and it pivots around the model's ORIGIN and swings across the room. A rig placed at
  // the assembly's own centre makes it scale and turn on the spot.
  // One assembly: the rings, the turbine in their mouth, and the cabling that feeds them. They are one
  // machine — move or scale any of it alone and the model comes apart.
  const PODIUM_ASSEMBLIES: Record<string, string[]> = {
    rings: ['Rings', 'Turbine', 'Cables', 'Cable_Joiners'],
  };

  interface Assembly {
    rig: THREE.Group;
    /** Where it started, so an offset is applied to it rather than accumulating on it. */
    home: THREE.Vector3;
    meshes: THREE.Mesh[];
  }
  const assemblies = new Map<string, Assembly>();

  /**
   * ONLY the core ring spins — the innermost of the three concentric rings. The outer two, the turbine and
   * the cabling all hold still, which is what makes the spin read as a mechanism rather than the whole
   * prop rotating.
   *
   * It needs a SECOND rig, nested inside the assembly's and centred on that ring alone: the assembly's
   * centre takes in the turbine and the cabling, so spinning at that level would swing the ring around the
   * whole machine instead of turning it on the spot.
   *
   * (This is also why the podium is built with `join: false` — the optimizer fuses meshes that share a
   * material, and it had welded all three rings into one object. There was no core ring to spin.)
   */
  let ringsSpinRig: THREE.Group | null = null;
  let lastSpinFrame = performance.now();

  /**
   * Lift a set of meshes onto one rig, centred on the group they form — so it scales and turns on the
   * spot rather than around the model's origin.
   *
   * The centre is measured in WORLD space but has to be *expressed* in the parent's — a rig's `position`
   * is local to its parent. Get that wrong and the rig's origin lands somewhere else entirely, the meshes
   * still draw in the right place (the two errors cancel), and nothing looks wrong until you ROTATE it:
   * then it swings around a point off in space instead of turning on its own axis.
   */
  const rigMeshes = (meshes: THREE.Mesh[]) => {
    const parent = meshes[0]?.parent;
    if (!parent || meshes.length === 0) return null;

    const box = new THREE.Box3();
    meshes.forEach((mesh) => box.expandByObject(mesh));
    const home = parent.worldToLocal(box.getCenter(new THREE.Vector3()));

    const rig = new THREE.Group();
    rig.position.copy(home);
    parent.add(rig);
    meshes.forEach((mesh) => {
      // Each mesh keeps drawing exactly where it was: the rig moved TO the centre, so they step back by it.
      mesh.position.sub(home);
      rig.add(mesh);
    });
    return { rig, home };
  };

  const rigAssembly = (name: string, meshes: THREE.Mesh[]) => {
    const rigged = rigMeshes(meshes);
    if (rigged) assemblies.set(name, { ...rigged, meshes });
  };

  /** Place an assembly from its tuning: shown/hidden, moved, scaled and turned about its own centre. */
  const placeAssembly = (
    name: string,
    show: boolean,
    x: number,
    y: number,
    z: number,
    scale: number,
    rotX: number,
    rotY: number,
    rotZ: number,
  ) => {
    const assembly = assemblies.get(name);
    if (!assembly) return;
    assembly.rig.visible = show;
    if (!show) return;
    assembly.rig.position.set(
      assembly.home.x + x,
      assembly.home.y + y,
      assembly.home.z + z,
    );
    assembly.rig.scale.setScalar(scale);
    assembly.rig.rotation.set(
      THREE.MathUtils.degToRad(rotX),
      THREE.MathUtils.degToRad(rotY),
      THREE.MathUtils.degToRad(rotZ),
    );
  };

  /**
   * Load a prop into its own group. It is placed entirely from the tuning, every frame.
   *
   * The nesting is `group → pivot → model`. The pivot exists because a model's origin is wherever the
   * artist exported from and is rarely anywhere useful — the podium's sits out by its rings, so scaling
   * and turning it swing the whole thing around a point nobody cares about. Shifting the model inside
   * the pivot moves the point the OUTER group transforms around, so it can be re-anchored onto the
   * podium itself.
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
        // Everything below MEASURES this model — part centres, assembly centres, which ring is the core.
        // Those measurements read `matrixWorld`, and the podium's nodes carry real transforms (its three
        // rings are the same geometry at three different scales), so without this they'd all come back
        // identical and the core ring would be picked at random.
        group.updateMatrixWorld(true);

        // Catalogue the prop's pieces so they can be switched off — or pivoted onto — individually. Ids
        // are POSITIONAL: the meshes' own names are useless (the podium's are all literally
        // "defaultMaterial"), so the MATERIAL name is what identifies a piece to a human.
        const parts: ChamberPart[] = [];
        const partBox = new THREE.Box3();
        const partCentre = new THREE.Vector3();
        // A material can own SEVERAL meshes — the podium has three concentric rings and two turbine parts.
        const meshesByMaterial = new Map<string, THREE.Mesh[]>();
        // Parts baked off in the tuning are CULLED, not hidden: the set only ever needs one surface and
        // the ring portal, so the podium's ground plane / backdrop and the table's extra pieces are dead
        // weight in memory and in the render traversal. We collect them here and remove them once the
        // traverse is done (you can't restructure the tree mid-traverse), and skip every registration —
        // materials, part catalogue, assembly grouping — so nothing downstream holds a reference to a mesh
        // that's about to be gone.
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
          const name = materials[0]?.name || child.name || `part ${partIndex}`;
          materials.forEach((material) => {
            if (!(material instanceof THREE.MeshStandardMaterial)) return;
            setMaterials.push(material);
            // The cable RUNS get repainted — NOT their joiners, which are the dark connectors and want to
            // stay dark. Everything else keeps the colour it shipped with.
            if (model === 'podium' && name === 'Cables') cableMaterials.push(material);
            if (model === 'podium' && name === 'Cable_Joiners') joinerMaterials.push(material);
            if (model === 'table') tableMaterials.push(material);
            glowHome.set(material, material.emissiveIntensity ?? 1);
          });
          const vertices = child.geometry.getAttribute('position')?.count ?? 0;
          // Measured while the group is still untransformed, so this is the model's own frame — which is
          // exactly the frame the pivot is expressed in.
          partBox.setFromObject(child);
          partBox.getCenter(partCentre);
          parts.push({
            id,
            label: `${name} · ${vertices.toLocaleString()}`,
            center: [
              Math.round(partCentre.x * 100) / 100,
              Math.round(partCentre.y * 100) / 100,
              Math.round(partCentre.z * 100) / 100,
            ],
          });
          partMeshes.set(id, child);
          if (model === 'podium') {
            const sameMaterial = meshesByMaterial.get(name) ?? [];
            sameMaterial.push(child);
            meshesByMaterial.set(name, sameMaterial);
          }
        });

        // Drop the culled meshes now that the survivors are known. Their geometry is freed unless a
        // surviving mesh shares it — the podium's three rings are the same geometry at different scales, so
        // a blind dispose could pull a buffer out from under a piece that's still on screen. Materials are
        // left alone: they're shared across the set and disposed with everything else on teardown.
        if (culledMeshes.length > 0) {
          const survivingGeometries = new Set<THREE.BufferGeometry>();
          partMeshes.forEach((mesh) => survivingGeometries.add(mesh.geometry));
          culledMeshes.forEach((mesh) => {
            mesh.removeFromParent();
            if (!survivingGeometries.has(mesh.geometry)) mesh.geometry.dispose();
          });
        }

        reportChamberParts(model, parts);

        // Rig the podium's assemblies so each moves as the unit it is.
        if (model === 'podium') {
          Object.entries(PODIUM_ASSEMBLIES).forEach(([name, materials]) => {
            const meshes = materials.flatMap(
              (material) => meshesByMaterial.get(material) ?? [],
            );
            rigAssembly(name, meshes);
          });
          // Reparenting moved things; re-measure from the new hierarchy.
          group.updateMatrixWorld(true);

          // …then give the CORE ring — the innermost of the three — a rig of its own inside that, so it
          // can turn without dragging the outer rings, the turbine and the cabling round with it.
          //
          // "Innermost" is MEASURED, not assumed: the three rings are identical geometry at different
          // node scales, so their raw vertex bounds are the same and only their placed size tells them
          // apart. The smallest is the core.
          const rings = meshesByMaterial.get('Rings') ?? [];
          const core = rings.reduce<{ mesh: THREE.Mesh; size: number } | null>((smallest, mesh) => {
            const size = new THREE.Box3()
              .setFromObject(mesh)
              .getSize(new THREE.Vector3())
              .length();
            return !smallest || size < smallest.size ? { mesh, size } : smallest;
          }, null);

          if (core) {
            // Same rigging, and the same trap: the centre must be expressed in the PARENT's space (which
            // by now is the assembly's rig, not the model root), or the ring turns around a point off in
            // space instead of on its own axis.
            ringsSpinRig = rigMeshes([core.mesh])?.rig ?? null;
          }
        }

        scene.add(group);
        assign(group, pivot);
        onReady?.();
      },
      undefined,
      (error) => console.error(`Failed to load ${path}`, error),
    );
  };

  const highTier = getPerformanceTier() === 'high';
  loadProp('podium', highTier ? PODIUM_MODEL_HIGH : PODIUM_MODEL_LOW, (group, pivot) => {
    podiumGroup = group;
    podiumPivot = pivot;
  });
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
  // ── The scout camera you fly ──
  // Mouse aims it, WASD moves it the way it's aimed. The scene owns the live pose while you're flying
  // (see FLY_PUBLISH_MS) and adopts the tuning's values whenever something else changes them — a slider,
  // or jumping to a recorded pose.
  const scoutPosition = new THREE.Vector3();
  const scoutAim = new THREE.Vector3();
  const scoutForward = new THREE.Vector3();
  const scoutRight = new THREE.Vector3();
  const lookOffset = new THREE.Vector3();
  const lookSpherical = new THREE.Spherical();
  const swayScratch = new THREE.Vector3();
  const heldKeys = new Set<string>();
  let lastFlyFrame = performance.now();
  let lastPublish = 0;
  /** What we last wrote to the tuning — so an edit from anywhere else is recognisable as external. */
  let published = { x: NaN, y: NaN, z: NaN, tx: NaN, ty: NaN, tz: NaN };

  const round = (value: number) => Math.round(value * 100) / 100;

  const publishScout = () => {
    published = {
      x: round(scoutPosition.x),
      y: round(scoutPosition.y),
      z: round(scoutPosition.z),
      tx: round(scoutAim.x),
      ty: round(scoutAim.y),
      tz: round(scoutAim.z),
    };
    setChamberTuning({
      scoutX: published.x,
      scoutY: published.y,
      scoutZ: published.z,
      scoutTargetX: published.tx,
      scoutTargetY: published.ty,
      scoutTargetZ: published.tz,
    });
    lastPublish = performance.now();
  };

  /** Adopt the tuning's pose if anything OTHER than our own flying changed it. */
  const adoptExternalScout = () => {
    const changedElsewhere =
      tuning.scoutX !== published.x ||
      tuning.scoutY !== published.y ||
      tuning.scoutZ !== published.z ||
      tuning.scoutTargetX !== published.tx ||
      tuning.scoutTargetY !== published.ty ||
      tuning.scoutTargetZ !== published.tz;
    if (!changedElsewhere) return;
    scoutPosition.set(tuning.scoutX, tuning.scoutY, tuning.scoutZ);
    scoutAim.set(tuning.scoutTargetX, tuning.scoutTargetY, tuning.scoutTargetZ);
    published = {
      x: tuning.scoutX, y: tuning.scoutY, z: tuning.scoutZ,
      tx: tuning.scoutTargetX, ty: tuning.scoutTargetY, tz: tuning.scoutTargetZ,
    };
  };

  /** WASD to move, QE for up/down, shift to sprint. */
  const flyScout = () => {
    const now = performance.now();
    const deltaSeconds = Math.min((now - lastFlyFrame) / 1000, 0.1);
    lastFlyFrame = now;
    if (heldKeys.size === 0) return;

    const step =
      tuning.flySpeed *
      deltaSeconds *
      (heldKeys.has('shift') ? SPRINT_MULTIPLIER : 1);

    scoutForward.subVectors(scoutAim, scoutPosition).normalize();
    scoutRight.crossVectors(scoutForward, WORLD_UP).normalize();

    // Move the aim with the camera, so flying never changes where you're pointed.
    const travel = (direction: THREE.Vector3, distance: number) => {
      scoutPosition.addScaledVector(direction, distance);
      scoutAim.addScaledVector(direction, distance);
    };
    if (heldKeys.has('w')) travel(scoutForward, step);
    if (heldKeys.has('s')) travel(scoutForward, -step);
    if (heldKeys.has('d')) travel(scoutRight, step);
    if (heldKeys.has('a')) travel(scoutRight, -step);
    if (heldKeys.has('e')) travel(WORLD_UP, step);
    if (heldKeys.has('q')) travel(WORLD_UP, -step);

    if (now - lastPublish > FLY_PUBLISH_MS) publishScout();
  };

  const FLY_KEYS = new Set(['w', 'a', 's', 'd', 'q', 'e', 'shift']);
  const handleKeyDown = (event: KeyboardEvent) => {
    // Never while typing a value into the panel.
    if (
      event.target instanceof HTMLInputElement ||
      event.target instanceof HTMLTextAreaElement
    ) {
      return;
    }
    if (!tuning.freeCamera) return;
    const key = event.key.toLowerCase();
    if (!FLY_KEYS.has(key)) return;
    event.preventDefault();
    heldKeys.add(key);
  };
  const handleKeyUp = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    if (!heldKeys.delete(key)) return;
    // Land the exact pose the moment you stop, rather than wherever the throttle happened to leave it.
    if (heldKeys.size === 0) publishScout();
  };
  const handleBlur = () => heldKeys.clear();

  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
  }

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
  // channels. Reads the keys live, so recording a pose in the tuner takes effect on the next frame with
  // nothing to rebuild. This is a sub-range because the showcase is a round trip — the way in and the way
  // out are two slices of one key list (see splitTour).
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

  // ── Arc-length pacing for the way out ──
  // A uniform spline spends one flat slice of time per key. On the way out that's wrong: the dwell and the
  // turns barely move the camera (they mostly just swing the aim), while the last segment walks the whole
  // room — so the podium drags and the walk to the table gets crammed into the final slice, which is the
  // "starts slow then rushes" the return has. So the way out is re-timed by how much each segment actually
  // MOVES — position travelled plus aim swung (weighted) — spending time in proportion to that.
  const arcDirA = new THREE.Vector3();
  const arcDirB = new THREE.Vector3();
  const segmentTravel = (a: ShowcaseKey, b: ShowcaseKey) => {
    const positionTravel = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    arcDirA.set(a.tx - a.x, a.ty - a.y, a.tz - a.z);
    arcDirB.set(b.tx - b.x, b.ty - b.y, b.tz - b.z);
    // A degenerate aim (target on the camera) has no direction — count it as no swing rather than NaN.
    const aimSwing =
      arcDirA.lengthSq() > 1e-8 && arcDirB.lengthSq() > 1e-8
        ? arcDirA.angleTo(arcDirB)
        : 0;
    return positionTravel + tuning.returnAimWeight * aimSwing;
  };

  // Map a linear 0..1 (even in TIME) to the spline parameter that makes the camera move at an even PACE
  // across keys [startIndex, endIndex], by walking a per-segment travel budget.
  const arcLengthParam = (startIndex: number, endIndex: number, linearU: number) => {
    const keys = tuning.showcaseKeys;
    const segments = endIndex - startIndex;
    if (segments <= 0) return 0;
    let total = 0;
    for (let index = 0; index < segments; index += 1) {
      total += segmentTravel(keys[startIndex + index], keys[startIndex + index + 1]);
    }
    if (total <= 1e-6) return THREE.MathUtils.clamp(linearU, 0, 1); // nothing moves — linear is as good as any
    let remaining = THREE.MathUtils.clamp(linearU, 0, 1) * total;
    for (let index = 0; index < segments; index += 1) {
      const cost = segmentTravel(keys[startIndex + index], keys[startIndex + index + 1]);
      if (remaining <= cost || index === segments - 1) {
        const localT = cost > 1e-6 ? THREE.MathUtils.clamp(remaining / cost, 0, 1) : 0;
        return (index + localT) / segments;
      }
      remaining -= cost;
    }
    return 1;
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

  // ── Tuner preview ──
  // "Play tour" used to run a GSAP timeline; with the tour folded into the scrubbed reveal progress there
  // is no timeline to run, so the button sweeps the progress OVERRIDE through the whole shot instead. The
  // designer watches the exact path the scroll will drive — pull-back, tour, and the hologram unsealing at
  // the end — rather than a separate approximation of it. Recording keys is untouched; they're just the
  // spline's control points now.
  const preview = { progress: 0, active: false };
  const stopPreview = () => {
    gsap.killTweensOf(preview);
    preview.active = false;
  };
  const playPreview = () => {
    stopPreview();
    preview.active = true;
    preview.progress = 0;
    // showcaseSeconds is the TOUR's share of the sweep, so the pull-back's share is added on to match the
    // real glide's total. Linear, because the easing already lives in the path and the progress mapping —
    // easing the sweep too would double it up.
    const duration = reduceMotionQuery() ? 0 : tuning.showcaseSeconds / (1 - TOUR_START);
    gsap.to(preview, { progress: 1, duration, ease: 'none' });
  };


  // MEASURE the mesh where it actually is. The panel can't compute this — it would have to reproduce the
  // whole transform chain, and it would be wrong the moment the part sits inside a moved assembly.
  const centreOfPart = (partId: string): THREE.Vector3 | null => {
    const mesh = partMeshes.get(partId);
    if (!mesh) return null;
    return new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
  };

  const unsubscribeCommands = onChamberCommand((command) => {
    if (command.type === 'showcase:play') playPreview();
    else if (command.type === 'showcase:stop') stopPreview();
    else if (command.type === 'screen:to-part') {
      const centre = centreOfPart(command.partId);
      if (!centre) return;
      const round = (value: number) => Math.round(value * 100) / 100;
      setChamberTuning({
        rigX: round(centre.x),
        rigY: round(centre.y),
        rigZ: round(centre.z),
      });
    } else if (command.type === 'holo:to-part') {
      const centre = centreOfPart(command.partId);
      if (!centre) return;
      const round = (value: number) => Math.round(value * 100) / 100;
      setChamberTuning({
        holoX: round(centre.x),
        holoY: round(centre.y),
        holoZ: round(centre.z),
      });
    }
  });

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
    // from the change in progress, EXCEPT while the tuner is holding the reveal still: a frozen progress
    // isn't moving, so there's nothing to read a direction from, and the panel says which one it wants to
    // look at (holdReturning). This is what makes "freeze at the hologram and tune the way out" work.
    if (tuning.holdReveal) {
      returning = tuning.holdReturning;
    } else if (progress > previousProgress + PROGRESS_DIRECTION_EPS) {
      returning = false;
    } else if (progress < previousProgress - PROGRESS_DIRECTION_EPS) {
      returning = true;
    }
    previousProgress = progress;

    // The reveal's span carries both motions: the pull-back on [0, TOUR_START], the tour on the rest.
    // Sample the tour into `playhead` up front so the screen placement below and the camera placement
    // further down read one consistent pose. Going in, that's the authored spline; coming out, it's the
    // re-choreographed return (close, turn, walk). freeCamera (tuning) parks the tour entirely.
    const inTour = !tuning.freeCamera && progress > TOUR_START;
    if (inTour) {
      // Start the handheld sway from rest the frame the tour engages, rather than off a stale delta.
      if (!wasInTour) hasPreviousPlayhead = false;
      const tourU = (progress - TOUR_START) / (1 - TOUR_START);
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

    placeProp(podiumGroup, podiumPivot, {
      show: tuning.showPodium,
      scaleX: tuning.podiumScaleX,
      scaleY: tuning.podiumScaleY,
      scaleZ: tuning.podiumScaleZ,
      x: tuning.podiumX,
      y: tuning.podiumY,
      z: tuning.podiumZ,
      rotX: tuning.podiumRotX,
      rotY: tuning.podiumRotY,
      rotZ: tuning.podiumRotZ,
      pivotX: tuning.podiumPivotX,
      pivotY: tuning.podiumPivotY,
      pivotZ: tuning.podiumPivotZ,
    });
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

    // Parts baked off in the tuning are already gone (culled at load — see loadProp), so this only
    // handles a piece toggled off LIVE in the panel during a tuning session; it takes effect until the
    // next reload, which then culls it too.
    partMeshes.forEach((mesh, id) => {
      mesh.visible = !tuning.hiddenParts.includes(id);
    });

    // The ring portal — rings, turbine and cabling, as one machine. Lifted off the ground plane it shares
    // a model with (which `podiumY` can't do, since the ground rises with it), and scaled and turned
    // around its OWN centre rather than the model's origin.
    placeAssembly('rings', tuning.showRings, tuning.ringsX, tuning.ringsY, tuning.ringsZ, tuning.ringsScale, tuning.ringsRotX, tuning.ringsRotY, tuning.ringsRotZ);

    // The rings turn on their own axis. Z, because that's the one they're flat to — they're 2.78 × 2.76
    // across and only 0.24 thick, so Z is the axle. Driven off real elapsed time, not the frame count, so
    // the speed is the same on any machine.
    if (ringsSpinRig) {
      const now = performance.now();
      const spinDelta = Math.min((now - lastSpinFrame) / 1000, 0.1);
      lastSpinFrame = now;
      ringsSpinRig.rotation.z += THREE.MathUtils.degToRad(tuning.ringsSpin) * spinDelta;
    }

    // The environment is what turns dim metal into a chrome showroom, so it stays adjustable across
    // everything in the set at once.
    setMaterials.forEach((material) => {
      material.envMapIntensity = tuning.envIntensity;
    });

    paint(cableMaterials, tuning.cablesColor, tuning.cablesGlow);
    // The joiners are left exactly as they shipped unless you ask — they're hardware, not light.
    if (tuning.paintJoiners) {
      paint(joinerMaterials, tuning.joinersColor, tuning.joinersGlow);
    }
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
    // Where the reveal lands. With a showcase, that IS its first pose — the same pose the tour picks up
    // from, so the two can't drift apart and the hand-off has nothing to seam. `cam*` is only the
    // fallback for a room with no showcase recorded at all.
    const firstKey = tuning.showcaseKeys[0];
    restPosition.set(
      firstKey ? firstKey.x : tuning.camX,
      firstKey ? firstKey.y : tuning.camY,
      firstKey ? firstKey.z : tuning.camZ,
    );

    camera.aspect = aspect;

    // The hologram unseals once the tour has walked you up to the podium — the very top of the span — and
    // re-seals the instant you scroll back off it. No timeline, no onComplete: it's a threshold on the same
    // progress that drives everything else, so forward and back stay in sync for free.
    setHologramOpen(progress >= HOLO_OPEN_PROGRESS);

    if (tuning.freeCamera) {
      adoptExternalScout();
      flyScout();
      camera.position.copy(scoutPosition);
      camera.up.copy(WORLD_UP);
      camera.lookAt(scoutAim);
      camera.updateProjectionMatrix();
    } else if (inTour) {
      // The tour half: the camera rides the spline, with the handheld drift layered on top. The drift is
      // coupled to the camera's own speed, so it breathes through the walk and settles to still once you
      // park at the podium — which is what you want for reading the FAQ.
      updateSwayStrength();
      const seconds = performance.now() / 1000;
      camera.position.set(
        playhead.x + swayAt(seconds, 0, 1),
        playhead.y + swayAt(seconds, 1, 1),
        playhead.z + swayAt(seconds, 2, 1),
      );
      lookTarget.set(
        playhead.tx + swayAt(seconds, 1, SWAY_TARGET_SCALE),
        playhead.ty + swayAt(seconds, 2, SWAY_TARGET_SCALE),
        playhead.tz + swayAt(seconds, 0, SWAY_TARGET_SCALE),
      );
      camera.up.copy(WORLD_UP);
      camera.lookAt(lookTarget);
      camera.updateProjectionMatrix();
    } else {
      // The pull-back half: the camera backs off the display's normal into the room. Rescaled to
      // [0, TOUR_START] so it completes exactly on showcase key 0 — which is where the spline picks up, so
      // the two halves meet on the same pose with nothing to seam.
      //
      // Keep the fly clock honest across this spell of not flying, so re-entering the scout doesn't lurch.
      lastFlyFrame = performance.now();
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
        firstKey ? firstKey.tx : tuning.camTargetX,
        firstKey ? firstKey.ty : tuning.camTargetY,
        firstKey ? firstKey.tz : tuning.camTargetZ,
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
    // hides an anchor that's behind the camera. (The free camera is the tuning exception — placeable while
    // you fly around looking for a spot for it.)
    const canPlaceHologram = (inTour || tuning.freeCamera) && tuning.showHologram;
    if (canPlaceHologram) {
      publishHologram(viewportWidth, viewportHeight);
    } else {
      hideHologram();
    }
  };

  return {
    scene,
    camera,
    // The display IS the reveal; the props can still be streaming in behind it, because at progress 0 it
    // fills the frame and none of them is visible yet anyway.
    isReady: () => true,
    setSpaceTexture: (texture) => {
      displayUniforms.uSpace.value = texture;
    },
    progressOverride: () =>
      preview.active ? preview.progress : tuning.holdReveal ? tuning.revealAt : null,
    // Drag turns whichever prop the panel is open on — so the podium can be aimed by hand rather than by
    // hunting for numbers. Writes back into the tuning, so the panel's readouts follow and the result is
    // in what you copy out.
    //
    // While the free camera is on, the props are FROZEN and the drag flies the scout instead: it orbits
    // around whatever it's looking at, which is how you find a shot worth recording.
    dragRotate: (deltaX, deltaY) => {
      if (tuning.freeCamera) {
        // MOUSE LOOK, not orbit. The camera stays put and its AIM swings — which is what makes WASD
        // useful, because you then fly wherever you're pointed. (Orbit does the opposite: it pins the
        // aim and swings the camera, so there's nowhere to walk to.)
        adoptExternalScout();
        lookOffset.subVectors(scoutAim, scoutPosition);
        lookSpherical.setFromVector3(lookOffset);
        lookSpherical.theta -= deltaX * LOOK_SENSITIVITY;
        // Clamped off the poles: at phi 0 or π the up vector degenerates and the view snaps round.
        lookSpherical.phi = THREE.MathUtils.clamp(
          lookSpherical.phi + deltaY * LOOK_SENSITIVITY,
          LOOK_PHI_LIMIT,
          Math.PI - LOOK_PHI_LIMIT,
        );
        lookOffset.setFromSpherical(lookSpherical);
        scoutAim.copy(scoutPosition).add(lookOffset);
        publishScout();
        return true;
      }

      const target = tuning.dragTarget;
      if (target === 'none') return false;
      const yawKey = target === 'podium' ? 'podiumRotY' : 'tableRotY';
      const pitchKey = target === 'podium' ? 'podiumRotX' : 'tableRotX';
      const round = (value: number) => Math.round(value * 10) / 10;
      setChamberTuning({
        [yawKey]: round(tuning[yawKey] + deltaX * DRAG_SENSITIVITY),
        [pitchKey]: round(tuning[pitchKey] + deltaY * DRAG_SENSITIVITY),
      });
      return true;
    },
    update,
    dispose: () => {
      disposed = true;
      stopPreview();
      unsubscribeCommands();
      // The room is gone; the panel anchored to it must not outlive it.
      setHologramOpen(false);
      hideHologram();
      if (typeof window !== 'undefined') {
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('keyup', handleKeyUp);
        window.removeEventListener('blur', handleBlur);
      }
      displayGeometry.dispose();
      displayMaterial.dispose();
      [podiumGroup, tableGroup].forEach((group) =>
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
      dracoLoader.dispose();
    },
  };
}
