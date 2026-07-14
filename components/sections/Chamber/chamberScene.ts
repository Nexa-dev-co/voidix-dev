import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { createSpacePresentMaterial } from '@/lib/spacePresentMaterial';
import { getPerformanceTier } from '@/lib/performanceTier';
import { getChamberTuning, subscribeChamberTuning } from '@/lib/chamberTuning';

/**
 * The room the whole thing turns out to have been happening in.
 *
 * Scroll past the last project and the camera BACKS UP: the space you've been flying through shrinks
 * into a display, and the display turns out to be mounted in a cloning-tank chamber you've been
 * standing in all along (see docs/works-to-chamber-reveal.md).
 *
 * ── Why the seam is free ──────────────────────────────────────────────────────────────────────────
 * The trick is entirely in the framing. The display's aspect is set to the VIEWPORT's aspect, and at
 * progress 0 the camera sits at exactly the distance where it fills the frustum — so the canvas shows
 * the space texture 1:1, pixel for pixel, and everything else is outside the frame. There is no
 * cross-fade and nothing is faked. The reveal is nothing but the camera moving away from a quad it was
 * pressed against.
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
 *  - the numbers — every one of them was authored without being able to see the scene, so they live in
 *    lib/chamberTuning.ts and are dragged into place from an on-screen panel (localhost only).
 */

// ── Models ───────────────────────────────────────────────────────────────────────────────────────
// The chamber's 36 maps are all 1024², so the two tiers really are ~48 MB vs ~192 MB of resident VRAM.
// Which one we fetch is decided from measured frame times, not a device sniff (see performanceTier).
const CHAMBER_MODEL_LOW = '/models/chamber-512.glb';
const CHAMBER_MODEL_HIGH = '/models/chamber-1024.glb';
const SCREEN_MODEL = '/models/screen.glb';
const DRACO_DECODER_PATH = '/draco/';

const FOV = 45;

// ── Placing the room ─────────────────────────────────────────────────────────────────────────────
//
// ⚠ DO NOT place this model by its bounding box. That box is 1635 units tall, but the room you can
// actually stand in is only ~410 of them: it is dominated by a floor slab dropping ~600 units BELOW the
// walkable floor and a ceiling slab rising ~600 ABOVE it. Normalising by the box and calling its bottom
// "the floor" buried the display and the camera inside the floor slab — which is why the reveal used to
// finish staring at solid black. So it is anchored from measured coordinates instead.
//
// Raw model bounds: x −676…676, y −610…1026, z 46…1308.
const ROOM_FLOOR_RAW_Y = 12; // the surface you'd actually stand on, in the model's own coordinates
const ROOM_CENTRE_RAW_Z = 677; // …so world origin lands on the middle of that floor

// The frame's opening is nearly square (~1.157) while the display takes the viewport's aspect, so the
// frame is stretched to hug it. This caps how far it may be pushed from its native proportions, so an
// extreme viewport can't squash it into nonsense.
const BEZEL_MAX_STRETCH = 2.4;

// ── Lighting ─────────────────────────────────────────────────────────────────────────────────────
// A screen this size in a dark room IS the room's light. Without it the reveal lands on a flat, unlit
// box and the whole thing falls apart.
//
// The environment matters more than it looks. The chamber shares the works field's PMREM, which is a
// RoomEnvironment — a bright studio box — and the chamber's surfaces are metal. At any real intensity
// that turns a dim cloning chamber into a chrome showroom, which is exactly what the first pass did.
// So it's dialled right down by default and left on a knob.
const SCREEN_LIGHT_COLOR = 0x6fd9ff;
const SCREEN_LIGHT_DISTANCE = 9;
const SCREEN_LIGHT_OFFSET = 0.6; // sits in front of the display, throwing light back into the room
const KEY_LIGHT_COLOR = 0x9fb6d4;

// The dark of space has to stop reading as transparency and start reading as an unlit panel — and the
// pinned sun (a fixed DOM billboard behind the canvas) has to leave with it, or it would hang in the
// middle of the screen while the room slides in behind it. Both happen inside this window, FAST, while
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
  /** Drive the entire reveal from its 0..1 progress. Pure — no timers, no tweens. */
  update: (progress: number, aspect: number) => void;
  dispose: () => void;
}

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

  // Every standard material in the room, so the environment's strength stays adjustable.
  const roomMaterials: THREE.MeshStandardMaterial[] = [];
  const applyEnvIntensity = () => {
    roomMaterials.forEach((material) => {
      material.envMapIntensity = tuning.envIntensity;
    });
  };

  // ── Loading ──
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);

  let roomGroup: THREE.Group | null = null;
  let bezelGroup: THREE.Group | null = null;
  /** The frame, inside its group — it carries the orientation that stands the model upright. */
  let bezelModel: THREE.Object3D | null = null;
  /** Its bounds in its OWN coordinates, unrotated. Everything else is derived from these. */
  let bezelLocalBox: THREE.Box3 | null = null;
  let disposed = false;

  // The bezel alone is enough to start the reveal; the room is placed relative to it.
  const announceReady = () => {
    if (bezelGroup && !disposed) onReady?.();
  };

  // The room can be hidden to judge the display + bezel against plain black.
  const syncRoomVisibility = () => {
    if (!roomGroup) return;
    if (tuning.showRoom) scene.add(roomGroup);
    else scene.remove(roomGroup);
  };
  const unsubscribe = subscribeChamberTuning(() => {
    syncRoomVisibility();
    applyEnvIntensity();
  });

  // The room's geometry is trivial (~7k verts); the tier is purely about texture memory.
  const chamberPath =
    getPerformanceTier() === 'high' ? CHAMBER_MODEL_HIGH : CHAMBER_MODEL_LOW;
  gltfLoader.load(
    chamberPath,
    (gltf) => {
      if (disposed) return;
      // Left at the model's own origin and simply offset in `update` — see the note above.
      const group = new THREE.Group();
      group.add(gltf.scene);
      group.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const materials = Array.isArray(child.material)
            ? child.material
            : [child.material];
          materials.forEach((material) => {
            if (material instanceof THREE.MeshStandardMaterial) {
              roomMaterials.push(material);
            }
          });
        }
      });
      roomGroup = group;
      applyEnvIntensity();
      syncRoomVisibility();
    },
    undefined,
    (error) => console.error(`Failed to load chamber: ${chamberPath}`, error),
  );

  // The bezel. The model lies FLAT in its file — its face spans x/z with y as thickness — so it has to
  // be stood upright before it can frame anything. WHICH way is up depends on how it was exported, and
  // getting it wrong leaves you looking at the frame edge-on, so the orientation is tunable and the
  // frame's face is re-derived from it (see applyBezelOrientation).
  gltfLoader.load(
    SCREEN_MODEL,
    (gltf) => {
      if (disposed) return;
      bezelLocalBox = new THREE.Box3().setFromObject(gltf.scene);
      // Work out which way it has to be turned to face the viewer, from its own proportions.
      measureUpright(bezelLocalBox.getSize(new THREE.Vector3()));
      const group = new THREE.Group();
      group.add(gltf.scene);
      scene.add(group);
      bezelModel = gltf.scene;
      bezelGroup = group;
      announceReady();
    },
    undefined,
    (error) => console.error(`Failed to load screen: ${SCREEN_MODEL}`, error),
  );

  // ── The bezel's orientation ──
  //
  // The frame is exported lying FLAT, so it has to be stood up — and which way is "up" is a property of
  // how the artist exported it. Guessing it was a mistake: guess wrong and you're looking at the frame
  // edge-on, or at a slab lying on its back behind the picture.
  //
  // So it's MEASURED instead. A frame is a flat plate: its thinnest axis is its depth and its longest is
  // its width, whatever the file says. Turn it so the thinnest axis points at the viewer and the longest
  // runs across, and it stands up correctly no matter how it was exported.
  const uprightRotation = new THREE.Euler();
  const measureUpright = (size: THREE.Vector3) => {
    const extents = [size.x, size.y, size.z];
    const thinnest = extents.indexOf(Math.min(...extents));
    if (thinnest === 2) uprightRotation.set(0, 0, 0); // already face-on
    else if (thinnest === 1) uprightRotation.set(-Math.PI / 2, 0, 0); // lying flat → tip it up
    else uprightRotation.set(0, Math.PI / 2, 0); // standing on its edge → turn it to face us
  };

  // Whatever the measurement gives, the tuning rotation is layered ON TOP as a fine adjustment (it
  // should now be able to stay at zero). Once the frame is standing, its FACE has to be re-derived —
  // that's what gets stretched onto the display, and it's a different pair of axes than the file's.
  const bezelRotation = new THREE.Euler();
  const bezelMatrix = new THREE.Matrix4();
  const offsetMatrix = new THREE.Matrix4();
  const uprightMatrix = new THREE.Matrix4();
  const bezelBox = new THREE.Box3();
  const bezelSize = new THREE.Vector3();
  const bezelCentre = new THREE.Vector3();
  /** The standing frame's face: x = width, y = height. This is what gets stretched onto the display. */
  const bezelFace = new THREE.Vector2(1, 1);
  let appliedRotationKey = '';

  const applyBezelOrientation = () => {
    if (!bezelModel || !bezelLocalBox) return;
    const key = `${tuning.bezelRotX},${tuning.bezelRotY},${tuning.bezelRotZ}`;
    if (key === appliedRotationKey) return;
    appliedRotationKey = key;

    offsetMatrix.makeRotationFromEuler(
      new THREE.Euler(
        THREE.MathUtils.degToRad(tuning.bezelRotX),
        THREE.MathUtils.degToRad(tuning.bezelRotY),
        THREE.MathUtils.degToRad(tuning.bezelRotZ),
      ),
    );
    uprightMatrix.makeRotationFromEuler(uprightRotation);
    bezelMatrix.multiplyMatrices(offsetMatrix, uprightMatrix);
    bezelRotation.setFromRotationMatrix(bezelMatrix);

    // The frame's bounds once it's standing — Box3.applyMatrix4 turns all eight corners, so this is the
    // real face, not the one the file happened to be authored in.
    bezelBox.copy(bezelLocalBox).applyMatrix4(bezelMatrix);
    bezelBox.getSize(bezelSize);
    bezelBox.getCenter(bezelCentre);
    bezelFace.set(bezelSize.x || 1, bezelSize.y || 1);

    bezelModel.rotation.copy(bezelRotation);
    // Re-centre it on its group after turning, so it stays hung on the rig rather than swinging off it.
    bezelModel.position.copy(bezelCentre).negate();
  };

  // ── The pose ──
  const rigPosition = new THREE.Vector3();
  const rigForward = new THREE.Vector3();

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
    rigPosition.set(tuning.rigX, tuning.rigY, tuning.rigZ);
    rigForward.set(Math.sin(tuning.rigYaw), 0, Math.cos(tuning.rigYaw));

    // The display always wears the viewport's aspect — that's what keeps `coverDistance` exact.
    const displayWidth = tuning.displayHeight * aspect;
    display.scale.set(displayWidth, tuning.displayHeight, 1);
    display.position.copy(rigPosition);
    display.rotation.y = tuning.rigYaw;

    screenLight.position
      .copy(rigPosition)
      .addScaledVector(rigForward, SCREEN_LIGHT_OFFSET);
    screenLight.intensity = tuning.screenLight;
    ambientLight.intensity = tuning.ambient;
    keyLight.intensity = tuning.keyLight;

    applyBezelOrientation();

    if (bezelGroup) {
      // Stretch the standing frame onto the display's proportions. The group's own frame is the rig's,
      // so x is the display's width and y its height regardless of how the model had to be turned.
      const scaleX = (displayWidth * tuning.bezelOversize) / bezelFace.x;
      const scaleY = (tuning.displayHeight * tuning.bezelOversize) / bezelFace.y;
      const stretch = THREE.MathUtils.clamp(
        scaleX / scaleY,
        1 / BEZEL_MAX_STRETCH,
        BEZEL_MAX_STRETCH,
      );
      // Thickness follows the smaller of the two, so a wide stretch doesn't also make the frame deep.
      bezelGroup.scale.set(scaleY * stretch, scaleY, Math.min(scaleX, scaleY));
      bezelGroup.rotation.y = tuning.rigYaw;
      // Just behind (or in front of) the display, along its own facing direction.
      bezelGroup.position
        .copy(rigPosition)
        .addScaledVector(rigForward, tuning.bezelZ);
    }

    if (roomGroup) {
      roomGroup.scale.setScalar(tuning.roomScale);
      // Put the model's (0, walkable-floor, room-centre) on the world origin. Straight from measured
      // coordinates — its bounding box would put the floor eight units below where you stand.
      roomGroup.position.set(
        0,
        -ROOM_FLOOR_RAW_Y * tuning.roomScale,
        -ROOM_CENTRE_RAW_Z * tuning.roomScale,
      );
    }

    // The dark of space stops being transparent, and the pinned sun leaves with it (the pin fades the
    // sun over the same window — see the reveal crossing in useHeroAnimation).
    displayUniforms.uOpaque.value = THREE.MathUtils.smoothstep(
      progress,
      OPAQUE_WINDOW[0],
      OPAQUE_WINDOW[1],
    );

    // …and the camera simply backs away along the display's facing direction. At progress 0 it sits
    // exactly where the display fills the frustum, which is what makes the reveal seamless.
    const coverDistance =
      tuning.displayHeight / 2 / Math.tan(THREE.MathUtils.degToRad(FOV) / 2);
    const distance = THREE.MathUtils.lerp(
      coverDistance,
      tuning.restDistance,
      eased,
    );
    camera.aspect = aspect;
    camera.position
      .copy(rigPosition)
      .addScaledVector(rigForward, distance)
      .setY(rigPosition.y + tuning.restRise * eased);
    camera.lookAt(rigPosition);
    camera.updateProjectionMatrix();
  };

  return {
    scene,
    camera,
    isReady: () => !!bezelGroup,
    setSpaceTexture: (texture) => {
      displayUniforms.uSpace.value = texture;
    },
    progressOverride: () => (tuning.holdReveal ? tuning.revealAt : null),
    update,
    dispose: () => {
      disposed = true;
      unsubscribe();
      displayGeometry.dispose();
      displayMaterial.dispose();
      [roomGroup, bezelGroup].forEach((group) =>
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
