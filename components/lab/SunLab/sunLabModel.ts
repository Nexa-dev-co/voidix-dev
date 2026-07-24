import * as THREE from "three";
import type { MaterialParams, ObjectDefaults, Vector3Values } from "./sunLabState";

// Parses the loaded fractured_sun scene into the tool's structures: the five role groups, a flat
// registry of selectable objects (each with captured defaults + live material slots), the shared
// materials, and the geometry the fracture-spread control needs.
//
// Two facts about THIS model drive the design (verified by loading it, not guessing):
//   • Its surface materials (flare / blowout / sun_inner / sunouter) are UNLIT — MeshBasicMaterial via
//     KHR_materials_unlit — and only `magma` is a lit MeshStandardMaterial. So the tool edits BOTH
//     material classes (basic = colour/opacity/wireframe; standard adds emissive/metal/rough).
//   • The 10 fracture shards are Groups at the scene root (they hold the real spread translations); the
//     magma/inner/shell meshes sit INSIDE them at local ~0. So fracture-spread moves the shard GROUPS,
//     never the inner meshes.

export type GroupId = "core" | "corona" | "cells" | "flares" | "planes";

export const GROUP_LABELS: Record<GroupId, string> = {
  core: "Core",
  corona: "Corona",
  cells: "Magma cracks",
  flares: "Flares",
  planes: "Planes",
};

export const GROUP_ORDER: GroupId[] = ["core", "corona", "cells", "flares", "planes"];

/** The material classes this model uses, and the only two the tool edits. */
export type EditableMaterial = THREE.MeshStandardMaterial | THREE.MeshBasicMaterial;
export type MaterialKind = "basic" | "standard";

/** The prefix the fracture shards' root Groups carry (post-load names drop the dots). */
const SHARD_NAME_PREFIX = "Sphere_0_cell";

export interface SunLabObjectEntry {
  id: string;
  name: string;
  groupId: GroupId;
  mesh: THREE.Mesh;
  /** The live materials on the mesh — a slot is swapped for a clone once edited per-object. */
  materialSlots: EditableMaterial[];
  /** The original shared materials, kept so a slot can be un-cloned back to shared (snapshot switch). */
  sharedSlots: EditableMaterial[];
  slotKinds: MaterialKind[];
  slotCloned: boolean[];
  defaults: ObjectDefaults;
}

export interface SharedMaterialEntry {
  name: string;
  kind: MaterialKind;
  material: EditableMaterial;
  defaults: MaterialParams;
}

/** One fracture shard the spread control moves as a whole. */
export interface ShardSpreadEntry {
  object: THREE.Object3D;
  basePosition: THREE.Vector3;
  outward: THREE.Vector3;
}

export interface CellSpreadData {
  shards: ShardSpreadEntry[];
  /** Mean distance of a shard from the assembly centre — the natural unit for the spread slider. */
  radius: number;
}

export interface SunLabRegistry {
  entries: SunLabObjectEntry[];
  entriesById: Map<string, SunLabObjectEntry>;
  groups: { id: GroupId; label: string; objectIds: string[] }[];
  sharedMaterials: SharedMaterialEntry[];
  cellSpread: CellSpreadData;
}

function toVector3Values(source: THREE.Vector3): Vector3Values {
  return { x: source.x, y: source.y, z: source.z };
}

function radToDegVector(euler: THREE.Euler): Vector3Values {
  return {
    x: THREE.MathUtils.radToDeg(euler.x),
    y: THREE.MathUtils.radToDeg(euler.y),
    z: THREE.MathUtils.radToDeg(euler.z),
  };
}

export function materialKindOf(material: EditableMaterial): MaterialKind {
  return material instanceof THREE.MeshStandardMaterial ? "standard" : "basic";
}

/** Read a material's editable state into plain params. Standard-only fields fall back for basic ones. */
export function readMaterialParams(material: EditableMaterial): MaterialParams {
  const isStandard = material instanceof THREE.MeshStandardMaterial;
  return {
    color: `#${material.color.getHexString()}`,
    emissive: isStandard ? `#${material.emissive.getHexString()}` : "#000000",
    emissiveIntensity: isStandard ? material.emissiveIntensity : 0,
    metalness: isStandard ? material.metalness : 0,
    roughness: isStandard ? material.roughness : 1,
    opacity: material.opacity,
    transparent: material.transparent,
    wireframe: material.wireframe,
  };
}

/** Push params onto a live material. The emissive/PBR fields only apply to a standard material. */
export function applyMaterialParams(material: EditableMaterial, params: MaterialParams): void {
  material.color.set(params.color);
  material.opacity = params.opacity;
  material.transparent = params.transparent;
  material.wireframe = params.wireframe;
  if (material instanceof THREE.MeshStandardMaterial) {
    material.emissive.set(params.emissive);
    material.emissiveIntensity = params.emissiveIntensity;
    material.metalness = params.metalness;
    material.roughness = params.roughness;
  }
  material.needsUpdate = true;
}

function isEditableMaterial(material: THREE.Material): material is EditableMaterial {
  return (
    material instanceof THREE.MeshStandardMaterial || material instanceof THREE.MeshBasicMaterial
  );
}

function materialSlotsOf(mesh: THREE.Mesh): EditableMaterial[] {
  const raw = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
  return raw.filter(isEditableMaterial);
}

/** magma → cells, sunouter → corona, blowout → planes, flare → flares, sun_inner → core. */
function groupForMaterialNames(names: string[]): GroupId | null {
  if (names.includes("magma")) return "cells";
  if (names.includes("sunouter")) return "corona";
  if (names.includes("blowout")) return "planes";
  if (names.includes("flare")) return "flares";
  if (names.includes("sun_inner")) return "core";
  return null;
}

export function buildSunLabRegistry(root: THREE.Object3D): SunLabRegistry {
  const entries: SunLabObjectEntry[] = [];
  const entriesById = new Map<string, SunLabObjectEntry>();
  const usedIds = new Set<string>();
  const sharedByName = new Map<string, SharedMaterialEntry>();

  const uniqueId = (name: string): string => {
    const base = name || "object";
    if (!usedIds.has(base)) {
      usedIds.add(base);
      return base;
    }
    let counter = 2;
    while (usedIds.has(`${base}#${counter}`)) counter += 1;
    const id = `${base}#${counter}`;
    usedIds.add(id);
    return id;
  };

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const slots = materialSlotsOf(object);
    if (slots.length === 0) return;

    const names = slots.map((material) => material.name);
    const groupId = groupForMaterialNames(names);
    if (!groupId) return;

    slots.forEach((material) => {
      if (material.name && !sharedByName.has(material.name)) {
        sharedByName.set(material.name, {
          name: material.name,
          kind: materialKindOf(material),
          material,
          defaults: readMaterialParams(material),
        });
      }
    });

    const id = uniqueId(object.name);
    const entry: SunLabObjectEntry = {
      id,
      name: object.name || id,
      groupId,
      mesh: object,
      materialSlots: slots,
      sharedSlots: slots.slice(),
      slotKinds: slots.map(materialKindOf),
      slotCloned: slots.map(() => false),
      defaults: {
        visible: object.visible,
        position: toVector3Values(object.position),
        rotation: radToDegVector(object.rotation),
        scale: toVector3Values(object.scale),
        materials: slots.map((material) => readMaterialParams(material)),
      },
    };
    entries.push(entry);
    entriesById.set(id, entry);
  });

  const groups = GROUP_ORDER.map((id) => ({
    id,
    label: GROUP_LABELS[id],
    objectIds: entries.filter((entry) => entry.groupId === id).map((entry) => entry.id),
  }));

  return {
    entries,
    entriesById,
    groups,
    sharedMaterials: Array.from(sharedByName.values()),
    cellSpread: computeCellSpread(root),
  };
}

// The fracture shards are the scene-root Groups named Sphere_0_cell*; their local positions carry the
// real assembly offsets. Outward direction = away from their shared centroid, entirely within that one
// frame — which is why the spread never sends a shard the wrong way. See docs/sun-lab-plan.md §1.
function computeCellSpread(root: THREE.Object3D): CellSpreadData {
  const shardObjects = root.children.filter((child) => child.name.startsWith(SHARD_NAME_PREFIX));

  if (shardObjects.length === 0) {
    return { shards: [], radius: 1 };
  }

  const centroid = new THREE.Vector3();
  shardObjects.forEach((shard) => centroid.add(shard.position));
  centroid.multiplyScalar(1 / shardObjects.length);

  let radiusSum = 0;
  const shards: ShardSpreadEntry[] = shardObjects.map((shard) => {
    const outward = shard.position.clone().sub(centroid);
    radiusSum += outward.length();
    // A shard exactly on the centroid has no outward — default to +Y so it still parts visibly.
    if (outward.lengthSq() < 1e-8) outward.set(0, 1, 0);
    return {
      object: shard,
      basePosition: shard.position.clone(),
      outward: outward.normalize(),
    };
  });

  return { shards, radius: radiusSum / shardObjects.length || 1 };
}
