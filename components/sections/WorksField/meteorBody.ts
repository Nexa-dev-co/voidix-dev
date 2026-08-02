import * as THREE from 'three';

/**
 * The rock surface shared by the works field's debris and the mark's stones.
 *
 * ── Why there's no fire shader ───────────────────────────────────────────────────────────────────
 * The surface texture is dark rock shot through with brighter mineral, so it is used as BOTH the
 * albedo and the emissive map. The rock is dark, so it emits almost nothing; the veins are bright, so
 * they emit hard — and the field's bloom pass turns that into real glow. One texture, no second mesh,
 * no procedural flame. The old fire shell existed to fake exactly this.
 *
 * ⚠ The emissive path is `emissive × emissiveIntensity × emissiveMap`, and the material's `color` is
 * NOT in it. So tinting a material built here darkens the albedo only — see the note on `STONE_TINT`
 * in `accretionTransition.ts`, which is what makes the mark's body safe to hold down while its
 * cavities stay lit.
 *
 * This file used to carve geometry too (a subdivided icosphere pushed around by layered directional
 * lobes, with rebuilt spherical UVs). That went with the meteor field it fed; the mark's stones are
 * cut by `transitions/accretionChunks.ts` and the debris carries its own lobes in `markRockField.ts`.
 */

/**
 * The rock's surface. One texture doing two jobs — see the note above.
 *
 * `emissiveIntensity` is the knob that replaced the fire's strength: it is what decides whether the
 * veins are cooling embers or actively molten.
 */
export function createMeteorMaterial(
  surfaceTexture: THREE.Texture,
  flatShading: boolean,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    map: surfaceTexture,
    // The SAME texture. Dark rock emits nothing, bright veins emit hard — which is the whole trick.
    emissiveMap: surfaceTexture,
    emissive: new THREE.Color('#ff7a2a'),
    emissiveIntensity: 1.6,
    roughness: 0.92,
    metalness: 0.05,
    flatShading,
  });
}
