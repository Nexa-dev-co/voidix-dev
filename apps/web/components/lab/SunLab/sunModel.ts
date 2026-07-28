import * as THREE from "three";
import { MATERIAL_LAYER, type LayerId } from "./sunState";

// Turns the loaded GLB into the structures the scene drives. Pure and framework-free: the async load
// and the Three lifecycle live in useSunLab; this file only knows how to read the model.

/** One look-layer: every mesh that shares a material, plus the authored + studio materials to swap. */
export interface SunLayer {
  id: LayerId;
  meshes: THREE.Mesh[];
  authoredMaterial: THREE.Material;
  studioMaterial: THREE.MeshStandardMaterial;
}

/**
 * One fracture stack — the magma cell N plus the matching inner/outer shell cells — grouped so they
 * fly as one in Stage 3/4. This is grouping only; the scene reparents these into a centre-origin group
 * and captures their rest transforms there, which makes radial explode + black-hole collapse trivial.
 */
export interface SunShard {
  cellKey: string;
  meshes: THREE.Mesh[];
}

export interface SunModel {
  root: THREE.Group;
  layers: Map<LayerId, SunLayer>;
  shards: SunShard[];
  /** Radius of the sun body (not counting rays/glow) — used to frame the camera. */
  bodyRadius: number;
}

// The three materials whose meshes are cut into matching Voronoi cells. A shard stacks one from each.
const SHARD_MATERIALS = new Set(["magma", "sun_inner", "sunouter"]);
// Extracts the cell index from names like "Sphere_0_cell.007" / "transp_Sphere_0_cell.007" so the three
// materials' pieces of the same fracture cell group together. Non-cell meshes (the solid core Sphere)
// return null and stay out of the shard system.
const CELL_KEY = /cell\.?(\d+)?$/i;

function cellKeyOf(mesh: THREE.Mesh): string | null {
  const match = mesh.name.match(CELL_KEY);
  if (!match) return null;
  return match[1] ?? "0";
}

/**
 * Build a controllable studio material from an authored one. Glow layers become pure emissive (colour
 * black so lights don't wash them — a star emits, it doesn't receive), driven by their base texture as
 * an emissive map so tint + intensity + bloom all work. The magma shards are already a lit PBR material,
 * so we clone them intact and only take over their emissive — that's the layer the light rig sculpts.
 */
function buildStudioMaterial(
  authored: THREE.Material,
  layerId: LayerId,
): THREE.MeshStandardMaterial {
  if (layerId === "shards" && authored instanceof THREE.MeshStandardMaterial) {
    const studio = authored.clone();
    studio.emissive = new THREE.Color(0xffffff);
    studio.emissiveIntensity = 1;
    return studio;
  }

  const baseMap =
    "map" in authored ? (authored as THREE.MeshBasicMaterial).map : null;
  const studio = new THREE.MeshStandardMaterial({
    color: new THREE.Color(0x000000),
    emissive: new THREE.Color(0xffffff),
    emissiveMap: baseMap ?? null,
    emissiveIntensity: 1,
    roughness: 1,
    metalness: 0,
    transparent: authored.transparent,
    opacity: authored.opacity,
    depthWrite: authored.transparent ? false : authored.depthWrite,
    blending: authored.blending,
    side: THREE.DoubleSide,
    alphaMap: (authored as THREE.MeshBasicMaterial).alphaMap ?? null,
    toneMapped: true,
  });
  return studio;
}

/** Group the loaded scene's meshes into look-layers + shard stacks, and build studio materials. */
export function buildSunModel(root: THREE.Group): SunModel {
  const layers = new Map<LayerId, SunLayer>();
  const shardBuckets = new Map<string, THREE.Mesh[]>();

  root.updateWorldMatrix(true, true);
  const bodyBox = new THREE.Box3();

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = object.material;
    // Every primitive in this model carries a single material; guard the array case defensively.
    const single = Array.isArray(material) ? material[0] : material;
    const layerId = MATERIAL_LAYER[single.name];
    if (!layerId) {
      console.warn(`[sun-lab] mesh "${object.name}" has unmapped material "${single.name}"`);
      return;
    }

    let layer = layers.get(layerId);
    if (!layer) {
      layer = {
        id: layerId,
        meshes: [],
        authoredMaterial: single,
        studioMaterial: buildStudioMaterial(single, layerId),
      };
      layers.set(layerId, layer);
    }
    layer.meshes.push(object);

    // The magma shells define the sun body's size (rays/glow reach further and would inflate it).
    if (single.name === "magma") bodyBox.expandByObject(object);

    // Bucket cell pieces for the shard system.
    if (SHARD_MATERIALS.has(single.name)) {
      const key = cellKeyOf(object);
      if (key) {
        const bucket = shardBuckets.get(key) ?? [];
        bucket.push(object);
        shardBuckets.set(key, bucket);
      }
    }
  });

  const bodyRadius = bodyBox.isEmpty()
    ? 0.6
    : bodyBox.getBoundingSphere(new THREE.Sphere()).radius;

  const shards: SunShard[] = [];
  shardBuckets.forEach((meshes, cellKey) => {
    shards.push({ cellKey, meshes });
  });

  return { root, layers, shards, bodyRadius };
}
