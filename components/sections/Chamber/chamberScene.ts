import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { createSpacePresentMaterial } from '@/lib/spacePresentMaterial';
import { getPerformanceTier } from '@/lib/performanceTier';
import {
  getChamberTuning,
  reportChamberParts,
  setChamberTuning,
  type ChamberPart,
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
  /** Drive the entire reveal from its 0..1 progress. Pure — no timers, no tweens. */
  update: (progress: number, aspect: number) => void;
  dispose: () => void;
}

/** Degrees of turn per pixel dragged. */
const DRAG_SENSITIVITY = 0.4;

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

  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.05, 200);

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

  // ── Loading ──
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);

  let podiumGroup: THREE.Group | null = null;
  let tableGroup: THREE.Group | null = null;
  let disposed = false;

  /** Every switchable piece of every prop, by id — so a stray screen or ground plane can be removed. */
  const partMeshes = new Map<string, THREE.Mesh>();

  /** Load a prop into its own group. It is placed entirely from the tuning, every frame. */
  const loadProp = (
    model: string,
    path: string,
    assign: (group: THREE.Group) => void,
  ) => {
    gltfLoader.load(
      path,
      (gltf) => {
        if (disposed) return;
        const group = new THREE.Group();
        group.add(gltf.scene);

        // Catalogue the prop's pieces so they can be switched off individually. Ids are POSITIONAL: the
        // meshes' own names are useless (the podium's are all literally "defaultMaterial"), so the
        // material name is what actually identifies a piece to a human.
        const parts: ChamberPart[] = [];
        let index = 0;
        group.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) return;
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];
          materials.forEach((material) => {
            if (material instanceof THREE.MeshStandardMaterial) {
              setMaterials.push(material);
            }
          });
          const id = `${model}:${index}`;
          const name = materials[0]?.name || child.name || `part ${index}`;
          const vertices = child.geometry.getAttribute('position')?.count ?? 0;
          parts.push({ id, label: `${name} · ${vertices.toLocaleString()}` });
          partMeshes.set(id, child);
          index += 1;
        });
        reportChamberParts(model, parts);

        scene.add(group);
        assign(group);
        onReady?.();
      },
      undefined,
      (error) => console.error(`Failed to load ${path}`, error),
    );
  };

  const highTier = getPerformanceTier() === 'high';
  loadProp('podium', highTier ? PODIUM_MODEL_HIGH : PODIUM_MODEL_LOW, (group) => {
    podiumGroup = group;
  });
  loadProp('table', TABLE_MODEL, (group) => {
    tableGroup = group;
  });

  // ── The pose ──
  const rigPosition = new THREE.Vector3();
  const rigRotation = new THREE.Euler();
  const rigForward = new THREE.Vector3();
  const rigUp = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();
  const coverPosition = new THREE.Vector3(); // on the display's normal — where the reveal must begin
  const restPosition = new THREE.Vector3(); // a place in the room — where it ends
  const WORLD_UP = new THREE.Vector3(0, 1, 0);

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
  }
  const placeProp = (group: THREE.Group | null, place: PropPlacement) => {
    if (!group) return;
    group.visible = place.show;
    if (!place.show) return;
    group.scale.set(place.scaleX, place.scaleY, place.scaleZ);
    group.position.set(place.x, place.y, place.z);
    group.rotation.set(
      THREE.MathUtils.degToRad(place.rotX),
      THREE.MathUtils.degToRad(place.rotY),
      THREE.MathUtils.degToRad(place.rotZ),
    );
  };

  /** Ease the pull-back: slow off the display, slow into the room. */
  const easeReveal = (progress: number) => {
    const clamped = THREE.MathUtils.clamp(progress, 0, 1);
    const power = tuning.easePower;
    return clamped < 0.5
      ? 0.5 * Math.pow(clamped * 2, power)
      : 1 - 0.5 * Math.pow((1 - clamped) * 2, power);
  };

  const update = (progress: number, aspect: number) => {
    const eased = easeReveal(progress);

    // The rig: where the display hangs, and which way it faces. The camera is DERIVED from it, so the
    // whole shot moves as one and the cover maths below can never drift out of step with it.
    //
    // `rigForward` is the display's actual NORMAL, taken from its rotation rather than assembled from
    // the yaw by hand — so tilting it can't quietly put the camera off-axis and break the seam.
    rigPosition.set(tuning.rigX, tuning.rigY, tuning.rigZ);
    rigRotation.set(
      THREE.MathUtils.degToRad(tuning.rigPitch),
      THREE.MathUtils.degToRad(tuning.rigYaw),
      THREE.MathUtils.degToRad(tuning.rigRoll),
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
      tuning.displayHeight * aspect * keptWidth,
      tuning.displayHeight * keptHeight,
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

    placeProp(podiumGroup, {
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
    });
    placeProp(tableGroup, {
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
    });

    // Pieces switched off in the panel — a prop's stray screen, a ground plane fighting the room.
    partMeshes.forEach((mesh, id) => {
      mesh.visible = !tuning.hiddenParts.includes(id);
    });

    // The environment is what turns dim metal into a chrome showroom, so it stays adjustable across
    // everything in the set at once.
    setMaterials.forEach((material) => {
      material.envMapIntensity = tuning.envIntensity;
    });

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
    restPosition.set(tuning.camX, tuning.camY, tuning.camZ);

    camera.aspect = aspect;
    camera.position.lerpVectors(coverPosition, restPosition, eased);

    // The camera's UP starts matched to the display's, then eases back to world-up as it retreats.
    //
    // At progress 0 the two must agree or the seam dies: a canted display seen by an upright camera does
    // NOT fill the frustum (its corners cut in) and the picture arrives rotated. Matching the roll keeps
    // it exact. Easing back out then does something better than merely permitting the tilt — you begin
    // square-on, unable to tell the screen is canted at all, and as you back away the room straightens
    // while the screen rolls into its real mounting.
    cameraUp.copy(rigUp).lerp(WORLD_UP, eased);
    // Degenerate only if the display were rolled a full 180°, where the two ups cancel out. Hold the
    // display's own up there rather than hand `lookAt` a zero-length vector.
    camera.up.copy(
      cameraUp.lengthSq() > 1e-6 ? cameraUp.normalize() : rigUp,
    );

    camera.lookAt(rigPosition);
    camera.updateProjectionMatrix();
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
    progressOverride: () => (tuning.holdReveal ? tuning.revealAt : null),
    // Drag turns whichever prop the panel is open on — so the podium can be aimed by hand rather than
    // by hunting for numbers. Writes back into the tuning, so the panel's readouts follow along and the
    // result is in what you copy out.
    dragRotate: (deltaX, deltaY) => {
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
