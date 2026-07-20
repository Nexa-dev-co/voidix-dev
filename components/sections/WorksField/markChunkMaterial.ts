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
  /** Share of the OUTLINE chunks. Normalised against the other specs' edge weights. */
  edgeWeight: number;
  /** Share of the INTERIOR chunks. Normalised separately — see MarkChunkMaterial. */
  interiorWeight: number;
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
 * The shipping mix — authored in the letter lab and exported from it, not designed here.
 *
 * ── Read the ids and labels as history, not description ──────────────────────────────────────────
 * They come from the palette this started as (a pale rim drawing the silhouette against a dark mass)
 * and the authored version went somewhere else entirely: the outline is now carried by white
 * `black-stone` at ~63%, `rim` is absent from the edge completely, and the tints are saturated rather
 * than a grey ladder. The names are kept only so a re-export from the lab diffs cleanly against this
 * file. **Trust the values, not the labels.**
 *
 * ── Two fields here are inert, deliberately left as exported ─────────────────────────────────────
 * `emissiveIntensity` is only read for the `meteor` treatment (see `createChunkMaterial`), so the `5`
 * on `rim` and `black-stone` does nothing — they're `stone`. It is left exactly as exported so a
 * re-export from the lab doesn't show a phantom diff. What the lab showed IS what renders; these are
 * dead data, not a discrepancy.
 *
 * ── What still holds from the original scheme ────────────────────────────────────────────────────
 * The molten chunks stay near 10% in both zones. They're post-processed — the field runs a bloom pass,
 * so a molten chunk spreads well past its own silhouette. Past roughly this share the mark stops being
 * rock with heat in it and becomes a light source, which is the sun's job on this page.
 */
export const DEFAULT_CHUNK_SPECS: ChunkMaterialSpec[] = [
  {
    id: 'rim',
    label: 'Rim stone (pale)',
    texturePath: '/textures/meteor/asteroid-surface-texture-background-composition_1079150-23859.jpg',
    treatment: 'stone',
    tint: '#0077ff',
    textureRepeat: 2.4,
    roughness: 0.78,
    emissiveIntensity: 5,
    edgeWeight: 0,
    interiorWeight: 11.0863,
  },
  {
    id: 'mid-stone',
    label: 'Mid stone',
    texturePath: '/textures/meteor/istockphoto-1143001921-170667a.jpg',
    treatment: 'stone',
    tint: '#ffff00',
    textureRepeat: 2,
    roughness: 0.86,
    emissiveIntensity: 0,
    edgeWeight: 1,
    interiorWeight: 0,
  },
  {
    id: 'black-stone',
    label: 'Black stone',
    texturePath: '/textures/meteor/black-stone-background-material_1127-22469.jpg',
    treatment: 'stone',
    tint: '#ffffff',
    textureRepeat: 6,
    roughness: 1,
    emissiveIntensity: 5,
    edgeWeight: 63.229,
    interiorWeight: 62.9345,
  },
  {
    id: 'shard',
    label: 'Field debris (exact)',
    texturePath: '/textures/meteor/basalt-magma.png',
    treatment: 'stone',
    tint: '#ff0000',
    textureRepeat: 2.6,
    roughness: 0.3,
    emissiveIntensity: 0,
    edgeWeight: 24.1592,
    interiorWeight: 15.9792,
  },
  {
    id: 'molten',
    label: 'Molten (bloom)',
    texturePath: '/textures/meteor/basalt-magma.png',
    treatment: 'meteor',
    tint: '#ff0000',
    textureRepeat: 1.8,
    roughness: 1,
    emissiveIntensity: 5,
    edgeWeight: 11.6117,
    interiorWeight: 10,
  },
];

/**
 * The layout authored alongside the mix above. The works field inherits these.
 *
 * `edgeChunkCount` replaced the authored `edgeSpacing: 0.03`: the swarm needs a FIXED pool so the same
 * rocks survive a mark change (see markSwarm), and a spacing yields a different count per shape. 260 is
 * roughly what that spacing produced on a typical mark.
 */
export const DEFAULT_MARK_LAYOUT = {
  edgeChunkCount: 260,
  edgeChunkScale: 0.04,
  interiorChunkScale: 0.06,
  interiorChunkCount: 340,
  depth: 0.7,
};
