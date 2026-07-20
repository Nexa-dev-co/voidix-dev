import * as THREE from 'three';
import { createMeteorMaterial } from './meteorBody';
import { createStoneMaterial } from './meteorMaterial';

/**
 * What one kind of chunk in a mark is made of.
 *
 * ── Why this is a spec and not a set of materials ────────────────────────────────────────────────
 * A mark built from a single surface reads as a solid blob at a distance — which is exactly the
 * failure it was reported with. The read comes from CONTRAST between chunks: mostly cold stone, a few
 * lighter asteroid faces catching the key light, and a scattering still molten. That's a mix, and a mix
 * has to be authored rather than guessed, so it's expressed as data the tuner can drive.
 *
 * ── The two treatments ───────────────────────────────────────────────────────────────────────────
 * Both come straight from the works field, unchanged, so a mark is made of visibly the same stuff as
 * the debris drifting around it:
 *
 *   `stone`  → `createStoneMaterial` — the field's debris treatment. Matte, cool-tinted, inert. This
 *              is the one the shards use; give it the field's own `SHARD_TINT` and a chunk is
 *              indistinguishable from a piece of drifting debris.
 *   `meteor` → `createMeteorMaterial` — the body's treatment, where the SAME image drives albedo and
 *              emissive, so dark rock emits nothing and bright veins burn. These are the chunks the
 *              field's bloom pass catches, which is why a few go a very long way.
 */

/** Every surface available under `public/textures/meteor`. */
export const CHUNK_TEXTURES = [
  { path: '/textures/meteor/basalt-magma.png', label: 'Basalt + magma (field)' },
  { path: '/textures/meteor/asteroid-surface-texture-background-composition_1079150-23859.jpg', label: 'Asteroid surface' },
  { path: '/textures/meteor/black-stone-background-material_1127-22469.jpg', label: 'Black stone' },
  { path: '/textures/meteor/istockphoto-1143001921-170667a.jpg', label: 'Grey rock' },
  { path: '/textures/meteor/OIP.webp', label: 'Rock (OIP)' },
] as const;

export type ChunkTreatment = 'stone' | 'meteor';

export interface ChunkMaterialSpec {
  /** Stable id, so the UI can key rows without depending on array position. */
  id: string;
  label: string;
  texturePath: string;
  treatment: ChunkTreatment;
  /** Multiplied over the albedo. On `stone` this is the main lever on how visible the chunk is. */
  tint: string;
  /** How many times the image wraps a chunk. Chunks are small, so this is usually > 1. */
  textureRepeat: number;
  roughness: number;
  /** Only meaningful on `meteor` — how hard the veins burn, and so how much bloom the chunk throws. */
  emissiveIntensity: number;
  /** Relative share of the mark's chunks. Normalised against the other specs. */
  weight: number;
}

/**
 * Build the material for one chunk kind.
 *
 * The texture is CLONED per material: `repeat` lives on the texture, not the material, so two specs
 * pointing at the same image with different repeats would otherwise fight over one shared object.
 * Cloning shares the uploaded image data, so this costs nothing on the GPU.
 */
export function createChunkMaterial(
  texture: THREE.Texture,
  spec: ChunkMaterialSpec,
): THREE.MeshStandardMaterial {
  const chunkTexture = texture.clone();
  chunkTexture.needsUpdate = true;
  chunkTexture.wrapS = THREE.RepeatWrapping;
  chunkTexture.wrapT = THREE.RepeatWrapping;
  chunkTexture.repeat.set(spec.textureRepeat, spec.textureRepeat);

  if (spec.treatment === 'meteor') {
    const material = createMeteorMaterial(chunkTexture, true);
    material.color.set(spec.tint);
    material.roughness = spec.roughness;
    material.emissiveIntensity = spec.emissiveIntensity;
    return material;
  }

  return createStoneMaterial(chunkTexture, {
    tint: new THREE.Color(spec.tint).getHex(),
    roughness: spec.roughness,
    flatShading: true,
  });
}

/**
 * The default mix.
 *
 * Weighted so ~90% of a mark is cold rock and ~10% is still molten — but the rock half is deliberately
 * split across several surfaces and tints rather than being one flat colour, because that variation is
 * what stops the mark reading as a silhouette-shaped smudge.
 *
 * The first entry is the works field's debris EXACTLY: its texture, its `SHARD_TINT`, its treatment. So
 * a mark always contains real field debris, and the rest are variations around it.
 */
export const DEFAULT_CHUNK_SPECS: ChunkMaterialSpec[] = [
  {
    id: 'shard',
    label: 'Field debris (exact)',
    texturePath: '/textures/meteor/basalt-magma.png',
    treatment: 'stone',
    tint: '#1c2530',
    textureRepeat: 2,
    roughness: 0.85,
    emissiveIntensity: 0,
    weight: 35,
  },
  {
    id: 'asteroid',
    label: 'Asteroid',
    texturePath: '/textures/meteor/asteroid-surface-texture-background-composition_1079150-23859.jpg',
    treatment: 'stone',
    // Much lighter than the field tint on purpose — these are the chunks that catch the key light and
    // give the mark its readable form.
    tint: '#8a8f98',
    textureRepeat: 1.5,
    roughness: 0.8,
    emissiveIntensity: 0,
    weight: 30,
  },
  {
    id: 'grey-rock',
    label: 'Grey rock',
    texturePath: '/textures/meteor/istockphoto-1143001921-170667a.jpg',
    treatment: 'stone',
    tint: '#5c626b',
    textureRepeat: 1.5,
    roughness: 0.9,
    emissiveIntensity: 0,
    weight: 15,
  },
  {
    id: 'black-stone',
    label: 'Black stone',
    texturePath: '/textures/meteor/black-stone-background-material_1127-22469.jpg',
    treatment: 'stone',
    tint: '#3a4048',
    textureRepeat: 2,
    roughness: 0.95,
    emissiveIntensity: 0,
    weight: 10,
  },
  {
    id: 'molten',
    label: 'Molten (bloom)',
    texturePath: '/textures/meteor/basalt-magma.png',
    treatment: 'meteor',
    tint: '#ffffff',
    textureRepeat: 2,
    roughness: 0.9,
    emissiveIntensity: 1.6,
    weight: 10,
  },
];
