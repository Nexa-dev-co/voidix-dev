import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';

/**
 * What the star leaves behind.
 *
 * Loaded into the SUN's scene, beside the fractured sun — never into the works field. The finale is the
 * star BECOMING this, and a sun in one WebGL context turning into a black hole in another is a
 * cross-context cross-fade, which is the failure this project has already paid for twice. One scene,
 * one continuous transition. `/sun-lab` does exactly the same thing for exactly the same reason.
 *
 * ── How it arrives ───────────────────────────────────────────────────────────────────────────────
 * Not as a fade. Each part is scaled from zero on its own phase of the sequence, so the hole opens from
 * the middle and the disc gathers around it afterwards:
 *
 *   horizon  — the dark core, growing out of the point the star vanished into
 *   early    — the glow layers and secondary rings, once the core exists
 *   late     — the main ring, completing it
 *
 * The order is the whole point. The rings used to form BEFORE the core, and that read as two models
 * cross-fading rather than as one thing causing the next.
 */

const MODEL_PATH = '/models/black_hole.glb';
const DRACO_DECODER_PATH = '/draco/';

/**
 * ⚠ The horizon's specular, and the only way a black hole stays black.
 *
 * Lifted from `/sun-lab`, which found it the hard way. The model is converted to real
 * metallic-roughness at build time and the conversion faithfully preserves the artist's
 * `specularFactor` 0.2 — a 20%-reflective surface. Black albedo kills the DIFFUSE term but not the
 * specular one, so the sun's core light would land a glossy highlight directly on the event horizon.
 * `specularIntensity = 0` collapses that term for every light at every angle.
 */
const HORIZON_MATERIALS = ['black_hole_blackoutside', 'black_hole_center'];
/** The glow layers and the distortion shell — they gather once the core exists. */
const GLOW_MATERIALS = [
  'black_hole_light1',
  'black_hole_light2',
  'black_hole_light3',
  'black_hole_distortion',
];
/** The main ring completes the picture, so it is last. `ring2` is a secondary and forms early. */
const LATE_RING_MATERIAL = 'ring';
/** Not part of the black hole; the lab's base state hides it and so do we. */
const EXCLUDED_MATERIAL = 'Planet';

/** How much larger than the star the finished hole reads. Lab: BLACKHOLE_TARGET_FACTOR. */
const TARGET_FACTOR = 1.3;

type Phase = 'horizon' | 'early' | 'late';

interface PhasedMesh {
  mesh: THREE.Mesh;
  baseScale: THREE.Vector3;
  phase: Phase;
}

export interface SunBlackHole {
  object: THREE.Group;
  /**
   * Open it. Each argument is that phase's 0..1 — pass the values the singularity evaluator derived, so
   * the hole is a pure function of the sequence like everything else in the finale.
   */
  setForm: (horizonForm: number, earlyForm: number, lateForm: number) => void;
  dispose: () => void;
}

/**
 * Load it, or resolve null.
 *
 * Null rather than throwing: this is the very end of the page, and a failed decode should cost the
 * finale its subject rather than take the sun's whole canvas down with it.
 */
export async function createSunBlackHole(sunRadius: number): Promise<SunBlackHole | null> {
  // Sizing it against a radius that has not been measured yet would silently produce a hole scaled to
  // whatever the placeholder happened to be, and nothing downstream would look wrong enough to notice.
  if (!(sunRadius > 0)) return null;
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
  const gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);

  let model: THREE.Object3D;
  try {
    model = (await gltfLoader.loadAsync(MODEL_PATH)).scene;
  } catch {
    dracoLoader.dispose();
    return null;
  }
  dracoLoader.dispose();

  const phased: PhasedMesh[] = [];
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];

  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.push(mesh.geometry);
    const meshMaterials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const names = meshMaterials.map((material) => material.name);
    meshMaterials.forEach((material) => {
      materials.push(material);
      if (!HORIZON_MATERIALS.includes(material.name)) return;
      const physical = material as THREE.MeshPhysicalMaterial;
      if ('specularIntensity' in physical) physical.specularIntensity = 0;
    });

    if (names.includes(EXCLUDED_MATERIAL)) {
      mesh.visible = false;
      return;
    }
    // Same classification the lab uses, by material name rather than through its registry — the site has
    // no registry, and the names are the asset's own so they are the stabler key anyway.
    const phase: Phase = names.includes(LATE_RING_MATERIAL)
      ? 'late'
      : names.some((name) => GLOW_MATERIALS.includes(name)) || names.includes('ring2')
        ? 'early'
        : 'horizon';
    phased.push({ mesh, baseScale: mesh.scale.clone(), phase });
  });

  // ── group → pivot → model ──
  // The pivot re-anchors the asset onto itself: a glTF's origin is wherever the artist exported from, so
  // without this the hole would open around a point off to one side of itself.
  const pivot = new THREE.Group();
  pivot.add(model);
  const bounds = new THREE.Box3().setFromObject(model);
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  if (sphere.radius > 0) {
    const fit = (sunRadius * TARGET_FACTOR) / sphere.radius;
    model.scale.multiplyScalar(fit);
    pivot.position.set(-sphere.center.x, -sphere.center.y, -sphere.center.z).multiplyScalar(fit);
  }

  const object = new THREE.Group();
  object.add(pivot);
  // Nothing is on screen until the sequence opens it. Set here rather than left to the first frame, so a
  // slow decode can never pop a fully-formed hole into a frame that had not asked for one yet.
  phased.forEach((entry) => entry.mesh.scale.set(0, 0, 0));

  return {
    object,
    setForm: (horizonForm, earlyForm, lateForm) => {
      phased.forEach((entry) => {
        const form =
          entry.phase === 'horizon'
            ? horizonForm
            : entry.phase === 'early'
              ? earlyForm
              : lateForm;
        entry.mesh.scale.set(
          entry.baseScale.x * form,
          entry.baseScale.y * form,
          entry.baseScale.z * form,
        );
      });
    },
    dispose: () => {
      geometries.forEach((geometry) => geometry.dispose());
      materials.forEach((material) => material.dispose());
    },
  };
}
